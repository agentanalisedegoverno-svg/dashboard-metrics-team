# Incidente: banco bloqueado por cota (17–18/11/2026)

**Resumo:** o Neon (plano gratuito) bloqueou o banco ao estourar a cota de transferência de dados. O Radar ficou fora do ar de 17/11 ~15h UTC até 18/11 ~13h UTC (≈ 22 h) e foi restaurado no Azure.

## Linha do tempo (UTC)
| Quando | O que aconteceu |
|---|---|
| 16/11 13:10 | Última criação pela API do Radar TIC (cliente `radar-tic`). |
| 16/11 15:22 | Último backup criptografado no Drive. |
| 16/11 17:15–17:19 | Última atualização de dados e último espelho bem-sucedido no Supabase (892 oportunidades). |
| 17/11 ~15:14 | Última atividade do banco no Neon; a partir daí toda conexão recebe HTTP 402 ("exceeded the quota"). |
| 17/11 15:46 | Primeira falha do backup agendado; e-mails, Planner e backup do Supabase passam a falhar. |
| 17/11 ~21:05 | Queda reportada. Diagnóstico: `data_transfer_bytes` do branch = 5,51 GB (limite do Free: 5 GB). |
| 18/11 01:28 | Assinatura Azure criada (Free Trial); servidor Postgres criado ~02:22. |
| 18/11 ~08:40 | Dump do espelho do Supabase restaurado no Azure (892 oportunidades, 1.935 históricos, 11 usuários, 32 funções, 8 gatilhos). |
| 18/11 ~13:05 | Painel de volta (leituras); gravação ainda quebrada. |
| 18/11 ~13:50 | Hotfix #140 (JSON duplo) no ar: gravação restabelecida. |

## Causa raiz
Transferência de dados acima de 5 GB/mês no Neon Free (≈ 150 MB/dia, crescendo com o número de oportunidades: 669 em 28/10, 892 em 16/11). Cada abertura do painel baixa `/api/rows` (≈ 340 KB) e `/api/oportunidades` (≈ 1,6 MB), além das rotinas de 5/15/30 min e dos backups.

## Impacto
- Painel e API fora do ar; e-mails, Planner e monitor sem rodar.
- **Dados perdidos no Azure:** tudo que mudou depois de 16/11 17:15 UTC. As edições manuais até 17/11 ~15:00 UTC **continuam no Neon** (bloqueado) e são recuperáveis na virada da cota (01/12) ou com upgrade pontual. O que o alimentador do Radar TIC tentou enviar depois de 16/11 13:10 UTC não ficou registrado e precisa ser reenviado (a chave de idempotência é o número de controle do PNCP, então reenviar é seguro).

## O que deu certo
- Espelho no Supabase: foi a fonte da restauração (a passphrase do backup do Drive não estava acessível).
- Backup, vigia e teste de restauração mensal existiam; o espelho funcionou como previsto.

## O que deu errado (e foi corrigido na migração)
| Problema | Efeito | Correção |
|---|---|---|
| Driver novo (`postgres`) serializa de novo o JSON passado a `::jsonb` | Toda gravação devolvia 502 | PR #140 (`serializarJson`) |
| Roles de aplicação sem `BYPASSRLS` | Leituras vazias (RLS ligado, sem políticas) | `ALTER ROLE ... BYPASSRLS` nas roles de aplicação |
| GRANT/REVOKE em grupo das migrações falham inteiros por uma assinatura antiga | `PUBLIC` com EXECUTE em funções de escrita | Reaplicados função por função |
| `planner-auto/estado_db.py` usava a API HTTP do Neon | Job do Planner falhava | PR #141 (psycopg2) |
| `BACKUP_PASSPHRASE` só existia como segredo do GitHub | Backup do Drive inacessível na emergência | Ver plano de ação (cofre da empresa, 2 custodiantes) |
| Firewall do Azure restrito ao IP do admin | Cloudflare e Actions recusados | Regra aberta (TLS + senha de 32 caracteres), ver `docs/MIGRACAO-AZURE.md` |

## Lições
1. Monitorar a cota **antes** de estourar (transferência, não só compute).
2. Todo segredo de recuperação precisa de custódia fora do GitHub.
3. Testar o driver novo contra um Postgres real no CI (não só contra mocks): os três defeitos pós-migração teriam aparecido.
4. Meta de recuperação: RTO ≤ 1 h e RPO ≤ 6 h (hoje: RTO ≈ 22 h; RPO ≈ 22 h).
