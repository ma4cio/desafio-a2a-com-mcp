import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { McpServer, createMcpHandler, createRequestStateCodec, inputRequired, ProtocolError, MissingRequiredClientCapabilityError } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { z } from 'zod';

const read = name => readFileSync(new URL(`../dados/${name}`, import.meta.url), 'utf8');
const salas = JSON.parse(read('salas.json'));
const reservas = JSON.parse(read('reservas.json'));
const politica = read('politica-de-uso.md');
const versao = politica.split('\n')[0].split(':')[1].trim();
const secret = process.env.REQUEST_STATE_SECRET;
if (!secret || !/^[a-f\d]{64,}$/i.test(secret) || secret.length % 2) throw new Error('REQUEST_STATE_SECRET deve conter ao menos 32 bytes em hexadecimal.');
const codec = createRequestStateCodec({ key: Buffer.from(secret, 'hex'), ttlSeconds: 600 });
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });
const erro = text => ({ isError: true, content: [{ type: 'text', text }], structuredContent: {erro:text} });
const campos = { sala: z.string(), inicio: z.string(), fim: z.string() };
function validar(a) {
  const sala = salas.find(s => s.id === a.sala);
  if (!sala) return `Sala inexistente: ${a.sala}`;
  const i = Date.parse(a.inicio), f = Date.parse(a.fim);
  if (!Number.isFinite(i) || !Number.isFinite(f) || f <= i) return 'Intervalo invalido: fim deve ser posterior a inicio';
  const local = t => new Date(t - 3 * 3600000).toISOString();
  const li = local(i), lf = local(f);
  if (li.slice(0,10) !== lf.slice(0,10) || li.slice(11) < '08:00:00.000Z' || lf.slice(11) > '20:00:00.000Z') return 'Fora da janela de uso: a politica permite reservas entre 08:00 e 20:00';
  if (f - i > 7200000) return 'Duracao acima do limite: a politica permite no maximo 2 horas';
}
const conflitos = a => reservas.filter(r => r.sala === a.sala && Date.parse(r.inicio) < Date.parse(a.fim) && Date.parse(r.fim) > Date.parse(a.inicio));
function buildServer() {
  const server = new McpServer({ name: 'central-de-salas', version: '1.0.0' }, { capabilities: { tools: {}, resources: {} }, requestState: { verify: codec.verify } });
  const tools = new Map();
  const registerTool = (name,config,callback) => {
    server.registerTool(name,config,callback);
    tools.set(name,{config,callback});
  };
  registerTool('listar_salas', { description: 'Lista salas.', inputSchema: z.object({}), outputSchema: z.object({ salas: z.array(z.object({id:z.string(), nome:z.string(), capacidade:z.number(), recursos:z.array(z.string())})) }) }, async () => result({ salas }));
  registerTool('consultar_disponibilidade', { description: 'Consulta disponibilidade.', inputSchema: z.object(campos) }, async a => {
    const e = validar(a); if (e) return erro(e);
    const c = conflitos(a); return result({ sala: a.sala, livre: c.length === 0, conflitos: c });
  });
  registerTool('reservar_sala', { description: 'Reserva sala; solicita alternativa quando ocupada.', inputSchema: z.object({...campos, responsavel: z.string()}) }, async (args, ctx) => {
    const state = ctx.mcpReq.requestState();
    let a = state ? { ...state.args } : {...args};
    if (state) {
      const resposta = ctx.mcpReq.inputResponses?.[state.key];
      if (['decline','cancel'].includes(resposta?.action)) return result({reservado:false, motivo:'Escolha recusada pelo usuario'});
      if (resposta?.action !== 'accept' || !state.alternativas.includes(resposta?.content?.sala)) throw new ProtocolError(-32602, 'Escolha invalida');
      a.sala = resposta.content.sala;
    }
    const e = validar(a); if (e) return erro(e);
    if (conflitos(a).length) {
      const capacidade = salas.find(s => s.id === a.sala).capacidade;
      const alternativas = salas.filter(s => s.capacidade >= capacidade && !conflitos({...a,sala:s.id}).length).sort((a,b) => a.capacidade-b.capacidade || a.id.localeCompare(b.id)).slice(0,3).map(s=>s.id);
      if (!alternativas.length) return erro('Sem alternativas disponiveis no intervalo');
      const key = 'escolha_de_sala';
      return inputRequired({inputRequests:{[key]:inputRequired.elicit({message:'Escolha uma sala alternativa.',requestedSchema:z.object({sala:z.enum(alternativas)})})},requestState:await codec.mint({args:a, alternativas,key})});
    }
    const id = `res-${String(reservas.length+1).padStart(4,'0')}`;
    reservas.push({id,...a});
    return result({reserva:id,reservado:true,...a,politica:versao});
  });
  server.registerResource('politica', 'politica://uso', {mimeType:'text/markdown'}, async uri => ({contents:[{uri:uri.href,mimeType:'text/markdown',text:politica}]}));
  // Public low-level SDK hook: require explicit form capability. The SDK's
  // default compatibility rule implies form from elicitation:{}, which the
  // challenge forbids. Transport, MRTR and state verification remain in SDK.
  server.server.setRequestHandler('tools/call', async (request,ctx) => {
    const tool = tools.get(request.params.name);
    if (!tool) throw new ProtocolError(-32602,'Ferramenta inexistente');
    const parsed = tool.config.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) throw new ProtocolError(-32602,'Argumentos invalidos');
    const value = await tool.callback(parsed.data,ctx);
    if (value.resultType === 'input_required') {
      const form = ctx.mcpReq.envelope?.['io.modelcontextprotocol/clientCapabilities']?.elicitation?.form;
      if (!form || typeof form !== 'object' || Array.isArray(form)) {
        throw new MissingRequiredClientCapabilityError({requiredCapabilities:{elicitation:{form:{}}}});
      }
      return value;
    }
    if (!value.isError && tool.config.outputSchema) tool.config.outputSchema.parse(value.structuredContent);
    return server.server.projectCallToolResult(value,tool.config.outputSchema ? z.toJSONSchema(tool.config.outputSchema) : undefined);
  });
  return server;
}
const handler = createMcpHandler(buildServer, {legacy:'reject',responseMode:'json'});
const wrapped = { fetch: async request => {
  if (new URL(request.url).pathname !== '/mcp') return new Response('Not found',{status:404});
  if (request.method === 'POST') {
    try { const b = await request.clone().json(); console.error(JSON.stringify({method:b.method,id:b.id,traceparent:b.params?._meta?.traceparent})); } catch {}
  }
  return handler.fetch(request);
}};
createServer(toNodeHandler(wrapped)).listen(Number(process.env.MCP_PORT || 7301), '127.0.0.1',()=>console.error('MCP pronto'));

