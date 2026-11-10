import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const tasks = new Map();
const privados = new Map();
let requestId = 0;
const port = Number(process.env.AGENT_PORT || 7300);
const endpoint = process.env.MCP_URL || 'http://127.0.0.1:7301/mcp';
async function mcp(method, params, traceparent) {
  const meta = {'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{form:{}}},...(traceparent ? {traceparent}: {})};
  const headers = {'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':method};
  if (method === 'tools/call') headers['Mcp-Name'] = params.name;
  if (method === 'resources/read') headers['Mcp-Name'] = params.uri;
  const response = await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method,params:{...params,_meta:meta}}),signal:AbortSignal.timeout(10000)});
  const body = await response.json();
  if (body.error) throw new Error(`MCP: ${body.error.code}`);
  return body.result;
}
function estado(task, state, text) {
  task.status = {state:`TASK_STATE_${state}`,timestamp:new Date().toISOString()};
  if (text) {
    const message = {messageId:randomUUID(),role:'ROLE_AGENT',parts:[{text}],taskId:task.id,contextId:task.contextId};
    task.status.message = message; task.history.push(message);
  }
}
function pausa(task, p) { estado(task,'INPUT_REQUIRED',`alternativas: ${p.alternativas.join(', ')}`); }
async function executar(task, p, extra = {}) {
  estado(task,'WORKING');
  try {
    const r = await mcp('tools/call',{name:p.tool,arguments:p.args,...extra},p.trace);
    if (r.resultType === 'input_required') {
      const [key, input] = Object.entries(r.inputRequests)[0];
      const schema = input.params.requestedSchema.properties.sala;
      Object.assign(p,{key,requestState:r.requestState,alternativas:schema.enum || [schema.const]});
      pausa(task,p); return;
    }
    if (r.isError) { estado(task,'FAILED',r.content.map(c=>c.text || '').join('\n')); privados.delete(task.id); return; }
    if (!r.structuredContent.reservado) estado(task,'CANCELED',r.structuredContent.motivo);
    else {
      const data = {...r.structuredContent,politica:p.politica};
      task.artifacts = [{artifactId:randomUUID(),name:'reserva',parts:[{text:JSON.stringify(data)}]}];
      estado(task,'COMPLETED',`Reserva ${data.reserva} confirmada na ${data.sala}.`);
    }
    privados.delete(task.id);
  } catch { estado(task,'FAILED','Falha na comunicacao com o servidor MCP.'); privados.delete(task.id); }
}
const fail = (message,code=-32602) => { throw Object.assign(new Error(message),{code}); };
async function dispatch(b, trace) {
  if (b.jsonrpc !== '2.0') fail('JSON-RPC invalido',-32600);
  if (b.method === 'GetTask') { const t=tasks.get(b.params?.id); if (!t) fail('Task inexistente'); return {task:t}; }
  if (b.method !== 'SendMessage') fail('Metodo desconhecido',-32601);
  const msg = b.params?.message;
  if (!msg || !Array.isArray(msg.parts)) fail('Mensagem invalida');
  const text = msg.parts.map(p=>p.text || '').join('');
  if (msg.taskId) {
    const task = tasks.get(msg.taskId);
    if (!task) fail('Task inexistente');
    if (task.status.state !== 'TASK_STATE_INPUT_REQUIRED') fail('Task nao aceita continuacao');
    const p = privados.get(task.id);
    task.history.push({messageId:msg.messageId || randomUUID(),role:'ROLE_USER',parts:[{text}],taskId:task.id});
    const choice = /^escolha=(\S+)$/.exec(text)?.[1];
    if (choice !== 'recusar' && !p.alternativas.includes(choice)) {pausa(task,p); return {task};}
    await executar(task,p,{requestState:p.requestState,inputResponses:{[p.key]:choice === 'recusar' ? {action:'decline'} : {action:'accept',content:{sala:choice}}}});
    return {task};
  }
  const match = /^reservar sala=(\S+) inicio=(\S+) fim=(\S+) responsavel=(.+)$/.exec(text);
  if (!match) fail('Formato esperado: reservar sala=<id> inicio=<iso8601> fim=<iso8601> responsavel=<nome>');
  const task = {id:randomUUID(),contextId:randomUUID(),history:[{messageId:msg.messageId || randomUUID(),role:'ROLE_USER',parts:[{text}]}],artifacts:[]};
  estado(task,'SUBMITTED'); tasks.set(task.id,task);
  estado(task,'WORKING');
  try {
    const discovery = await mcp('tools/list',{},trace);
    const args = Object.fromEntries(['sala','inicio','fim','responsavel'].map((k,i)=>[k,match[i+1]]));
    // Select the discovered tool by its input contract, rather than a fixed tool list.
    const tool = discovery.tools.find(t => Object.keys(args).every(k=>t.inputSchema.properties?.[k]));
    if (!tool) throw new Error('Ferramenta indisponivel');
    const resource = await mcp('resources/read',{uri:'politica://uso'},trace);
    const politica = /^versao:\s*(.+)/.exec(resource.contents[0].text)?.[1].trim();
    if (!politica) throw new Error('Politica invalida');
    const p = {tool:tool.name,args,trace,politica}; privados.set(task.id,p);
    await executar(task,p);
  } catch {estado(task,'FAILED','Falha na descoberta das capacidades MCP.'); privados.delete(task.id);}
  return {task};
}
const card = {name:'Central de Salas',description:'Reserva salas da Hill Valley Tech.',version:'1.0.0',supportedInterfaces:[{url:`http://127.0.0.1:${port}/a2a`,protocolBinding:'JSONRPC',protocolVersion:'1.0'}],capabilities:{streaming:false,pushNotifications:false,extendedAgentCard:false},defaultInputModes:['text/plain'],defaultOutputModes:['text/plain'],skills:[{id:'reservar-sala',name:'Reservar sala',description:'Reserva e solicita alternativas em conflitos.',tags:['salas','agenda']}]};
createServer(async (req,res)=>{
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(req.method==='GET' && req.url==='/.well-known/agent-card.json') return send(200,card);
  if(req.method!=='POST' || req.url!=='/a2a') return send(404,{error:'Not found'});
  let b;
  try { let raw=''; for await(const chunk of req) {raw+=chunk;if(raw.length>1048576) fail('Mensagem muito grande');} b=JSON.parse(raw); const result=await dispatch(b,req.headers.traceparent);send(200,{jsonrpc:'2.0',id:b.id,result}); }
  catch(e){send(200,{jsonrpc:'2.0',id:b?.id ?? null,error:{code:e.code || -32700,message:e.code ? e.message : 'JSON invalido'}});}
}).listen(port,'127.0.0.1',()=>console.error('Agente pronto'));
