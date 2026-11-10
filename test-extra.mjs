import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {createRequestStateCodec} from '@modelcontextprotocol/server';
const secret=randomBytes(32).toString('hex');
let child;
async function start(){child=spawn(process.execPath,['servidor-mcp/server.mjs'],{env:{...process.env,REQUEST_STATE_SECRET:secret,MCP_PORT:'17301'},windowsHide:true,stdio:['ignore','ignore','pipe']});await new Promise((resolve,reject)=>{child.once('error',reject);child.stderr.on('data',d=>{if(d.toString().includes('MCP pronto'))resolve();});child.once('exit',()=>reject(new Error('Servidor encerrou')));});}
async function stop(){const exit=once(child,'exit');child.kill();await exit;}
let id=0;
const args={sala:'sala-garagem',inicio:'2026-11-03T14:00:00-03:00',fim:'2026-11-03T15:00:00-03:00',responsavel:'Teste restart'};
const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientCapabilities':{elicitation:{form:{}}}};
async function call(extra={},headers={}){const r=await fetch('http://127.0.0.1:17301/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/call','Mcp-Name':'reservar_sala',...headers},body:JSON.stringify({jsonrpc:'2.0',id:++id,method:'tools/call',params:{name:'reservar_sala',arguments:args,_meta:meta,...extra}})});return r.json();}
try {
 await start(); const first=await call(); assert.equal(first.result.resultType,'input_required');
 const [key,input]=Object.entries(first.result.inputRequests)[0]; const sala=input.params.requestedSchema.properties.sala.enum[0];
 await stop();await start();
 const resumed=await call({requestState:first.result.requestState,inputResponses:{[key]:{action:'accept',content:{sala}}}});
 assert.equal(resumed.result.structuredContent.sala,sala);console.log('PASS retomada apos reinicio com a mesma chave');
 const codec=createRequestStateCodec({key:Buffer.from(secret,'hex'),ttlSeconds:-1});
 const expired=await call({requestState:await codec.mint({args}),inputResponses:{[key]:{action:'decline'}}});
 assert.equal(expired.error.code,-32602);console.log('PASS estado expirado rejeitado');
 const mismatch=await call({}, {'Mcp-Name':'listar_salas'});assert.equal(mismatch.error.code,-32020);console.log('PASS header divergente rejeitado');
} finally {if(child && child.exitCode===null)await stop();}
