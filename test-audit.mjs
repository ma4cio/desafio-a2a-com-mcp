import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';

const children=[]; const captured=[]; const logs=[];
const env={...process.env,REQUEST_STATE_SECRET:randomBytes(32).toString('hex'),MCP_PORT:'18301',AGENT_PORT:'18300',MCP_URL:'http://127.0.0.1:18302/mcp'};
async function start(file,ready){
 const p=spawn(process.execPath,[file],{env,windowsHide:true,stdio:['ignore','ignore','pipe']});children.push(p);
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Startup timeout')),10000);p.once('error',reject);p.once('exit',()=>reject(new Error('Startup failed')));p.stderr.on('data',d=>{logs.push(d.toString());if(d.toString().includes(ready)){clearTimeout(timer);resolve();}});});
}
// Observe real HTTP at the boundary; do not mock tool outcomes.
const proxy=createServer(async(req,res)=>{
 let body='';for await(const c of req)body+=c;
 const entry={request:JSON.parse(body),headers:req.headers};captured.push(entry);
 const response=await fetch('http://127.0.0.1:18301/mcp',{method:'POST',headers:{...req.headers,host:'127.0.0.1:18301'},body});
 const raw=await response.text();entry.response=JSON.parse(raw);
 res.writeHead(response.status,{'Content-Type':'application/json'});res.end(raw);
});
let id=0, failures=0, passed=0;
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{form:{}}}};
const base={sala:'sala-aquario',inicio:'2026-11-04T09:00:00-03:00',fim:'2026-11-04T10:00:00-03:00',responsavel:'Auditoria'};
async function rpc(url,method,params,headers={}){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(10000)});return {status:response.status,...await response.json()};}
async function mcp(name,args=base,extra={}){return rpc('http://127.0.0.1:18301/mcp','tools/call',{name,arguments:args,_meta:meta,...extra},{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':name});}
async function send(text,taskId,trace){return rpc('http://127.0.0.1:18300/a2a','SendMessage',{message:{messageId:randomBytes(8).toString('hex'),role:'ROLE_USER',parts:[{text}],...(taskId?{taskId}:{})}},trace?{traceparent:trace}:{});}
const pedido=a=>`reservar sala=${a.sala} inicio=${a.inicio} fim=${a.fim} responsavel=${a.responsavel}`;
async function test(name,fn){try{await fn();passed++;console.log(`PASS ${name}`);}catch(e){failures++;console.error(`FAIL ${name}: ${e.message}`);}}
try{
 await start('servidor-mcp/server.mjs','MCP pronto');proxy.listen(18302,'127.0.0.1');await once(proxy,'listening');await start('agente/server.mjs','Agente pronto');
 await test('consultar: quatro erros exatos, complete e structuredContent',async()=>{
  for(const [change,message] of [
   [{sala:'inexistente'},'Sala inexistente: inexistente'],
   [{inicio:'2026-11-04T07:00:00-03:00'},'Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00'],
   [{fim:'2026-11-04T12:00:00-03:00'},'Duracao acima do limite: a politica permite no maximo 2 horas'],
   [{fim:base.inicio},'Intervalo invalido: fim deve ser posterior a inicio']]){
    const r=(await mcp('consultar_disponibilidade',{...base,...change})).result;assert.equal(r.resultType,'complete');assert.equal(r.isError,true);assert.ok(r.content[0].text.includes(message));assert.ok(r.structuredContent);
  }
 });
 await test('janela: rejeita 20:00:00.001',async()=>{const r=await mcp('reservar_sala',{...base,inicio:'2026-11-04T19:00:00-03:00',fim:'2026-11-04T20:00:00.001-03:00'});assert.equal(r.result.isError,true);});
 await test('janela: aceita limites e offset equivalente, sem depender da data atual',async()=>{
  for(const [inicio,fim] of [['2020-01-01T11:00:00Z','2020-01-01T13:00:00Z'],['2020-01-01T18:00:00-03:00','2020-01-01T20:00:00-03:00']]){const r=await mcp('consultar_disponibilidade',{...base,inicio,fim});assert.equal(r.result.structuredContent.livre,true);}
 });
 await test('reservas novas visiveis; intervalos adjacentes nao conflitam',async()=>{
  const r=await mcp('reservar_sala',base);assert.equal(r.result.structuredContent.reservado,true);
  const d=(await mcp('consultar_disponibilidade')).result.structuredContent;assert.equal(d.livre,false);assert.equal(d.conflitos[0].id,r.result.structuredContent.reserva);
  assert.equal((await mcp('consultar_disponibilidade',{...base,inicio:base.fim,fim:'2026-11-04T11:00:00-03:00'})).result.structuredContent.livre,true);
 });
 await test('alternativas: limite de tres, capacidade e desempate alfabetico',async()=>{
  const r=(await mcp('reservar_sala')).result;const req=Object.values(r.inputRequests);assert.equal(req.length,1);assert.deepEqual(req[0].params.requestedSchema.properties.sala.enum,['sala-porao','sala-fusca','sala-garagem']);
 });
 await test('elicitation vazia nao equivale a form; erro inclui requiredCapabilities',async()=>{
  const r=await mcp('reservar_sala',base,{_meta:{...meta,'io.modelcontextprotocol/clientCapabilities':{elicitation:{}}}});assert.equal(r.status,400);assert.equal(r.error.code,-32021);assert.deepEqual(r.error.data.requiredCapabilities,{elicitation:{form:{}}});
 });
 await test('cancel conclui sem reservar e sem isError',async()=>{
  const r=(await mcp('reservar_sala')).result;const key=Object.keys(r.inputRequests)[0];const c=(await mcp('reservar_sala',base,{requestState:r.requestState,inputResponses:{[key]:{action:'cancel'}}})).result;assert.equal(c.resultType,'complete');assert.ok(!c.isError);assert.equal(c.structuredContent.reservado,false);assert.ok(c.structuredContent.motivo);
 });
 await test('Agent Card inclui metadados presentes no exemplo do starter',async()=>{
  const card=await(await fetch('http://127.0.0.1:18300/.well-known/agent-card.json')).json();const sample=JSON.parse(readFileSync('exemplos/wire/07-a2a-agent-card.json','utf8')).response.body;
  for(const key of Object.keys(sample))assert.ok(key in card,`campo ausente: ${key}`);
  for(const key of Object.keys(sample.skills[0]))assert.ok(key in card.skills[0],`campo skill ausente: ${key}`);
 });
 await test('ponte HTTP: descoberta, metadados, trace, estado opaco e novo id no retry',async()=>{
  const trace='00-11111111111111111111111111111111-2222222222222222-01';const offset=captured.length;
  const a={...base,sala:'sala-garagem',inicio:'2026-11-03T14:00:00-03:00',fim:'2026-11-03T15:00:00-03:00'};
  const first=(await send(pedido(a),undefined,trace)).result.task;assert.equal(first.status.state,'TASK_STATE_INPUT_REQUIRED');assert.equal(first.status.message.parts[0].text,'alternativas: sala-fusca, sala-mirante');
  const second=(await send('escolha=sala-mirante',first.id)).result.task;assert.equal(second.status.state,'TASK_STATE_COMPLETED');
  const calls=captured.slice(offset);assert.deepEqual(calls.map(c=>c.request.method),['tools/list','resources/read','tools/call','tools/call']);
  for(const c of calls){assert.equal(c.request.params._meta.traceparent,trace);assert.deepEqual(c.request.params._meta['io.modelcontextprotocol/clientCapabilities'],{elicitation:{form:{}}});assert.equal(c.headers['mcp-method'],c.request.method);assert.equal(c.headers['mcp-protocol-version'],'2026-07-28');if(c.request.method==='tools/call')assert.equal(c.headers['mcp-name'],c.request.params.name);}
  assert.notEqual(calls[2].request.id,calls[3].request.id);assert.equal(calls[3].request.params.requestState,calls[2].response.result.requestState);assert.deepEqual(calls[3].request.params.arguments,calls[2].request.params.arguments);assert.deepEqual(Object.keys(calls[3].request.params.inputResponses),Object.keys(calls[2].response.result.inputRequests));
  assert.ok(!JSON.stringify(second).includes(calls[2].response.result.requestState));
  const get=(await rpc('http://127.0.0.1:18300/a2a','GetTask',{id:first.id})).result.task;assert.deepEqual(get.artifacts,second.artifacts);assert.equal(JSON.parse(get.artifacts[0].parts[0].text).politica,'2026-11-01');
  assert.ok(logs.join('').includes(trace));
 });
 await test('FAILED e CANCELED sao terminais',async()=>{
  const failed=(await send(pedido({...base,sala:'sala-inexistente'}))).result.task;assert.equal(failed.status.state,'TASK_STATE_FAILED');assert.ok((await send('escolha=recusar',failed.id)).error);
  const paused=(await send(pedido(base))).result.task;const canceled=(await send('escolha=recusar',paused.id)).result.task;assert.equal(canceled.status.state,'TASK_STATE_CANCELED');assert.ok((await send('escolha=sala-porao',paused.id)).error);
 });
}finally{proxy.closeAllConnections();await new Promise(r=>proxy.close(r));for(const p of children){if(p.exitCode===null){const exit=once(p,'exit');p.kill();await exit;}}}
console.log(`Auditoria complementar: ${passed} passaram, ${failures} falharam.`);process.exitCode=failures?1:0;
