# Radar Pré-Vendas — front-end React

Reescrita do painel atual (HTML único) em **React 19 + TypeScript + Tailwind v4 + componentes no padrão shadcn/ui**, preservando 100% da usabilidade e das regras já validadas.

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Desenho completo (cadastro web, API, banco, Planner, backup, CI/CD), diagramas, modelo de dados, decisões e riscos |
| [docs/OPERACAO.md](docs/OPERACAO.md) | Configurações e segredos, rotinas, solução de problemas, troca de senhas e tokens |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Estado atual e melhorias futuras (curto, médio e longo prazo) |
| [docs/CADASTRO-OPORTUNIDADES.md](docs/CADASTRO-OPORTUNIDADES.md) | Especificação do cadastro de oportunidades na web (34 colunas, validações, UX) |
| [docs/INTEGRACAO-PLANNER.md](docs/INTEGRACAO-PLANNER.md) | Radar → Microsoft Planner: **regra de atualização do cartão**, contrato do evento, operação |
| [docs/EMAIL-NOVAS-OPORTUNIDADES.md](docs/EMAIL-NOVAS-OPORTUNIDADES.md) | E-mail a cada nova oportunidade: regras na Administração, envio por SMTP do Gmail |
| [docs/DIAGRAMAS.md](docs/DIAGRAMAS.md) | Catálogo de diagramas (19, em camadas, com SVG): contexto, fluxos, segurança e dados |
| [docs/TESTES.md](docs/TESTES.md) | Bateria de testes: regressão, segurança, carga e desempenho; como rodar e achados |
| [docs/BACKUP.md](docs/BACKUP.md) | Backup diário criptografado no Drive, restauração e teste |
| [docs/DECISAO-FIM-DA-CARGA-DA-PLANILHA.md](docs/DECISAO-FIM-DA-CARGA-DA-PLANILHA.md) | **Decisão (27/10/2026): o banco não é mais alimentado pela planilha do Excel** (a carga foi desativada e removida) |
| [docs/API-EXTERNA.md](docs/API-EXTERNA.md) | **API para outras aplicações criarem oportunidades** (chave por aplicação, campos, exemplos; atualize ao mudar um campo) |
| [docs/AGENTE-DE-CARGA.md](docs/AGENTE-DE-CARGA.md) | Histórico da carga automática da planilha (**descontinuada**) |
| [planner-auto/](planner-auto/README.md) | Ferramenta que aplica os eventos do Radar no Planner |
| [db/migrations/](db/migrations/) | Esquema, funções e privilégios do banco (migrações aditivas) |

**Em uma frase:** o Postgres (Neon) é a fonte da verdade — o time cadastra oportunidades na aba **Oportunidades** (a planilha deixou de alimentar o banco em 27/10/2026); o painel de métricas, o Microsoft Planner, os e-mails de aviso, o backup diário e o espelho no Supabase leem desse banco. As rotinas rodam no **GitHub Actions**, acionadas pelo Radar ao salvar, sem depender de computador de pessoa. Tudo atrás do Cloudflare Access (login por código no e-mail `@ctctech.com.br`).

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

## Dados: Postgres (Neon) como fonte da verdade

**Entradas:** (1) cadastro e edição na aba **Oportunidades** (API `functions/api/oportunidades/*`, regras no banco, histórico e bloqueio otimista); (a planilha `BaseLicitacao.xlsx` deixou de ser entrada em 27/10/2026).mjs` → `sincronizar_planilha`), que nunca sobrescreve o que foi editado na web. **Saídas:** painel de métricas (`GET /api/rows`), backup diário no Drive e integração com o Planner. Detalhes em [docs/ARQUITETURA.md](docs/ARQUITETURA.md) e [docs/CARGA-DE-DADOS.md](docs/CARGA-DE-DADOS.md).

**Proteção:** a API **falha fechada**: só responde com um JWT válido do **Cloudflare Access**. Sem Access configurado, devolve 503. Escritas exigem ainda o cabeçalho anti-CSRF.

| Onde | Variável | Observação |
|---|---|---|
| Cloudflare Pages → Variables and Secrets | `DATABASE_URL` (**Secret**) | papel `radar_leitor` (painel, somente leitura) |
| Cloudflare Pages → Variables and Secrets | `DATABASE_URL_APP` (**Secret**) | papel `radar_app` (cadastro; só executa as funções de cadastro) |
| `wrangler.toml` `[vars]` | `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | time `ctctech-radar` e AUD da aplicação Access (não são segredos) |
| Ambiente da integração com o Planner | `DATABASE_URL_PLANNER`, `PLANNER_EVENTOS_DIR` | papel `radar_planner` (somente leitura + controle) |
| GitHub Actions (secrets) | `DATABASE_URL_BACKUP`, `BACKUP_PASSPHRASE`, `RCLONE_DRIVE_TOKEN` | backup diário e teste de restauração |

**Acesso:** Cloudflare Access (Zero Trust, plano Free) com login por código (*One-time PIN*); política *Allow* para `@ctctech.com.br`. Perfis: **administrador** (tudo), **editor** (cadastra e edita; padrão do domínio) e **visualizador** (só consulta); **só o administrador** arquiva/restaura e gerencia listas e perfis. Para liberar outro e-mail ou domínio: Zero Trust → Access → Applications → Radar Pré-Vendas → Policies. A API valida o JWT em qualquer endereço do projeto. O flag `ACESSO_PUBLICO="true"` reabre a API sem login (uso temporário; não recomendado).

`functions/_lib/rows.ts` mantém o mapeamento do painel. (O conversor da planilha foi removido com o fim da carga: ver [a decisão](docs/DECISAO-FIM-DA-CARGA-DA-PLANILHA.md).)

> O código de login Microsoft (MSAL, `src/auth/`) segue no repositório, **desligado**: só ativa com `VITE_MS_CLIENT_ID`/`VITE_MS_TENANT_ID`, que não são definidos.

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

**Configuração única:** secrets `CLOUDFLARE_API_TOKEN` (permissão *Pages: Edit*, sem filtro de IP) e `CLOUDFLARE_ACCOUNT_ID`; `DEMO_MODE` ausente = build de produção real (API fora do ar vira erro visível). Além do pipeline há os workflows **Backup do banco** (diário) e **Teste de restauração do backup** (mensal). Opcional: `SITE_URL` (domínio próprio), revisores obrigatórios no environment `production` e proteção da `main` exigindo o check *CI ok*. **Rollback:** Actions → Pipeline → *Run workflow* com `ref` = commit/tag anterior.

## Verificação

- `npm run check` (typecheck + testes + build) e `npm run check:dist`; `npm run test:e2e` (Playwright; `npx playwright install chromium` na primeira vez).
- Os testes de paridade com o HTML legado (`parity.test.ts`) só rodam se `../radar-pre-vendas.html` existir; a regressão contínua vem dos snapshots em `src/domain/__snapshots__` (mudou regra → `vitest -u` e revisar o diff).
- ESLint não foi adicionado: `typescript-eslint` ainda não suporta TypeScript 7 (o gate de tipos é o `tsc`).

## Lacunas / próximos passos

O estado atual e as melhorias planejadas estão em [docs/ROADMAP.md](docs/ROADMAP.md). Destaques: login do Planner sem depender de pessoa (app do Entra), alertas de falha, teste de uso do espelho do Supabase como banco ativo e propagar arquivamento e mudança de torre ao Planner.
