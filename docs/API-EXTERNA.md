# API externa: criar oportunidades a partir de outra aplicação

Uma aplicação externa cria oportunidades no Radar Pré-Vendas **como se fosse um cadastro manual**: mesmos campos, mesmas validações e o mesmo fluxo (histórico, **e-mail de nova oportunidade** e **cartão no Planner**). A diferença é a autoria: a oportunidade fica registrada como criada por `api:<nome-da-aplicação>` e, se a aplicação informar, com o **solicitante** (quem pediu lá no sistema de origem).

> ## ⚠️ Lembrete para quem mexe no Radar
> **Mudou um campo da oportunidade (criou, renomeou, removeu ou alterou regra)? Atualize a API também.**
> 1. O catálogo `GET /api/externo/campos` já sai de `src/features/oportunidades/campos.ts`, mas **esta página é escrita à mão**: atualize a tabela de campos abaixo. Um teste (`functions/_lib/apiExterna.test.ts`) **falha** se algum campo do formulário não estiver aqui.
> 2. Se o campo for novo no banco, confira a migração (`criar_oportunidade`) e o esquema Zod (`src/domain/oportunidade.ts`): a API usa os dois.
> 3. **Avise as aplicações que usam a API** (campo novo obrigatório quebra quem não o envia) e registre a mudança no [histórico](#histórico-de-mudanças) no fim.

## Como conectar

1. Um **administrador do Radar** abre *Administração → API*, informa o nome da aplicação (ex.: `sistema-contratos`) e clica em **Criar chave**. A chave (`rdr_...`) aparece **uma única vez**: guarde em cofre de senhas. O banco guarda só o hash; não é possível recuperá-la depois (se perder, revogue e crie outra).
2. A aplicação envia a chave em todas as chamadas: `Authorization: Bearer rdr_...` (alternativa: cabeçalho `x-api-key`).
3. Para desligar uma aplicação, o administrador **revoga** a chave na mesma tela (efeito imediato).

**Base:** `https://radar-prevendas.pages.dev/api/externo`

> **Cloudflare Access:** o Radar fica atrás do Cloudflare Access (login por e-mail), que uma aplicação não consegue atravessar. Para a API funcionar, o administrador do Cloudflare precisa criar uma regra do tipo **Bypass** só para o caminho `/api/externo/*` (veja [OPERACAO.md](OPERACAO.md)). Sem essa regra a chamada recebe um redirecionamento (302) para a tela de login. A proteção desse caminho passa a ser a chave da API; recomenda-se também uma regra de limite de requisições (*rate limiting*) no Cloudflare para ele.

## Endpoints

### `POST /api/externo/oportunidades`: cria uma oportunidade

- **Corpo (JSON):** os campos da oportunidade (tabela abaixo; só os obrigatórios são exigidos) mais, opcionalmente, `solicitante` (texto, até 120 caracteres).
- **Cabeçalho opcional `Idempotency-Key`** (1 a 100 caracteres): se a aplicação repetir a chamada com a mesma chave (por timeout, por exemplo), o Radar devolve **a mesma oportunidade, sem duplicar** nem reenviar e-mail/cartão. Use um identificador do pedido na origem.
- **Limite do corpo:** 64 KB.

Exemplo:

```bash
curl -X POST https://radar-prevendas.pages.dev/api/externo/oportunidades \
  -H "Authorization: Bearer $CHAVE_RADAR" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pedido-2026-000123" \
  -d '{
    "solicitante": "Maria Souza (Contratos)",
    "status": "Prospect",
    "orgao": "Prefeitura de Exemplo",
    "descritivo": "Link dedicado de 1 Gbps",
    "data_pregao_dt": "2026-12-10",
    "hora_pregao": "10:00",
    "processo": "45/2026",
    "uf": "DF",
    "linha_servico": "Conectividade",
    "analista": "Ana",
    "orcamento": 120000.50,
    "duracao_contrato_meses": 24
  }'
```

**Respostas**

| Código | Quando | Corpo |
|---|---|---|
| `201` | Oportunidade criada | a oportunidade (`id`, `codigo` `AAAA-NNNN`, `versao`, `criado_por`, `solicitante`, todos os campos) e `avisos` (ex.: possível duplicata) |
| `200` | Repetição com a mesma `Idempotency-Key` | a oportunidade já criada, com `"idempotente": true` |
| `400` | Corpo que não é um objeto JSON | `{ "error": "..." }` |
| `401` | Chave ausente, inválida ou revogada | `{ "error": "..." }` |
| `413` | Corpo acima de 64 KB | `{ "error": "..." }` |
| `422` | Dados inválidos | `{ "error": "Dados inválidos.", "erros": [{ "campo": "...", "mensagem": "..." }] }` |
| `502`/`503` | Falha do servidor ou do banco | `{ "error": "..." }` (pode repetir com a mesma `Idempotency-Key`) |

### `GET /api/externo/campos`: catálogo dos campos

Devolve os campos aceitos (nome, rótulo, seção, formato, se é obrigatório), as **opções válidas das listas** (`valores`, sempre atuais, pois o administrador as edita no Radar), os campos extras (`solicitante`) e as regras. **Consulte este endpoint em vez de fixar listas no código da aplicação.**

## O que acontece depois de criar (igual ao cadastro manual)

1. O Radar valida e grava (as validações são as do banco: obrigatórios, listas, regras por status, datas, valores).
2. Gera o **código** `AAAA-NNNN` e o histórico (quem: `api:<aplicação>`).
3. Se o módulo de e-mails estiver ligado e o status for um dos marcados, entra o **aviso de nova oportunidade** na fila (todas as informações, mais *Cadastrada por* `api:<aplicação>` e *Solicitante (via API)*).
4. O Radar aciona na hora o envio do e-mail e o **cartão no Planner** (em cerca de 1 minuto), pelos mesmos workflows do cadastro manual. O responsável do cartão vem de `analista`.

## Campos

Mesmos campos do formulário *Nova oportunidade*. Nomes em `snake_case`, exatamente como abaixo. Campos desconhecidos são ignorados. Valores vazios (`""`) viram "não informado".

| Campo | Seção | Obrigatório | Formato | Observação |
|---|---|---|---|---|
| `status` | Identificação | **sim** | texto: um dos valores da lista indicada (lista `status`) | Status |
| `sigla` | Identificação | não | texto | Sigla. Até 20 caracteres |
| `orgao` | Identificação | **sim** | texto | Instituição / Órgão |
| `descritivo` | Identificação | **sim** | texto (pode ter várias linhas) | Descritivo. Até 60 caracteres (resumo curto); o detalhe vai em Objeto |
| `objeto` | Identificação | não | texto (pode ter várias linhas) | Objeto. O que está sendo contratado |
| `processo` | Identificação | não | texto | Processo/Pregão |
| `uasg` | Identificação | não | texto | UASG |
| `uf` | Identificação | não | texto: um dos valores da lista indicada (lista `uf`) | UF |
| `data_distribuicao` | Edital e disputa | não | data no formato AAAA-MM-DD | Data de distribuição (envio do edital). Se omitida, fica em branco (o formulário web preenche com o dia) |
| `data_pregao_dt` | Edital e disputa | **sim** | data no formato AAAA-MM-DD | Data do pregão |
| `hora_pregao` | Edital e disputa | não | hora HH:MM (horário de Brasília) | Hora do pregão |
| `criterio` | Edital e disputa | não | texto: um dos valores da lista indicada (lista `criterio`) | Critério |
| `modalidade` | Edital e disputa | não | texto: um dos valores da lista indicada (lista `modalidade`) | Modalidade |
| `duracao_contrato_meses` | Edital e disputa | não | número inteiro | Duração do contrato (meses). De 1 a 600 |
| `modo_disputa` | Edital e disputa | não | texto: um dos valores da lista indicada (lista `modo_disputa`) | Modo de disputa |
| `origem_oportunidade` | Edital e disputa | não | texto: um dos valores da lista indicada (lista `origem_oportunidade`) | Origem |
| `site` | Edital e disputa | não | texto: um dos valores da lista indicada (lista `site`) | Site |
| `vistoria` | Edital e disputa | não | texto: um dos valores da lista indicada (lista `vistoria`) | Vistoria |
| `linha_servico` | Escopo e responsável | não | texto: um dos valores da lista indicada (lista `linha_servico`) | Linha de serviço (define a torre) |
| `torre` | Escopo e responsável | sim, se `linha_servico` não for enviada | texto: um dos valores da lista indicada (lista `torre`) | Torre. Calculada pela linha de serviço quando ela é enviada |
| `unidade_fornecimento` | Escopo e responsável | não | texto: um dos valores da lista indicada (lista `unidade_fornecimento`) | Unidade de fornecimento |
| `conta_vinculada` | Escopo e responsável | não | texto: um dos valores da lista indicada (lista `conta_vinculada`) | Conta vinculada |
| `analista` | Escopo e responsável | não | texto: nome(s) de pré-vendas ativos, separados por vírgula | Pré-vendas (vira o responsável do cartão do Planner) |
| `orcamento` | Valores e margens | não | número em reais, com ponto decimal (ex.: 1234.56) | Orçamento (R$) |
| `orcamento_sigiloso` | Valores e margens | não | true ou false | Orçamento sigiloso (esconde o valor no e-mail e no Planner) |
| `valor_ctc` | Valores e margens | sim, se status = Win | número em reais, com ponto decimal (ex.: 1234.56) | Valor CTC (R$) |
| `custo_total_ctc` | Valores e margens | não | número em reais, com ponto decimal (ex.: 1234.56) | Custo total CTC (R$) |
| `mc_ctc` | Valores e margens | não | fração (0.185 = 18,5%) | MC CTC |
| `simulacao_mc_arrematante` | Valores e margens | não | fração (0.185 = 18,5%) | Simulação da MC × arrematante |
| `impostos` | Valores e margens | não | fração (0.0865 = 8,65%) | Impostos |
| `valor_vencedor` | Resultado do certame | não | número em reais, com ponto decimal (ex.: 1234.56) | Valor vencedor (R$) |
| `empresa_vencedora_cnpj` | Resultado do certame | não | 14 dígitos (com ou sem máscara) | Empresa vencedora. A razão social e matriz/filial vêm da Receita |
| `posicao_lance` | Resultado do certame | não | número inteiro | Posição pós-lance CTC |
| `situacao_lance` | Resultado do certame | não | texto: um dos valores da lista indicada (lista `situacao_lance`) | Situação do lance (use quando não há posição) |
| `motivo_lost` | Resultado do certame | sim, se status = Lost | texto: um dos valores da lista indicada (lista `motivo_lost`) | Motivo do Lost |
| `motivo_no_go` | Resultado do certame | sim, se status = No Go | texto: um dos valores da lista indicada (lista `motivo_no_go`) | Motivo do No Go |
| `detalhe_no_go` | Resultado do certame | não | texto (pode ter várias linhas) | Detalhe do No Go (só faz sentido em No Go) |
| `observacoes` | Acompanhamento | não | texto (pode ter várias linhas) | Acompanhamento / status / observações |

Extra da API: `solicitante` (texto, até 120 caracteres, opcional): quem pediu a criação na aplicação externa.

**Regras além do formato:** `status`, `orgao`, `descritivo` e `data_pregao_dt` são obrigatórios; `data_pregao_dt` não pode ser anterior a `data_distribuicao`; campos de lista só aceitam valores cadastrados e ativos; `analista` só aceita pré-vendas ativos; valores monetários não podem ser negativos. Os valores válidos de cada lista estão em `GET /api/externo/campos`.

## Segurança e operação

- **Chaves:** uma por aplicação, 256 bits, guardadas só como hash (SHA-256). Revogação imediata. O administrador vê quando cada uma foi usada pela última vez.
- **Autoria:** nada que a aplicação envie altera `criado_por` (sempre `api:<aplicação>`, definido pelo servidor a partir da chave).
- **Sem navegador:** a API não usa cookies nem CORS; chame sempre de servidor para servidor, nunca do navegador do usuário (a chave ficaria exposta).
- **Falhas e repetição:** em `5xx` ou timeout, repita com a **mesma** `Idempotency-Key`.
- **Log:** o Radar não registra o conteúdo das requisições.

## Histórico de mudanças

| Data | Mudança |
|---|---|
| 28/10/2026 | Versão inicial: `POST /api/externo/oportunidades`, `GET /api/externo/campos`, chaves por aplicação, idempotência e solicitante. |
