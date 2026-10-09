# Radar Pré-Vendas — front-end React

Reescrita do painel atual (HTML único) em **React 19 + TypeScript + Tailwind v4 + componentes no padrão shadcn/ui**, preservando 100% da usabilidade e das regras já validadas.

## Rodar

```bash
npm install
npm run mock:api   # terminal 1: API local de demonstração (somente loopback)
npm run dev        # terminal 2: painel em http://localhost:5173
npm run test       # regras de filtro + paridade numérica com o painel HTML
npm run build      # typecheck + bundle de produção (dist/)
```

No desenvolvimento, o Vite encaminha `/api` para `http://127.0.0.1:8000`. O painel tenta primeiro `GET /api/rows` e, se a API estiver indisponível, usa o arquivo de fallback configurado em `VITE_DATA_URL`. A resposta aceita `[...]` ou `{ "rows": [...], "updatedAt": "..." }`.

`public/data.json` contém exclusivamente linhas **sintéticas** para demonstração. A base real não deve ser colocada em `public/`, no bundle, nem no Git. Para mantê-la neste clone local, use `.local/data.json` (já ignorado pelo Git); não a sirva pelo Vite ou por um host público.

O mock oferece `GET /api/rows`, `GET /api/status` e `POST /api/sync`. O botão do painel apenas relê o mock e atualiza o cache; ele não acessa nem altera o SharePoint. O status mostra explicitamente “API de demonstração”.

## Regras que não mudam (herdadas do painel)

- **Somente leitura**: este front nunca grava na planilha original (`BaseLicitacao`). Só consome o dataset já calculado.
- **Datas**: Ano e Mês derivam de **Data Pregão**.
- **Ano obrigatório**: sem Ano selecionado o painel abre em branco (sem métricas).
- **Mês é filho de Ano** (cascata); filtros com "Selecionar todos / Desmarcar todos" estilo Excel (tri-state).
- **Drill-down** (Processo / Órgão / Descritivo) nos cards de status e nos motivos de No Go.
- Ícone "i" com explicação curta em cada KPI de Pipeline financeiro e Competitividade & conversão.
- **Coluna "Ação IA"**: não é tratada aqui. O schema apenas a repassa (`acaoIA`); nenhuma métrica ou gráfico é construído sobre ela.

## Stack e por quê

| Camada | Escolha | Motivo / trade-off |
|---|---|---|
| Build | Vite | HMR rápido, build simples; sem SSR (painel interno, dados já prontos). |
| UI | Tailwind v4 + Radix (Popover, Dialog, Tabs, Checkbox) em `components/ui/*` no padrão shadcn | Acessibilidade (foco, Esc, ARIA) pronta; código dentro do repo, sem dependência de CLI. |
| Estado | Zustand (filtros, drill) | Pequeno, sem Provider; seletores evitam re-render. |
| Dados | TanStack Query + Zod | Cache, retry, revalidação ao focar a aba; Zod valida o contrato na borda. |
| Gráficos | Barras CSS + donut SVG próprios | Zero dependência extra; Recharts só se surgirem séries temporais/tooltips ricos. |
| Fontes | `@fontsource` (self-hosted) | Sem chamada a Google Fonts; mesma tipografia do painel. |

## Performance

- Métricas calculadas **uma vez** por mudança de filtro (`useMemo`) com `useDeferredValue`: checkboxes respondem na hora, o recálculo vem em seguida.
- Abas Metodologia e Plano de Ação em `React.lazy` (fora do bundle inicial).
- Componentes de lista/gráfico em `memo`; linhas do drill-down com `content-visibility: auto`.
- Build atual: JS inicial ≈ 494 kB (≈ 154 kB gzip), CSS ≈ 8 kB gzip. Maior peso: React + Radix + Zod.

## Estrutura

```
src/
  domain/      regras puras (filters, metrics, maturity, plano, types) — testáveis
  store/       zustand (filters, drill)
  data/        leitura API-first com fallback e validação Zod
  components/  UI compartilhada (+ ui/ no padrão shadcn)
  features/    exec · inter · ops · meta · plano
scripts/
  mock-api.mjs API local de demonstração, sem dependências adicionais
```

## Segurança e publicação

- O repositório e o build não devem conter a planilha interna nem credenciais. `.local/`, `.env*` (exceto `.env.example`), `dist/` e arquivos temporários estão ignorados.
- `public/_headers` aplica headers de segurança ao site estático. `wrangler.toml` configura a saída `dist/` para Cloudflare Pages.
- O workflow em `.github/workflows/ci.yml` executa `npm ci`, testes e build em pushes e pull requests.
- Para publicar manualmente: `npm run build` e `npx wrangler pages deploy dist`. Crie o projeto Pages e autentique o Wrangler antes da publicação.
- Cloudflare Access precisa ser habilitado no painel Cloudflare para proteger o site por e-mail. Se a API real usar outro host, ela também precisa exigir autenticação; proteger somente o frontend não protege os dados.
- O backend real de leitura do SharePoint permanece pendente de configuração do tenant, app registration, permissões Graph e URL do workbook. Não configure esses valores em arquivos versionados; use variáveis/segredos no ambiente de execução.

## API real (Cloudflare Pages Functions → Microsoft Graph)

`functions/api/[[path]].ts` serve `GET /api/rows`, `GET /api/status` e `POST /api/sync` (somente leitura do workbook; `sync` apenas invalida o cache de 5 min). Toda chamada exige o JWT do **Cloudflare Access** (`functions/_lib/access.ts`) — sem token válido a resposta é 401, e sem configuração é 503.

Variáveis (Pages → Settings → Environment variables; segredos como *Secret*, nunca no Git):

| Variável | Descrição |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` | domínio do time Zero Trust e AUD da aplicação Access |
| `GRAPH_TENANT_ID` / `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | app registration (client credentials) com `Sites.Read.All`/`Files.Read.All` (Application) |
| `GRAPH_DRIVE_ID` / `GRAPH_ITEM_ID` | drive e item do workbook `BaseLicitacao` |
| `GRAPH_SHEET_NAME` | opcional, padrão `Base Governo` |

O mapeamento de colunas (`functions/_lib/rows.ts`) é por nome de cabeçalho (sem acento/caixa) e falha de forma explícita se `Status`/`Data Pregão` mudarem. **Pendente de validação com a planilha real** (nenhuma credencial foi usada nesta entrega).

## Esteira CI/CD (`.github/workflows`)

`pipeline.yml` (PR, push na `main`, `workflow_dispatch`) chama `ci.yml` e depois publica:

| Etapa | O que garante |
|---|---|
| quality | `tsc`, Vitest com cobertura (regras, snapshots de métricas, mapeador Graph, validação do JWT) |
| build | build de produção + `check:dist` (orçamento de bundle e **bloqueio de dados reais em `dist/`**) |
| e2e | Playwright desktop + mobile, console sem erros, axe WCAG A/AA (claro e escuro), sem rolagem horizontal |
| audit | `npm audit` (prod, high) + assinaturas de pacotes; revisão de dependências no PR |
| ci-ok | gate único para proteção de branch |
| preview | cada PR vira `https://pr-N.radar-prevendas.pages.dev` com comentário automático |
| production | `main` → Cloudflare Pages (environment `production`), smoke test (200, headers, API não pública) |
| codeql / dependabot | análise estática semanal e atualizações agrupadas (actions fixadas por SHA) |

**Configuração única:** secrets `CLOUDFLARE_API_TOKEN` (permissão *Pages: Edit*) e `CLOUDFLARE_ACCOUNT_ID`; variável `DEMO_MODE=true` enquanto a integração SharePoint não existe (publica com banner de dados sintéticos; remova para o modo real, em que API fora do ar vira erro visível). Opcional: `SITE_URL` (domínio próprio), revisores obrigatórios no environment `production` e proteção da `main` exigindo o check *CI ok*. **Rollback:** Actions → Pipeline → *Run workflow* com `ref` = commit/tag anterior.

## Verificação

- `npm run check` (typecheck + testes + build) e `npm run check:dist`; `npm run test:e2e` (Playwright; `npx playwright install chromium` na primeira vez).
- Os testes de paridade com o HTML legado (`parity.test.ts`) só rodam se `../radar-pre-vendas.html` existir; a regressão contínua vem dos snapshots em `src/domain/__snapshots__` (mudou regra → `vitest -u` e revisar o diff).
- ESLint não foi adicionado: `typescript-eslint` ainda não suporta TypeScript 7 (o gate de tipos é o `tsc`).

## Lacunas / próximos passos

1. Validar `functions/` com a planilha real (app registration, IDs, nomes de coluna) e configurar o Cloudflare Access.
2. A aba Metodologia ainda descreve a atualização como "disparo manual".
3. Opcional: colapsar os chips de filtro quando todos os meses estão marcados.
4. Adotar ESLint quando `typescript-eslint` suportar TS 7.
