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

## Atualização (18/11/2026, após a restauração)
- **Origem dos dados:** espelho do Supabase de 16/11 17:15 UTC (892 oportunidades). Ver [`INCIDENTE-2026-11-17-NEON.md`](INCIDENTE-2026-11-17-NEON.md).
- **Roles:** criadas a partir das migrações (só `CREATE ROLE`/`GRANT`/`REVOKE`, sem repetir mudanças de dados), com login, `NOINHERIT`, limite de 20 conexões e **`BYPASSRLS`** (o RLS fica ligado nas tabelas, sem políticas, como no Neon; sem `BYPASSRLS` as leituras voltam vazias). `radar_backup` tem `pg_read_all_data`.
- **Permissões de função:** os `GRANT`/`REVOKE` que listam várias funções falham por inteiro se uma assinatura não existir mais (ex.: `salvar_usuario` de 6 argumentos). Foram reaplicados **função por função**. Estado correto: `PUBLIC` sem EXECUTE nas funções de escrita; `radar_app` com as funções do app; `radar_escritor` só com `sincronizar_planilha`. **Sempre conferir a matriz** depois de aplicar migrações: `select proname, has_function_privilege('public', oid, 'execute') ...`.
- **Driver:** o parâmetro `::jsonb` recebe texto já serializado; o adaptador (`serializarJson`) evita o JSON duplo (PR #140).
- **Planner:** `planner-auto/estado_db.py` usa psycopg2 (PR #141); a API HTTP do Neon não existe no Azure.
- **Firewall:** aberto para qualquer origem (`liberar-cloudflare-github`, 0.0.0.0–255.255.255.255) para o Cloudflare e o GitHub Actions; a proteção é TLS obrigatório + senha de 32 caracteres por role. Para fechar: Hyperdrive (ver `PLANO-DE-ACAO-BANCO.md`, R8).
- **Assinatura:** Free Trial criada em 17/11/2026 22:28 (BRT). Crédito de 30 dias até ≈ 17/12/2026; Postgres gratuito por 12 meses (≈ 17/11/2027). Detalhes e decisões em [`PLANO-DE-ACAO-BANCO.md`](PLANO-DE-ACAO-BANCO.md).
- **Governança aplicada:** policies `radar-locais-permitidos` e `radar-postgres-gratuito`; orçamento `radar-orcamento-gratuito` (alertas 50%, 100% e previsão 100%); tags `app=radar-prevendas`.
- **Segredos:** `DATABASE_URL`, `_APP`, `_WRITER` no Cloudflare Pages; `_BACKUP`, `_EMAIL`, `_PLANNER`, `_MONITOR`, `_MIGRACAO` no GitHub. O valor é só a URL (`postgresql://papel:senha@...`), sem o nome da variável.
