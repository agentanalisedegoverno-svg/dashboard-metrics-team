# Banco no Azure (Azure Database for PostgreSQL)

Em 17–18/11/2026 o Neon (plano gratuito) estourou a cota de transferência e bloqueou o banco. O Radar passou a usar o
**Azure Database for PostgreSQL Flexible Server**, na conta gratuita, em Brazil South.

## Como está montado
- Servidor `radar-prevendas-pg` (grupo `rg-radar-prevendas`): Postgres 17, Burstable **B1ms**, 32 GB, sem alta disponibilidade, backup de 7 dias, SSL obrigatório.
- Banco `radar`. Papéis de mínimo privilégio como antes: `radar_app`, `radar_leitor`, `radar_escritor`, `radar_planner`, `radar_email`, `radar_monitor`, `radar_backup`, todos com `BYPASSRLS` (o RLS fica ligado nas tabelas, sem políticas, como no Neon) e limite de 20 conexões.
- Driver: `postgres` (TCP), em `functions/_lib/banco.ts` (API) e `scripts/banco.mjs` (workflows). Mantém a forma `sql\`...\``; o Cloudflare Pages precisa da flag `nodejs_compat` (já no `wrangler.toml`).
- Não há PgBouncer no tier Burstable: cada requisição abre uma conexão curta (ociosa fecha em 5 s). Se o uso crescer, usar o **Hyperdrive** do Cloudflare na frente do banco.

## Governança (assinatura)
- Policies: somente a região Brazil South; Postgres só `Standard_B1ms`, até 32 GB e sem HA (nega o resto, para nunca sair do limite gratuito).
- Orçamento mensal `radar-orcamento-gratuito` com alertas por e-mail em 50%, 100% e previsão de 100%.
- A assinatura é Free Trial com **limite de gastos ligado**: ao esgotar o crédito, os serviços são suspensos em vez de cobrados.
- Atenção: o Postgres gratuito do Azure vale por 12 meses a partir da abertura da conta.

## CI/CD do banco
Workflow [`migrar-banco.yml`](../.github/workflows/migrar-banco.yml): aplica só as migrações novas de `db/migrations/` (controle na tabela `schema_migracoes`), cada uma numa transação. Rodar primeiro com *só listar*. Segredo: `DATABASE_URL_MIGRACAO` (dono do banco).

## Segredos a apontar para o Azure (um por conexão; não ficam no Git)
Cloudflare Pages: `DATABASE_URL`, `DATABASE_URL_APP`, `DATABASE_URL_WRITER` (se usado). GitHub: `DATABASE_URL_BACKUP`, `DATABASE_URL_EMAIL`, `DATABASE_URL_PLANNER`, `DATABASE_URL_MONITOR`, `DATABASE_URL_RESTORE`, `DATABASE_URL_MIGRACAO`. Formato: `postgresql://<papel>:<senha>@radar-prevendas-pg.postgres.database.azure.com:5432/radar?sslmode=require`.

## Rede
O firewall do servidor começa restrito. Para o Cloudflare e o GitHub Actions (IPs variáveis) conectarem, é preciso abrir a faixa 0.0.0.0–255.255.255.255 (como era no Neon), com TLS e senhas longas, ou usar o Hyperdrive. Decisão de segurança do responsável pelo projeto.
