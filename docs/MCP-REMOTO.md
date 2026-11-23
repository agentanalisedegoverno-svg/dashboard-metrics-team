# MCP remoto: liberar a consulta das oportunidades para outras pessoas e outras IAs

Servidor MCP **somente leitura**, hospedado no próprio Radar. Ninguém instala nada: o agente aponta para uma URL e envia a chave de leitura.

```
Agente (Claude.ai, Copilot Studio, Claude Code, Gemini CLI, Cursor...)
   --HTTPS POST + "Authorization: Bearer rdr_..."-->  https://radar-prevendas.pages.dev/api/externo/mcp
        --> banco, pelo papel radar_leitor (só SELECT)
```

| | |
|---|---|
| **URL** | `https://radar-prevendas.pages.dev/api/externo/mcp` |
| **Autenticação** | `Authorization: Bearer rdr_...` com uma chave de **Leitura** (Administração → API) |
| **Transporte** | MCP "Streamable HTTP", sem sessão, respostas em JSON |
| **Ferramentas** | `listar_oportunidades`, `ver_oportunidade`, `listar_campos` (todas somente leitura) |
| **Dados** | todos os campos, **inclusive valores e custos internos** (decisão atual: sem "leitura restrita") |

Para quem prefere instalar localmente, existe o [servidor MCP local](../mcp/README.md) (mesmas ferramentas).

## Antes de liberar para alguém

1. **Uma chave por pessoa ou agente**, criada em Administração → API → tipo **Leitura**, com o nome de quem usa (ex.: `maria-claude`). Assim dá para revogar uma sem afetar as outras.
2. A chave aparece **uma única vez**: a pessoa guarda no cofre de senhas, nunca em chat, e-mail ou planilha.
3. Quem tem a chave vê **todos os dados**, inclusive valores e custos. Trate-a como senha.
4. Ao usar IA de terceiros (Anthropic, Microsoft, Google, OpenAI), os dados das oportunidades passam por esses provedores. Use **contas corporativas** (que, em geral, não treinam com seus dados) e confirme a política de segurança/LGPD da empresa.
5. Limite: 60 requisições por minuto por chave. Não há ainda registro de quem consultou o quê.

## Como conectar cada IA

> Os menus dos provedores mudam com frequência; use o que está abaixo como guia e confira a documentação oficial se algo não bater.

### Claude.ai (e Claude Desktop pelo conector remoto)
Configurações → Conectores → **Adicionar conector personalizado**. URL acima. Em **cabeçalhos da requisição** (opções avançadas), informe `Authorization` com o valor `Bearer rdr_SUA_CHAVE`. Em planos de equipe, normalmente o administrador do workspace adiciona o conector.

### Claude Code
```bash
claude mcp add --transport http radar-prevendas https://radar-prevendas.pages.dev/api/externo/mcp --header "Authorization: Bearer rdr_SUA_CHAVE"
```

### Microsoft Copilot Studio
Agente → Ferramentas → Adicionar ferramenta → **Model Context Protocol**. URL do servidor acima; autenticação **Chave de API**, local **Cabeçalho**, nome do cabeçalho `Authorization`, valor `Bearer rdr_SUA_CHAVE`.

### Gemini CLI, Cursor e outros clientes MCP
Qualquer cliente que aceite um servidor MCP HTTP com cabeçalho personalizado funciona: informe a URL e o cabeçalho `Authorization: Bearer rdr_SUA_CHAVE`. Os nomes dos campos variam por ferramenta (`url` ou `httpUrl`, `headers`); consulte a documentação do cliente.

### ChatGPT (usa a API, não o MCP)
Os conectores MCP do ChatGPT só aceitam **OAuth** ou **sem autenticação**; um servidor com chave fixa como este não se conecta ali (e "sem autenticação" **não** é aceitável para estes dados). O caminho é um **GPT personalizado com Actions**:

1. Criar GPT → Configurar → **Criar nova ação**.
2. Importar o esquema: colar o conteúdo de [`api-leitura.openapi.json`](api-leitura.openapi.json) (só consulta, sem a operação de criar).
3. Autenticação: **Chave de API** → tipo **Bearer** → colar a chave de leitura.
4. Compartilhar o GPT só com o workspace da empresa (nunca público).

## Teste rápido (sem agente)

```powershell
$k = Read-Host "Chave" -AsSecureString
$k = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k)).Trim()
$corpo = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
(Invoke-RestMethod "https://radar-prevendas.pages.dev/api/externo/mcp" -Method Post -ContentType application/json -Body $corpo -Headers @{ Authorization = "Bearer $k" }).result.tools.name
```
Deve listar as três ferramentas. Sem chave, 401; com chave de escrita, 403.

## Segurança do servidor

- Só POST com chave válida **de leitura** (401 sem chave, 403 com chave de escrita); GET e DELETE respondem 405.
- Consultas pelo papel `radar_leitor` (só `SELECT`): nem um erro no código consegue gravar. Não existe ferramenta de escrita.
- Os filtros usam a **mesma validação rígida** da [API de leitura](API-LEITURA.md): parâmetro desconhecido ou inválido é recusado, tudo vai como parâmetro vinculado (nunca concatenado no SQL).
- Requisição de navegador de **outro site** (cabeçalho `Origin` diferente do Radar) é recusada. Agentes chamam de servidor e não enviam `Origin`.
- Corpo de até 64 KB, páginas de até 100 itens, respostas sem cache, erros sem detalhes internos, chave nunca devolvida nem registrada.
- Testes: `functions/_lib/mcpRemoto.test.ts`, bloco "MCP remoto" em `functions/api/seguranca.test.ts` e `mcp/remoto.e2e.test.mjs` (cliente MCP oficial contra o handler).

## Revogar

Administração → API → **Revogar** a chave da pessoa. Vale na hora para todos os caminhos (REST, MCP local e MCP remoto).
