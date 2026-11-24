# Diagnóstico de erros do painel e da API

Quando um usuário vê "Não foi possível carregar os dados" (ou um 503/502), o Radar agora diz **de onde veio o erro** e deixa **rastro no log**.

## 1. O usuário: "Detalhes técnicos para o suporte"

No aviso de erro há um bloco **Detalhes técnicos para o suporte** com a rota, o status, a **origem**, o tempo, o **código da requisição** e o **cf-ray**, e o botão **Copiar diagnóstico completo**. O botão copia um relatório (navegador, falhas recentes e o diagnóstico feito no servidor) para colar no chamado.

## 2. Origem do erro: o cabeçalho `x-radar-origem`

Toda resposta gerada pelo código do Radar (`/api/*`) leva:

| Cabeçalho | Significa |
|---|---|
| `x-radar-origem: funcao` | a resposta foi gerada pelo Radar |
| `x-radar-req: a1b2c3d4` | código da requisição: procure no log |
| `server-timing` | tempo total (`app`) e etapa (em `/api/rows`: `consulta`, com a contagem de linhas e o tamanho da resposta; em `/api/status`: `status`) |

**Regra de ouro:** um erro **sem** `x-radar-origem` **não foi gerado pelo Radar**. Veio do Cloudflare (Access, limites do Worker, queda da plataforma) ou da rede do usuário (proxy, firewall, VPN).

| O que o relatório mostra | Causa provável | Onde olhar |
|---|---|---|
| `origem: fora-do-radar`, corpo em HTML (ex.: "Error 1102") | Worker passou do limite de CPU/memória (o Cloudflare responde 503) | Cloudflare → Workers & Pages → projeto → Metrics ("Exceeded CPU/Memory") |
| `origem: fora-do-radar`, sem `cf-ray` | proxy/firewall/VPN da rede do usuário | testar em outra rede (4G) e em janela anônima |
| `origem: fora-do-radar`, com `cf-ray` | Cloudflare (Access ou plataforma) | Zero Trust → Logs → Access (filtrar pelo e-mail); Security Events (filtrar pelo `cf-ray`) |
| `origem: radar`, 503 | configuração ausente no ambiente (Access ou banco) | o corpo diz qual; conferir as variáveis do projeto |
| `origem: radar`, 502 | falha ao falar com o banco | log do `req` + `/api/diagnostico` |
| `origem: radar`, 500 | exceção não tratada | log do `req` (campo `excecao`) |
| `origem: tempo` | o servidor não respondeu em 5 s | `server-timing` e `/api/diagnostico` |
| `origem: rede` | o navegador nem recebeu resposta | conexão, VPN, proxy, extensões |

### Cache de curta duração (`x-radar-cache`)

`/api/rows` (20 s) e `/api/status` (60 s) são guardados no Cache API do Cloudflare, **depois** da validação do Access, para que o pico de usuários não abra uma conexão com o banco por requisição (era o que estourava o CPU: "Exceeded CPU Time Limits"). A resposta é igual para todos os usuários.

| `x-radar-cache` | Significa |
|---|---|
| `hit` | veio da cópia guardada (sem conexão nem consulta); `server-timing: cache;desc="copia de N s"` |
| `miss` | não havia cópia: leu do banco e guardou |
| `fresco` | `?fresco=1` ou botão atualizar: leu do banco e **substituiu** a cópia (o front pede isso logo depois de gravar) |
| `off` | sem Cache API neste ambiente: leu do banco, como antes |

Se `x-radar-cache` for sempre `miss`/`off` em produção, o Cache API não está valendo nesse domínio e o ganho não existe; nesse caso o próximo passo é o Hyperdrive. Acompanhe **CPU time (p99)** e **Errors** em Workers & Pages → Metrics.

## 3. O log

O Radar escreve **uma linha JSON** só para o que importa: **5xx e 429** (nível erro) e **respostas lentas, a partir de 1,5 s** (nível aviso). Erros comuns (401, 403, 404, 422) não entram. A linha não tem e-mail, query string nem corpo.

```json
{"evt":"api","req":"a1b2c3d4","s":503,"ms":312,"m":"GET","rota":"/api/rows","ray":"8f2abc-GRU","colo":"GRU","pais":"BR","st":"consulta;dur=290;desc=\"809 linhas, 520 KB\""}
```

Para ver: Cloudflare → Workers & Pages → o projeto → **Functions → Real-time logs** (Begin log stream) e procure pelo `req` informado. Pelo terminal: `npx wrangler pages deployment tail --project-name dashboard-metrics-team --format json` (exige `wrangler login`). O log em tempo real só mostra o que acontece enquanto está aberto; o `req` e o `cf-ray` que o usuário copia permitem achar o evento nele.

Exceção não tratada vira um **500 JSON com o `req`** (em vez de uma página do Cloudflare sem pista).

## 4. `GET /api/diagnostico` (exige login)

Roda no servidor, de verdade, e devolve: configuração (apenas presente/ausente), conexão com o banco pelos dois papéis e **a mesma consulta do painel** com a contagem de linhas, o tamanho em KB e o tempo. Não devolve segredo, URL de banco nem mensagem de erro do banco (só o tipo, ex.: `ECONNREFUSED`). Limite de 6 chamadas por minuto por usuário. É o que o botão "Copiar diagnóstico completo" inclui no relatório.

## 5. Onde está no código

`functions/_lib/diagnostico.ts` (marcação, log, limite) · `functions/api/_middleware.ts` (aplica a todas as rotas `/api/*`) · `functions/api/diagnostico.ts` · `functions/_lib/painel.ts` (consultas do painel) · `src/data/erroApi.ts` e `src/components/DiagnosticoErro.tsx` (front). Testes: `functions/_lib/diagnostico.test.ts`, `functions/api/diagnostico.test.ts`, `src/data/erroApi.test.ts`, `src/components/DiagnosticoErro.test.ts`.

Fora de `/api`, as rotas `/pncp`, `/comprasgov` e `/conlicitacao` ainda não têm a marcação.
