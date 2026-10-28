# Testes: regressão, carga, desempenho e segurança

A bateria completa roda **sem tocar na produção**: o banco dos testes é um Postgres em memória (PGlite) criado do zero com `db/schema.sql` e as migrações `db/migrations/*.sql`, na mesma ordem e com o mesmo separador (`;;`) usados em produção. Isso também prova, a cada execução, que o banco pode ser reconstruído do zero.

> **Estado (28/10/2026):** 441 testes unitários e de banco, os e2e (desktop e celular) e os 15 de carga, todos passando. O banco de teste aplica as migrações 001 a 019. A verificação do Planner na nuvem (`planner-integracao.yml` com *verificar*) confere o login e as colunas sem gravar. Dependências de produção: 0 vulnerabilidades.

## Como rodar

| Comando | O que roda | Quando |
|---|---|---|
| `npm test` | unitários + banco (regressão e segurança) + segurança estática | todo PR (CI, job *quality*) |
| `npm run test:e2e` | Playwright, desktop e celular: funcional, acessibilidade, desempenho do front, segurança no navegador | todo PR (CI, job *e2e*) |
| `npm run check` | tipos + `npm test` + build | local, antes do PR |
| `npm run test:banco` | só o banco (regressão + segurança) | ao mexer em migração |
| `npm run test:seguranca` | segurança: banco, API, estática e navegador | ao mexer em permissão/API |
| `npm run test:desempenho` | desempenho do front (1 navegador por vez, tempos mais fiéis) | ao mexer na grade |
| `node scripts/teste-api-externa.mjs` | roteiro ponta a ponta da API externa contra o ambiente real (precisa de `RADAR_API_CHAVE`; `--sem-criar` não cria nada) | antes de liberar uma aplicação nova |
| `npm run test:carga` | carga do banco e da API (leva ~1 min) | semanal (workflow) e sob demanda |
| `npm run test:seguranca:externo` | sondagem do site em produção, **sem login** | semanal (workflow) e após mudar o Access |
| `npm run medir:banco` | latência do banco real (só leitura; precisa `DATABASE_URL`) | sob demanda |

O workflow [`Testes de carga e segurança`](../.github/workflows/testes-nao-funcionais.yml) roda toda segunda-feira (e sob demanda): carga, sondagem externa e latência do banco real. Falha ⇒ o GitHub avisa por e-mail. `BUDGET_FATOR=2` dobra os orçamentos de tempo (máquina lenta).

## O que cada camada cobre

### Regressão (`db/testes/regressao.test.ts`, 42 testes)
Regras de negócio e bugs já corrigidos, contra o banco criado do zero: migrações aplicam em ordem e são idempotentes; código `AAAA-NNNN` por ano, imutável e fora do histórico; torre calculada pela linha; todas as validações (obrigatórios, listas fechadas, No Go/Lost/Win, sigilo, datas, margens, **impostos**, CNPJ, unidade, pré-vendas); descritivo sem limite de 300; edição concorrente (P0409); perfis (visualizador, editor, administrador); usuários (último administrador, autoalteração); histórico; **carga da planilha** (merge idempotente, não sobrescreve edição da web, ausentes, carga antiga revogada, não mexe em Impostos); **e-mail** (fila só para web + ligado + status marcado, edição não duplica, planilha nunca envia, falha do gatilho não derruba o cadastro).
Somam-se a elas os testes unitários de `src/` e `functions/` e os e2e funcionais (`e2e/oportunidades.spec.ts`, `painel.spec.ts`, `tema.spec.ts`).

### Segurança
- **Banco** (`db/testes/seguranca.test.ts`): matriz completa de privilégios de tabela por papel (`radar_leitor`, `radar_escritor`, `radar_app`, `radar_planner`, `radar_email`: exatamente o permitido, nada além); nenhuma função executável por `PUBLIC` além das inofensivas, e **toda função nova sem política definida faz o teste falhar**; `search_path` fixo em toda função `SECURITY DEFINER`; papéis em ação com privilégios reais (a aplicação não escreve direto nas tabelas, o papel de e-mail só atualiza a fila, a carga só executa o merge); **escalonamento** (nenhum papel de banco vira administrador chamando as funções com o e-mail de um administrador); SQL injection; campos desconhecidos ignorados (sem atribuição em massa); histórico imutável pela aplicação.
- **API** (`functions/api/seguranca.test.ts`, 95 testes): descobre **todas as rotas** sozinha e aplica a cada uma: sem identidade válida nada passa (401), falha fechada sem Access (503), token sem e-mail recusado, CSRF (cabeçalho e `Origin`), rotas de administração (403), identidade sempre do login (nunca do corpo), validação (JSON inválido, tipos, limites, `__proto__`, ids e CNPJ com injeção), métodos (405), cabeçalhos (`no-store`) e **sem vazamento** de string de conexão, SQL ou stack em erros.
- **Estática** (`src/seguranca-estatica.test.ts`, 37 testes): CSP restrita (sem `unsafe-eval`, sem script inline), cabeçalhos (`X-Frame-Options`, HSTS, `nosniff`, noindex), actions do GitHub presas a commit, permissões mínimas, sem `pull_request_target`, sem texto livre do evento em shell, sem segredos no repositório (conexões com senha, chaves, tokens), planilhas e `.dev.vars` fora do Git, sem `eval`/`innerHTML`/`dangerouslySetInnerHTML`, armazenamento do navegador só com o tema, lockfile só do registro oficial com integridade.
- **Navegador** (`e2e/seguranca.spec.ts`): texto hostil vindo da API (HTML, `<script>`, `javascript:`) aparece como texto na grade, na gaveta, no histórico e na Administração; endereço (`#hash`) e armazenamento adulterados; nada sensível em armazenamento/cookies; nenhuma chamada a servidor externo; acessibilidade com dados hostis.
- **Externa** (`scripts/teste-seguranca-externa.mjs`, 39 verificações): como um desconhecido na internet: nenhuma página nem API responde sem login (todas redirecionam ao Access), JWT forjado não passa, arquivos sensíveis (`.git`, `.env`, `wrangler.toml`, SQL, `.map`, planilha) não aparecem, HTTP redireciona para HTTPS, CORS fechado, `TRACE`/`CONNECT` recusados.

### Carga e desempenho (`npm run test:carga`)
Volume muito acima do real (hoje ~650 oportunidades): 2.000 cadastros pela web (2,2 ms cada), 200 simultâneos sem repetir código, listagem de 2.200 linhas (0,17 s), 300 edições na mesma oportunidade, carga de 3.000 linhas da planilha (0,5 s), 500 requisições simultâneas à API, 20.000 validações, resposta de 5.000 oportunidades (6,6 MB), corpo de 5 MB recusado, fila de e-mail em lotes de 50. Os orçamentos ficam de 5 a 50 vezes acima do medido: pegam regressão grande, sem falso alarme.
No navegador (`e2e/desempenho.spec.ts`, 5.000 linhas): abre em ~1,2 s, só desenha as linhas visíveis (virtualização), busca em ~0,2 s, memória de 25 MB, nenhuma tarefa longa travando a tela, 533 kB de JS na abertura. O bundle de produção segue com orçamento próprio (`npm run check:dist`).

## Achados desta bateria

| # | Achado | Gravidade | Situação |
|---|---|---|---|
| 1 | `salvar_usuario` (7 parâmetros, criada na migração 006) ficou executável por **qualquer papel de banco**; a função confia no e-mail do administrador recebido como argumento, então uma credencial de banco vazada, mesmo só de leitura, permitiria virar administrador do Radar. Pela API nunca foi explorável (o e-mail vem do login verificado). | Alta (exige credencial do banco) | **Corrigido**: migração 011, aplicada em produção em 24/10/2026; o teste de segurança impede reincidência |
| 2 | Texto com caractere nulo (`\u0000`) devolvia erro 502 em vez de 422 | Baixa | **Corrigido** em `erroBanco` |
| 3 | `.gitignore` não cobria `.dev.vars` (segredos locais do Wrangler) nem planilhas `.xlsx` (dados reais) | Baixa | **Corrigido** |
| 4 | Endereços de pré-visualização (`pr-N.radar-prevendas.pages.dev`) são públicos: entregam só a casca do site e 12 linhas de demonstração; a API responde 401 e os cabeçalhos de segurança estão ativos | Baixa | **Recomendação:** estender o aplicativo do Cloudflare Access para `*.radar-prevendas.pages.dev` |
| 5 | `npm audit` (com dependências de desenvolvimento) aponta `undici` ≤ 7.30 via `wrangler → miniflare` (DoS e bypass de SRI). Produção: 0. Não há versão corrigida nem no `wrangler` mais recente | Baixa (ferramenta de desenvolvimento/deploy, sem conteúdo não confiável) | **Risco aceito**; reavaliar a cada atualização do `wrangler` |
| 6 | A latência medida do banco real a partir de uma máquina de desenvolvimento varia de 0,25 a 2,4 s para a listagem completa (1 MB de JSON), embora o banco a execute em 18 ms: o tempo é de rede/transferência | Informativa | **Observação**; se a lista crescer, enxugar as colunas pesadas da listagem (`detalhe_no_go`, `chave_planilha`, datas internas) |

## Como manter
- Função nova no banco ⇒ o teste de segurança exige declarar quem pode executá-la (e falha enquanto você não declarar).
- Rota nova em `functions/api` ⇒ entra sozinha nas verificações de autenticação, CSRF, métodos e vazamento; revise a lista esperada em `descoberta de rotas`.
- Migração nova ⇒ `npm run test:banco` a aplica do zero e reaplica (idempotência).
- Orçamento de tempo estourado em máquina lenta ⇒ `BUDGET_FATOR=2`; se estourar em máquina normal, é regressão: investigue antes de afrouxar.
