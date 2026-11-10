# Auditoria de conformidade — A Ponte

Revisão em 10/11/2026 contra o enunciado anexado, o README original do starter (commit `263f17e202fd861d14aa7a5e6a539d13a62857c3`) e seus exemplos de fio. O validador original permanece intacto. Esta revisão combina leitura do código, testes HTTP reais e comparação dos arquivos protegidos.

## Resultado

- Validador original: 36 PASS, 0 FAIL, saída 0.
- `node test-audit.mjs`: 10 grupos PASS, 0 FAIL, saída 0.
- `node test-extra.mjs`: 3 PASS, saída 0.
- `git diff 263f17e202fd861d14aa7a5e6a539d13a62857c3 -- dados/ exemplos/ validador/`: sem diferenças.

Os grupos complementares incluem várias asserções; não são 13 novas verificações oficiais do curso. Não há pendência funcional conhecida nos requisitos obrigatórios revisados. A decisão de nota permanece dos avaliadores.

## Matriz de requisitos e evidências

| Requisito do desafio | Implementação e evidência |
|---|---|
| Dois processos, portas 7300/7301, HTTP e endpoints definidos | `agente/server.mjs` e `servidor-mcp/server.mjs`; execução real pelo validador. Sem importação de funções de domínio pelo agente. |
| SDK oficial MCP v2, ESM e versões fixas | `package.json`, `package-lock.json`, imports oficiais e arquivos `.mjs`. |
| Streamable HTTP stateless, capabilities tools/resources | `createMcpHandler` com `legacy: 'reject'`; capabilities declaradas ao construir `McpServer`. Nova instância por requisição, sem sessão. |
| Três tools e inputSchema objeto | Registros via SDK/Zod; verificações 01–02. |
| `listar_salas`: outputSchema, conteúdo estruturado e JSON textual idêntico | Schema Zod e função `result`; verificação 03. |
| Consulta de disponibilidade, conflitos e mesmas validações da reserva | `validar` e `conflitos` compartilhados; auditoria de quatro erros, reservas visíveis e intervalos adjacentes. |
| Reserva livre, campos obrigatórios e versão da política | Função da tool, `result`; verificações 16, 24–25. |
| Conteúdo estruturado e texto nos resultados das três tools | `result` nos sucessos e `erro` nos erros de negócio; auditoria complementar. |
| Recurso `politica://uso`, texto original e MIME markdown | `registerResource`, leitura direta do arquivo; verificação 07. URI desconhecida: 08. |
| Metadados obrigatórios por request, HTTP 400 / −32602 | Tratamento do SDK, sem herança de solicitações anteriores; verificações 04–05. |
| Ferramenta desconhecida: erro de protocolo | Handler oficial `tools/call`, −32602; verificação 06. |
| Quatro erros de política e ausência de alternativas | Mensagens exatas em `validar` e na reserva; verificações 09–12 e 20; consulta coberta pela auditoria. |
| Política em UTC−03, duração máxima, passado permitido | Conversão de instantes para UTC−03; testes nos limites, com offset Z equivalente e em 2020. Frações de segundo após 20h rejeitadas. |
| Alternativas: livres, capacidade mínima, máximo três e ordenação | Filtro/ordenação no servidor; verificação 14 e teste adicional com quatro alternativas potenciais e desempate por ID. |
| MRTR com uma pergunta, form e schema plano enum/const | `inputRequired.elicit`, uma chave e schema de sala; verificações 13–14. |
| Exigir declaração explícita de `elicitation.form` | Hook público `server.setRequestHandler`, contexto da requisição e erro oficial `MissingRequiredClientCapabilityError`; verificação 15 e teste com `elicitation: {}`. |
| Estado protegido, TTL de 5–30 minutos, segredo externo >=32 bytes | `createRequestStateCodec`, HMAC-SHA256, TTL 600s, chave hexadecimal validada em `REQUEST_STATE_SECRET`. Gerador documentado; segredo não publicado. |
| Estado completo, sem mapa de pausas no servidor; sobrevive a restart | Argumentos, alternativas e chave dentro do estado assinado; `test-extra.mjs` encerra e recria o processo antes do retry. |
| Estado adulterado/expirado rejeitado com −32602 | Verificação 17 e teste de expiração. Verificação feita pelo SDK antes do handler. |
| Argumentos adulterados não alteram reserva | A tool reconstrói os argumentos do estado verificado; verificação 18. |
| `decline` e `cancel` concluem sem erro, reservado false e motivo | Ramo de recusa na tool; verificação 19 e auditoria explícita de `cancel`. |
| Host descobre tools antes da chamada, sem lista fixa | `tools/list`, seleção pelo schema descoberto; auditoria captura a sequência HTTP real. |
| Host lê política e extrai versão da primeira linha | `resources/read` e extração de `versao`; verificações 25 e auditoria do artifact. |
| Metadados/capacidade e headers MCP correspondentes em cada request | Função `mcp`; auditoria da captura HTTP e teste de header divergente −32020. |
| Traceparent mantém trace-id e aparece no stderr | Trace associado à Task e reenviado na retomada; auditoria compara todos os requests capturados e verifica log do servidor. |
| Agent Card v1.0, identidade, interface, versão e skill | Card com campos do exemplo, inclusive provider, modos e exemplos da skill; verificações 21–23 e auditoria. |
| SendMessage/GetTask, IDs próprios, estados SUBMITTED/WORKING | `dispatch`, UUIDs e chamadas explícitas de `estado`; operações MCP assíncronas deixam o servidor disponível para GetTask. Verificações 24, 26–27 e revisão do código. |
| Sucesso COMPLETED com artifact `reserva`; GetTask conserva produto | `executar`, artifact JSON e mapa de Tasks; verificações 24–26, 30 e auditoria de GetTask. |
| Erro de tool causa FAILED com mensagem exata no histórico | `r.isError` em `executar`; verificação 35. |
| COMPLETED, CANCELED e FAILED não reabrem | Continuação só aceita INPUT_REQUIRED; verificação 31 e testes para os outros dois estados terminais. |
| Pausa com texto exato, sem prefixos adicionais | `pausa`, linha `alternativas: ...`; verificações 27–29 e 36. |
| Continuação aceita escolha, repete pausa inválida e traduz recusa | `dispatch`, `inputResponses`; verificações 29–32. |
| Retry: argumentos originais, novo ID, mesma chave e estado idêntico | Auditoria HTTP compara requisição inicial, resposta e retry campo a campo. |
| Pausas isoladas por Task e estado opaco, sem vazamento A2A | Mapas público/privado separados; verificações 33–34 e auditoria. O agente não decodifica o estado. |
| Agente determinístico, sem LLM ou regra de salas | Parser fixo; seleção de alternativas e política só no MCP; verificação 36 e revisão de imports/dependências. UUIDs e timestamps identificam tarefas e não representam decisão de negócio. |
| README com quatro seções obrigatórias, comandos e saída integral | `README.md` e `validacao.txt`; instalação `npm ci` e testes em cópia limpa do fork. |
| Fork público, branch main, estrutura e arquivos protegidos | Metadados do GitHub e comparação Git; dados, exemplos e validador preservados. |

## Correções motivadas pela revisão

1. A comparação de horário descartava milissegundos. Agora compara o horário completo: `20:00:00.001` é rejeitado.
2. Erros de negócio agora também incluem `structuredContent`, preservando a mensagem textual e `isError`.
3. Declaração explícita de capacidade form é exigida antes de devolver qualquer elicitação.
4. O Agent Card ganhou os metadados adicionais do exemplo original.

### Particularidade do SDK e escolha da API

No SDK travado `@modelcontextprotocol/server@2.4.0`, a função interna `isImpliedCapabilityMember` contém:

```js
return capability === "elicitation" && member === "form"
  && declaredValue["form"] === void 0 && declaredValue["url"] === void 0;
```

Isso aceita implicitamente form em `elicitation: {}`. Além disso, o wrapper de tools de alto nível converte exceções de handlers em `isError`. Para cumprir a exigência mais estrita do desafio, usamos a API pública de baixo nível `server.setRequestHandler('tools/call', ...)` e a classe oficial `MissingRequiredClientCapabilityError`. Os registros e a descoberta continuam em `McpServer`; o transporte, negociação, serialização, MRTR, assinatura e verificação continuam no SDK. Não há implementação substituta do protocolo ou alteração em dependências.

## Escopo e reprodução

Reservas e Tasks são voláteis, como permitido. Para testar restart do MCP, preserve a mesma variável de segredo. Reinicie os dois processos antes de cada execução do validador, porque os testes criam reservas. Os passos manuais do enunciado que esperam todas as alternativas também precisam de dados iniciais: o próprio validador pode ter ocupado essas salas.

```sh
npm ci
PYTHON=python3 node check.mjs
node test-extra.mjs
node test-audit.mjs
```

No PowerShell, use `$env:PYTHON = 'python'; node check.mjs`. Os testes complementares usam portas 17301 e 18300–18302. O proxy de observação só existe no teste, não faz parte dos dois processos da aplicação. O MCP Inspector consta como ferramenta sugerida de depuração, não como critério obrigatório; esta auditoria usou clientes HTTP e o validador, não uma sessão visual do Inspector.
