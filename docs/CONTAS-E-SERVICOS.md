# Contas e serviços (mapa para centralização)

Este documento lista **em qual conta/organização cada serviço do Radar está hospedado**, para o dia em que tudo for centralizado em uma conta só (ver "Roteiro de centralização").

> **O repositório é público.** Aqui ficam: serviço, plano, região, nomes de organização/projeto, IDs que já são públicos e **nomes** dos segredos. **Nunca** coloque neste arquivo e-mails de login pessoais, senhas, tokens, connection strings ou chaves. O e-mail/login dono de cada conta fica na coluna "Dono (login)" **somente no cofre de senhas da empresa**; aqui só se registra o *tipo* de conta (pessoal ou corporativa).
>
> Estado em **05/11/2026**. Itens marcados **(confirmar)** não puderam ser verificados a partir do repositório ou dos conectores e precisam ser conferidos no painel do serviço.

## 1. Visão geral

| # | Serviço | Para que serve | Conta / organização | Tipo de conta | Plano | Onde confirmar |
|---|---|---|---|---|---|---|
| 1 | **GitHub** | Código, CI/CD, rotinas agendadas (e-mail, Planner, backup, monitor) | Repositório `agentanalisedegoverno-svg/dashboard-metrics-team` (público) | Conta/organização de usuário **fora da org corporativa `CTC-Tech`** | Free | github.com → Settings → Organizations |
| 2 | **Cloudflare Pages** (front + API em Functions) | Site `https://radar-prevendas.pages.dev`; projeto Pages `radar-prevendas` | Conta Cloudflare de ID `bce3ca32aa74755796c55e75a2541712` (também no segredo `CLOUDFLARE_ACCOUNT_ID`) | **(confirmar)** — a conta não tem domínio próprio cadastrado | Free | dash.cloudflare.com → Workers & Pages |
| 3 | **Cloudflare Access (Zero Trust)** | Login por código enviado ao e-mail corporativo `@ctctech.com.br` | Equipe `ctctech-radar` (domínio `ctctech-radar.cloudflareaccess.com`, em `wrangler.toml`) | Mesma conta Cloudflare do item 2 | Free | dash.cloudflare.com → Zero Trust |
| 4 | **Neon (banco de produção)** | Postgres do Radar | Organização **"João"** (`org-billowing-frog-35650988`), projeto `radar-prevendas` (`young-breeze-09937213`), região `aws-sa-east-1`, Postgres 17; branch de produção `br-solitary-mud-b6oyjsmd`, banco `neondb` | **Pessoal** (organização criada em 09/09/2026 pela conta pessoal do João; não é da empresa) | Free (histórico de só 6 h) | console.neon.tech |
| 5 | **Neon (branch de teste de restauração)** | Drill mensal do backup | Mesmo projeto do item 4, branch `teste-restauracao`, banco `restore_drill`, papel `radar_restore` | Idem item 4 | Free | console.neon.tech |
| 6 | **Supabase (banco de backup / espelho)** | Cópia viva diária do Neon | Organização **`CTC Radar`**, projeto `radar-backup` (`njvvlobebcsjkoknybqi`), região `us-east-1` | **(confirmar)** — conta de login que criou a org | Free (pausa após 7 dias sem atividade; a restauração diária evita) | supabase.com/dashboard |
| 7 | **Google Drive (backup criptografado)** | Dumps `.dump.enc` diários (14 dias) e semanais (12 semanas) | Pasta de ID `1DJrTNn_LcKxwHzf7gd22DvAD1KdD8Eq6`; acesso por token OAuth do `rclone` no segredo `RCLONE_DRIVE_TOKEN` | **(confirmar)** — a conta Google dona da pasta **não** é a conectada ao assistente de IA (a pasta não é visível ali) | **(confirmar)** | drive.google.com → abrir a pasta → Compartilhar/Detalhes |
| 8 | **Gmail (envio de e-mails)** | Remetente SMTP (`smtp.gmail.com:465`) dos avisos de nova oportunidade e de mudança de status | Conta Gmail/Workspace guardada nos segredos `SMTP_USER` / `SMTP_PASS` (senha de app) / `SMTP_FROM` | **(confirmar)** — pessoal ou Workspace | **(confirmar)** | Ler o valor de `SMTP_USER` no cofre/segredo |
| 9 | **Microsoft 365 / Entra ID** | Planner (cartões das oportunidades) e login Microsoft | Tenant e aplicativo guardados em `PLANNER_TENANT_ID` e `PLANNER_CLIENT_ID`; o login usado é o de uma **pessoa** (expira após ~90 dias sem uso) | **Corporativa** (`ctctech.com.br`) | Licença M365 da empresa | entra.microsoft.com → Registros de aplicativo |
| 10 | **ConLicitações (API)** | Fonte externa de boletins de licitações | Token no segredo `CONLICITACAO_TOKEN` (Cloudflare Pages); **ainda não configurado** | **(confirmar)** contrato/conta no portal | — | Portal ConLicitações |

## 2. Onde cada segredo mora

Valores **nunca** ficam no repositório. Apenas os nomes:

**GitHub → Settings → Secrets and variables → Actions** (mesma conta do item 1)

| Segredo | Serviço de destino (item) | Usado por |
|---|---|---|
| `DATABASE_URL_BACKUP` | Neon, papel `radar_backup` somente leitura (4) | backup, vigia, espelho Supabase, testes não funcionais |
| `DATABASE_URL_EMAIL` | Neon, papel `radar_email` (4) | envio de e-mails |
| `DATABASE_URL_PLANNER` | Neon, papel `radar_planner` (4) | integração com o Planner |
| `DATABASE_URL_MONITOR` | Neon, papel do monitor de licitações (4) | monitor de licitações |
| `DATABASE_URL_RESTORE` | Neon, branch `teste-restauracao` (5) | teste mensal de restauração |
| `SUPABASE_DB_URL` | Supabase (6) | espelho diário |
| `BACKUP_PASSPHRASE` | Senha de criptografia dos dumps (sem ela o backup não abre; guardar também no cofre) | backup e restauração |
| `RCLONE_DRIVE_TOKEN` | Google Drive (7) | backup e teste de restauração |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Gmail (8) | envio de e-mails |
| `PLANNER_CLIENT_ID`, `PLANNER_TENANT_ID`, `PLANNER_ESTADO_CHAVE` | Microsoft Entra / Planner (9) | integração com o Planner |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Cloudflare (2) | deploy do site (pipeline) |

**Cloudflare Pages → Settings → Variables and Secrets** (conta do item 2): connection strings de runtime do banco, `GITHUB_DISPATCH_TOKEN` (aciona e-mail e Planner ao salvar; criado em 27/10/2026), `CONLICITACAO_TOKEN` (pendente) e as variáveis do Access. Lista detalhada em [OPERACAO.md](OPERACAO.md).

**Variáveis (não secretas)** do GitHub: `SUPABASE_URL`, `APP_URL`, `SITE_URL`, `MONITOR_LICITACOES_ENABLED`, `MS_CLIENT_ID`, `MS_TENANT_ID`, `DEMO_MODE` (hoje a lista de variáveis do repositório está vazia; os workflows tratam a ausência).

## 3. Quem depende de quem

```
Usuário ──► Cloudflare Access (3) ──► Cloudflare Pages (2) ──► Neon produção (4)
                                            │                       │
                                            │ aciona via API        ├─► GitHub Actions (1)
                                            ▼                       │      ├─► Gmail SMTP (8)  → e-mails
                                       GitHub (1) ◄─────────────────┘      ├─► Microsoft Entra/Planner (9)
                                                                           ├─► Google Drive (7)  → backup criptografado
                                                                           ├─► Supabase (6)      → espelho do banco
                                                                           └─► Neon teste-restauracao (5)
```

O GitHub Actions é o "centro": quase tudo que não é o site roda nele, e ele guarda as credenciais de todos os outros serviços.

## 4. Pontos de risco hoje (por estarem em contas diferentes)

1. **Banco de produção em conta pessoal** (item 4). Se a pessoa sair ou perder o acesso, o banco fica inacessível. É o item mais crítico a migrar para a conta da empresa.
2. **Repositório fora da organização corporativa** (item 1): os segredos de todos os serviços estão numa conta que não é da empresa.
3. **Backups em contas distintas** (Drive, Supabase, Neon): é bom para redundância, mas qualquer troca de conta exige regerar `RCLONE_DRIVE_TOKEN`, `SUPABASE_DB_URL` e os `DATABASE_URL_*`.
4. **Gmail como remetente** (item 8) com senha de app: limite de envio do Gmail e dependência de uma conta de e-mail; para a empresa, o ideal é um remetente Workspace/serviço transacional.
5. **Login do Planner é de uma pessoa** (item 9): expira em ~90 dias sem uso; o roadmap prevê permissão de aplicativo.
6. **Sem domínio próprio no Cloudflare**: impede WAF e rate limit globais (ver S1 em [ROADMAP.md](ROADMAP.md)); ao centralizar, aproveitar para cadastrar o domínio.

## 5. Roteiro de centralização (quando chegar a hora)

Ordem sugerida, do menos para o mais arriscado. Em cada passo, atualizar este documento e o [OPERACAO.md](OPERACAO.md).

1. **Inventário final:** preencher os itens **(confirmar)** acima e registrar os logins no cofre da empresa.
2. **GitHub:** transferir o repositório para a organização corporativa (Settings → Transfer). Recriar/validar os segredos (os valores acompanham a transferência; os workflows mantêm o nome).
3. **Cloudflare:** mover o projeto Pages `radar-prevendas` e o Zero Trust para a conta corporativa (ou convidar a conta corporativa como Super Administrator e depois transferir). Atualizar `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` e `CF_ACCESS_*`.
4. **Neon:** criar a organização corporativa e transferir o projeto (ou restaurar o último backup num projeto novo da empresa). Depois trocar as connection strings: `DATABASE_URL_*` no GitHub e as variáveis de runtime no Cloudflare Pages. Recriar os papéis `radar_*` conforme [OPERACAO.md](OPERACAO.md) §4.1.
5. **Supabase e Drive:** mover para a conta corporativa (nova pasta do Drive com novo token do `rclone`; novo projeto Supabase dedicado ao Radar).
6. **Gmail / Planner / ConLicitações:** trocar para a conta de serviço da empresa e regerar `SMTP_*`, `PLANNER_*` e `CONLICITACAO_TOKEN`.
7. **Verificação:** rodar *Backup do banco*, *Backup no Supabase*, *Teste de restauração*, *Enviar e-mails* e *Planner* manualmente; conferir o site e o login pelo Access.

Antes de qualquer troca, gerar um backup manual e confirmar que ele restaura (ver [BACKUP.md](BACKUP.md)).
