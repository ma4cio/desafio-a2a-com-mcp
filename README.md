# A Ponte — MCP por dentro, A2A por fora

Agente determinístico de reserva de salas, com dois processos independentes. Implementa MCP revisão `2026-07-28`, pelo SDK oficial v2, e A2A v1.0 em JSON-RPC sobre HTTP. Não usa LLM, banco de dados ou ORM.

## Como rodar

Requisitos: Node.js 20 ou superior com npm e Python 3.10 ou superior. Execute na raiz do repositório. Dependências e versões transitivas estão travadas em `package-lock.json`.

```sh
git clone https://github.com/ma4cio/desafio-a2a-com-mcp.git
cd desafio-a2a-com-mcp
npm ci
```

No primeiro terminal (Linux/macOS):

```sh
export REQUEST_STATE_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
node servidor-mcp/server.mjs
```

No Windows PowerShell:

```powershell
$env:REQUEST_STATE_SECRET = python -c "import secrets; print(secrets.token_hex(32))"
node servidor-mcp/server.mjs
```

A chave é um segredo de 32 bytes aleatórios, codificado em hexadecimal. Nunca a publique. Para testar retomada após reinício, execute novamente apenas `node servidor-mcp/server.mjs` no mesmo terminal, conservando a variável; não gere outra chave. O processo recusa chave ausente, curta ou com codificação inválida.

No segundo terminal:

```sh
node agente/server.mjs
```

No terceiro terminal, com os servidores recém-iniciados:

```sh
python3 validador/validar.py --agente http://localhost:7300 --mcp http://localhost:7301
```

No Windows, use `python` em lugar de `python3`. O validador cria reservas; reinicie ambos os processos antes de repeti-lo. O Agent Card fica em `http://localhost:7300/.well-known/agent-card.json`; os endpoints são `/a2a` e `/mcp`. Configuração opcional: `AGENT_PORT`, `MCP_PORT` e `MCP_URL`. Os processos escutam somente em loopback.

Teste automatizado com inicialização e encerramento de ambos os processos (portas 7300 e 7301 devem estar livres):

```sh
PYTHON=python3 node check.mjs
node test-extra.mjs
```

No PowerShell: `$env:PYTHON = 'python'; node check.mjs`. O teste adicional usa a porta 17301 e verifica retomada após reinício, expiração e divergência entre cabeçalho e corpo.

## Onde a ponte acontece

Em `agente/server.mjs`, `executar` recebe o resultado MCP bruto e transforma `input_required` em `TASK_STATE_INPUT_REQUIRED`, por meio de `pausa`. Guarda `requestState`, argumentos originais e a chave da elicitação no mapa privado associado ao ID da Task. Na continuação, `dispatch` valida a escolha e chama `executar` com `inputResponses` e o mesmo `requestState`. A função `mcp` atribui um novo ID a cada requisição. O estado opaco nunca é decodificado pelo agente nem incluído nas respostas A2A. A recusa vira `decline`; a tarefa termina em `CANCELED` somente após a resposta do servidor MCP.

## Decisões técnicas

- Servidor: SDK oficial `@modelcontextprotocol/server`, com `createMcpHandler`, transporte HTTP sem sessão e `inputRequired.elicit`. O SDK valida os metadados, capacidades e cabeçalhos e distingue erros de protocolo de erros de ferramenta.
- Integridade: `createRequestStateCodec`, HMAC-SHA256 e validade de 600 segundos. O estado assinado leva argumentos originais, alternativas e chave da pergunta. O retry usa os argumentos assinados, não os enviados novamente pelo cliente. O servidor não mantém mapa de solicitações pausadas.
- Reservas: lista em memória inicializada pelos JSON originais. Conflitos, janela em UTC−03:00, duração e ordenação de alternativas ficam exclusivamente no servidor MCP. Reservas não sobrevivem a reinício, conforme permitido.
- Host: cliente HTTP explícito para observar MRTR sem resposta automática. Descobre ferramentas antes de chamar; seleciona a ferramenta pelo contrato de entrada descoberto e lê a versão da política pelo recurso. Toda requisição contém metadados e cabeçalhos MCP correspondentes.
- Tasks: mapas em memória, com dados públicos separados da continuação privada. Estados terminais não podem ser reabertos. `GetTask` continua disponível durante operações assíncronas. Reiniciar o agente perde Tasks, limitação permitida pelo enunciado.
- Rastreamento: o `traceparent` da abertura da Task acompanha todas as suas chamadas e retomadas MCP. O stderr do servidor registra método, ID e traceparent, sem registrar segredo ou estado assinado.
- Sem streaming, autenticação, interface gráfica ou persistência adicional: esses itens estão fora do escopo do desafio.

`dados/`, `exemplos/` e `validador/` são os originais, sem alterações. A aprovação automática não substitui a revisão dos critérios manuais: confira os IDs distintos no retry e o trace-id no stderr. Para reproduzir manualmente, use os corpos em `exemplos/wire/` com IDs de Task e estados retornados na sua própria execução.

A auditoria requisito a requisito e as particularidades do SDK estão em [AUDITORIA.md](AUDITORIA.md). Execute também `node test-audit.mjs` para conferir os casos complementares.

## Saída do validador

Saída integral da execução após a auditoria:

```text
trace-id desta execucao: e7ea46706402ae2ac802bc53caa7b5ee
procure esse valor no stderr do servidor MCP para conferir a propagacao do traceparent.

PASS 01 tools/list traz as tres tools
PASS 02 toda tool tem inputSchema de objeto
PASS 03 listar_salas devolve structuredContent e o mesmo JSON em texto
PASS 04 _meta sem protocolVersion devolve -32602 e HTTP 400
PASS 05 _meta sem clientCapabilities devolve -32602 e HTTP 400
PASS 06 tool inexistente e recusada, por -32602 ou por isError
PASS 07 resources/read de politica://uso devolve a politica
PASS 08 resources/read de URI inexistente devolve -32602
PASS 09 sala inexistente devolve isError com a mensagem exata
PASS 10 fora da janela devolve isError com a mensagem exata
PASS 11 duracao acima de 2h devolve isError com a mensagem exata
PASS 12 intervalo invertido devolve isError com a mensagem exata
PASS 13 conflito devolve input_required com inputRequests e requestState
PASS 14 a elicitation e form mode e oferece as alternativas na ordem certa
PASS 15 conflito sem a capability elicitation devolve -32021 e HTTP 400
PASS 16 retry com inputResponses e requestState conclui a reserva
PASS 17 requestState adulterado e rejeitado com -32602
PASS 18 argumentos adulterados no retry nao tomam efeito
PASS 19 recusa conclui sem reservar e sem isError
PASS 20 conflito sem alternativa possivel devolve isError com a mensagem exata

PASS 21 agent card responde 200 no well-known com JSON
PASS 22 o card declara a interface JSON-RPC com url e versao 1.0
PASS 23 o card declara a skill reservar-sala
PASS 24 SendMessage com sala livre conclui a Task
PASS 25 o artifact chama reserva e traz a versao da politica
PASS 26 GetTask devolve id, contextId e estado corrente
PASS 27 SendMessage com sala ocupada pausa a Task
PASS 28 a Task pausada lista as alternativas na ordem certa
PASS 29 escolha fora do enum mantem a Task pausada
PASS 30 a continuacao conclui a Task na sala escolhida
PASS 31 SendMessage em Task terminal e recusado
PASS 32 a recusa termina a Task em CANCELED
PASS 33 duas Tasks pausadas ao mesmo tempo concluem cada uma com a sua reserva
PASS 34 nenhuma resposta A2A carrega o requestState
PASS 35 sala inexistente termina a Task em FAILED com a mensagem da tool
PASS 36 o agente e deterministico: o mesmo pedido produz a mesma pausa

resumo: 36 passaram, 0 falharam, de 36 verificacoes
```
