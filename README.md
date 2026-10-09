# Radar Pré-Vendas — front-end React

Reescrita do painel atual (HTML único) em **React 19 + TypeScript + Tailwind v4 + componentes no padrão shadcn/ui**, preservando 100% da usabilidade e das regras já validadas.

> **Dados internos:** este repositório é público e não contém o dataset de produção. `public/data.json` é ignorado pelo Git; não o force no commit. O app precisa receber os dados por uma URL configurada em `VITE_DATA_URL` ou por um arquivo local, e a fonte de produção deve exigir autenticação.

## Rodar

```bash
npm install
npm run test       # regras de filtro + paridade numérica
npm run build      # typecheck + bundle de produção (dist/)
```

Para desenvolvimento, disponibilize uma cópia autorizada do dataset em `public/data.json` (não commitada) ou configure `VITE_DATA_URL` em `.env.local`:

```bash
npm run dev        # desenvolvimento
```

O endpoint aceita `[...]` ou `{ "rows": [...], "updatedAt": "..." }`. Consulte `.env.example` para a variável de URL.

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
  data/        leitura do dataset (somente leitura)
  components/  UI compartilhada (+ ui/ no padrão shadcn)
  features/    exec · inter · ops · meta · plano
```

## Verificação feita

- `tsc` sem erros e `vite build` ok.
- `npm test`: 9 testes — o `computeMetrics`/`computeMaturity` do React é **idêntico** ao do painel HTML em 5 recortes (2025, 2026, 2025+2026, 2025·ITS, 2026·No Go) e na base completa. O teste de paridade é ignorado automaticamente se o HTML legado não estiver ao lado do projeto.
- Smoke test no navegador (Chromium): filtro de Ano, "Selecionar todos" de Mês, drill-down de status e de No Go, tooltips, 5 abas e layout mobile (390 px), sem erros de console.

## Publicação no Cloudflare Pages

1. Crie um projeto **Cloudflare Pages** conectado a este repositório, com branch de produção `main`, comando `npm ci && npm run build` e diretório de saída `dist`.
2. Defina `NODE_VERSION` como `22` nas variáveis de ambiente do build.
3. Configure o **Cloudflare Access** para exigir autenticação por e-mail para o hostname de produção e todas as rotas, incluindo a URL de dados. Restrinja a política aos e-mails autorizados.
4. Não publique o dataset em um endpoint público. Se `VITE_DATA_URL` apontar para outro host, proteja esse host também e configure CORS para o domínio do painel.
5. Teste uma janela anônima: sem autenticação, tanto a página quanto a URL de dados devem negar acesso. Verifique também que o domínio `pages.dev` não permita contornar a proteção aplicada ao domínio customizado.

`public/_headers` aplica headers básicos de segurança. HTTPS é fornecido pelo Cloudflare Pages. O dataset não é parte do deploy deste repositório; configure uma origem de dados autenticada antes de liberar o painel.

## Próximos passos

- Definir e provisionar a origem autenticada do dataset em produção.
- A aba Metodologia ainda descreve a atualização como "disparo manual", fiel ao processo atual; ajustar o texto se o fluxo mudar.
- Testes de componente (Testing Library) e e2e (Playwright) ainda não foram adicionados.
