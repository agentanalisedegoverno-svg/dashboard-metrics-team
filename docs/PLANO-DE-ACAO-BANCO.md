# Plano de ação: banco gratuito, redundância e backup

Estado em 18/11/2026. Complementa [`MIGRACAO-AZURE.md`](MIGRACAO-AZURE.md), [`BACKUP.md`](BACKUP.md) e [`INCIDENTE-2026-11-17-NEON.md`](INCIDENTE-2026-11-17-NEON.md).

## 1. Quanto tempo o banco gratuito aguenta

**Tecnicamente (limite de uso):** com folga.

| Item | Uso hoje | Limite gratuito (Azure) | Folga |
|---|---|---|---|
| Armazenamento | 11 MB | 32 GB | > 2.000x |
| Transferência de saída | ≈ 4,5 GB/mês (estimativa pelo consumo no Neon: 5,51 GB em 37 dias) | 100 GB/mês | ≈ 20x |
| Compute B1ms | 24 h × 30 d ≈ 720 h | 750 h/mês | cobre 24x7 |
| Crescimento | 669 → 892 oportunidades em 19 dias (+33%) | n/a | mesmo com 3x o tráfego fica dentro |

**Comercialmente (prazo):** é aqui que o "grátis" acaba.

| Marco | Data (inferida do log; confirmar em *Cost Management → Credits*) | O que acontece |
|---|---|---|
| Assinatura Free Trial criada | 17/11/2026 22:28 (BRT) | início |
| Fim dos 30 dias / crédito de US$ 200 | **≈ 17/12/2026** | a assinatura é **desativada**, a menos que seja convertida para *pay-as-you-go* |
| Fim dos 12 meses de Postgres gratuito (B1ms + 32 GB) | **≈ 17/11/2027** | passa a cobrar: ordem de **US$ 12–15/mês** (B1ms) + disco (valores aproximados; confirmar na calculadora do Azure) |

- **Não existe Postgres "always free" no Azure.** O único banco vitalício é o Azure SQL Database free tier (100.000 vCore-s/mês, 32 GB): é SQL Server (reescrita de gatilhos/funções) e o compute serverless cobre ≈ 55 h/mês; com rotinas de 5 min nunca pausa. **Descartado.** Cosmos DB free tier (NoSQL): descartado.
- A conversão para pay-as-you-go **remove o limite de gastos**; a partir daí o orçamento e as policies são a proteção.

## 2. Decisões (donos: João Henrique)
| # | Decisão | Prazo sugerido |
|---|---|---|
| D1 | Converter a assinatura para pay-as-you-go (mantém os 12 meses gratuitos) **ou** migrar de novo antes de 17/12 | até 10/12 |
| D2 | Onde roda o alimentador do Radar TIC, quem cuida e reenvio de 16/11 13:10 UTC em diante | hoje |
| D3 | Recuperar as edições de 16/11 17:15 → 17/11 15:00 UTC que ficaram no Neon (upgrade pontual ou esperar 01/12) | até 01/12 |
| D4 | Plano de longo prazo: ficar no Azure pago (~US$ 15–20/mês) ou migrar (Neon Launch, ~US$ 5+/mês) | até 31/12 |

## 3. Reforço da redundância e do backup
O que funcionou: dump criptografado no Drive (14 diários + 12 semanais), espelho diário no Supabase, teste de restauração mensal e vigia. O espelho foi a fonte da recuperação.

| # | Ação | Por quê | Esforço |
|---|---|---|---|
| R1 | **Guardar `BACKUP_PASSPHRASE` no cofre da empresa, com 2 pessoas com acesso**, e testar a abertura de um backup trimestralmente | Hoje só existe como segredo do GitHub (não dá para ler de volta): o backup do Drive ficou inacessível na emergência | 30 min |
| R2 | Backup a cada **6 h** (RPO ≈ 6 h) em vez de 1 por dia | Banco de 11 MB: custo desprezível. RPO atual ≈ 22 h | 1 PR pequeno |
| R3 | Teste de restauração com destino **Postgres temporário no runner** (remove o destino "branch do Neon") | O branch `teste-restauracao` do Neon não faz mais sentido | 1 PR pequeno |
| R4 | Espelho no Supabase **a partir do Azure** (já é o fluxo atual, só confirmar) e script **"promover o Supabase"** (roles, senhas, URLs) pronto | RTO de ≈ 22 h para ≤ 1 h | 1 dia |
| R5 | **Runbook que para o servidor** quando o orçamento do Azure atingir 100% (Automation + action group) | O orçamento só avisa; o corte hoje depende do limite de gastos do Free Trial | 0,5 dia |
| R6 | Vigia cobrindo: idade do último backup, conexão com o Azure e consumo do mês | Detectar antes de cair | 0,5 dia |
| R7 | **CI com Postgres real** (service container) rodando um teste de contrato do driver: criar/atualizar com `jsonb`, RLS, permissões por role | Os 3 defeitos pós-migração (JSON duplo, RLS, GRANT) teriam sido pegos | 1 dia |
| R8 | **Hyperdrive** do Cloudflare na frente do banco | Sem PgBouncer no tier Burstable, cada requisição abre conexão; limite de 20 por role | 0,5 dia |
| R9 | Procedimento de emergência para login (e-mails alternativos no Access) em `OPERACAO.md` | Queda do Microsoft impediu entrada em 13/11 | 30 min |

Regra de ouro: **3 cópias, 2 meios, 1 fora** (Azure com backup nativo de 7 dias; Drive criptografado; Supabase espelho).

## 4. Pendências operacionais
- Planner: PR #141 (psycopg2). Depois do merge, rodar *Planner integração*; se o login da Microsoft expirou, `python estado_db.py guardar` na máquina com o login.
- Reenvio das oportunidades da API e, se chegarem como Prospect, mover para **Radar-TIC** (script com trava e auditoria).
- Gravação: confirmar uma edição real no painel (histórico e versão).
- Segredos: apagar `SEGREDOS-AZURE.txt` e trocar a senha do Supabase compartilhada no chat (atualizar `SUPABASE_DB_URL`).
- `DATABASE_URL_RESTORE` ainda aponta para o Neon (ver R3).
