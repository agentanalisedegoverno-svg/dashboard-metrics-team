# API de leitura: consultar as oportunidades (somente visualização)

Para **agentes, relatórios e outras aplicações** que só precisam **ver** as oportunidades do Radar. Não altera nada: a chave de leitura não cria, não edita e não arquiva. Devolve **todos os dados** de cada oportunidade (os mesmos campos da tela, inclusive valores internos da CTC), então **trate a chave como senha** e entregue só a quem pode ver tudo.

> A API de **criação** (`POST`) é outra chave, de **escrita**: [API-EXTERNA.md](API-EXTERNA.md). Uma chave nunca faz o que é da outra (leitura recebe `403` ao tentar criar; escrita recebe `403` ao tentar consultar).

## Guia rápido

| | |
|---|---|
| **URL base** | `https://radar-prevendas.pages.dev/api/externo` |
| **Autenticação** | `Authorization: Bearer rdr_...` com uma chave de **leitura** (criada por um administrador em *Administração → API*, escolhendo o tipo **Leitura**) |
| **Listar** | `GET /oportunidades` (paginado, com filtros) |
| **Uma oportunidade** | `GET /oportunidades/{codigo}` (código `AAAA-NNNN` ou id numérico) |
| **Campos e listas válidas** | `GET /campos` (aceita chave de leitura ou de escrita) |
| **Erros** | `401` chave inválida/revogada · `403` chave de escrita (use a de leitura) · `404` não encontrada · `422` parâmetro inválido ou desconhecido (lista `erros`) · `429` limite de 60 por minuto · `503` banco de consulta indisponível |
| **Especificação** | [api-externa.openapi.json](api-externa.openapi.json) |
| **Chamar de onde** | sempre de servidor ou agente (nunca de navegador público: a chave ficaria exposta) |

## `GET /oportunidades`

Resposta:

```json
{ "total": 250, "limite": 100, "offset": 0, "proximo_offset": 100, "itens": [ { "id": 1, "codigo": "2026-0001", "status": "Go", "orgao": "...", "orcamento": 1500000, "valor_ctc": 0, "...": "todos os campos" } ] }
```

`proximo_offset` é `null` na última página. A ordem é por `id`.

| Parâmetro | Significado |
|---|---|
| `q` | busca de texto em código, sigla, órgão, processo, descritivo, objeto, UASG, pré-vendas e linha de serviço |
| `status`, `torre`, `uf`, `linha_servico`, `segmento` | igualdade (sem diferenciar maiúsculas) |
| `analista`, `orgao` | contém o texto |
| `pregao_de`, `pregao_ate` | data do pregão, `AAAA-MM-DD` |
| `valor_min`, `valor_max` | orçamento em reais, com ponto decimal (`1500000.50`). Com faixa, oportunidade sem valor ou de orçamento sigiloso não entra |
| `atualizado_desde` | só o que mudou desde essa data/hora ISO (para sincronizar) |
| `arquivadas` | `true` inclui as arquivadas (por padrão ficam de fora) |
| `limite` | de 1 a 500 (padrão 100) |
| `offset` | a partir de qual item (padrão 0) |

Parâmetro desconhecido ou repetido é **recusado** (`422`), para um erro de digitação não virar "devolva tudo".

```bash
curl -s "https://radar-prevendas.pages.dev/api/externo/oportunidades?status=Go&valor_min=1000000&limite=50" \
  -H "Authorization: Bearer $CHAVE_RADAR_LEITURA"
```

## Como conectar a um agente

1. O administrador cria a chave em *Administração → API* (nome da aplicação, tipo **Leitura**) e guarda em cofre de senhas. Ela aparece uma única vez.
2. Configure no agente a URL base e o cabeçalho `Authorization: Bearer ...`. Para agentes com **MCP**, use o servidor em [`mcp/`](../mcp/README.md) (quando publicado), que só repassa estas consultas.
3. Para desligar, o administrador **revoga** a chave (efeito imediato).

## Como é protegida

- **Escopo da chave** conferido a cada chamada (leitura x escrita).
- **Papel do banco só de leitura** (`radar_leitor`, apenas `SELECT`): mesmo um erro no código não consegue gravar.
- **Parâmetros vinculados** (nada de SQL montado por texto) e validação estrita de cada filtro.
- Chave guardada só como hash; limite de requisições por IP e por chave; respostas sem cache (`private, no-store`).
- O Cloudflare Access tem **Bypass** só para `/api/externo/*` (a chave é a proteção desse caminho).

## Publicação (ordem)

A migração `029_api_leitura_escopo.sql` aplica-se sozinha ao mergear na `main` (workflow *Migrar banco*). O código tolera o intervalo entre migração e deploy: chaves antigas seguem criando oportunidades.

## Histórico de mudanças

| Data | Mudança |
|---|---|
| 23/11/2026 | Versão inicial: `GET /oportunidades` e `GET /oportunidades/{codigo}`, chaves com escopo leitura/escrita. |