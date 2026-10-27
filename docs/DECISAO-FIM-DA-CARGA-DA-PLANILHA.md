# Decisão: o banco não é mais alimentado pela planilha do Excel

**Data:** 27/10/2026 · **Decidido por:** João Henrique (CTC Tech) · **Status:** em vigor

## Decisão

A migração para o **Radar web** está concluída: oportunidades são cadastradas e editadas **somente no Radar** (aba *Oportunidades*), e o **banco Postgres (Neon) é a única fonte da verdade**. A planilha `BaseLicitacao.xlsx` **deixou de alimentar o banco**. A carga agendada da planilha era uma solução **paliativa** de convivência e foi **desativada e removida**.

## O que foi desfeito

| Item | Antes | Agora |
|---|---|---|
| Tarefa do Windows `Radar-Carga-Planilha` (dias úteis 07:30) | ativa, na máquina do João | **desativada** em 27/10/2026 (não apagada, para poder reverter; apague quando quiser) |
| `scripts/carga-planilha.cmd`, `scripts/exportar_planilha.py`, `scripts/sync-db.mjs`, `scripts/load-db.mjs` | carga por merge e carga total antiga | **removidos** do repositório |
| `functions/_lib/planilha.ts` (+ teste) | converte as 34 colunas da planilha | **removido** |
| Vigia do backup (`verificar-backup.yml`): checagem "Última carga da planilha" | alertava se a carga passasse de 80 h | **removida** (senão alertaria todo dia) |
| "Última atualização" no painel | data da última carga | agora é a **última alteração feita no Radar** (maior `atualizado_em`) |
| `DATABASE_URL_WRITER` (papel `radar_escritor`) | segredo na máquina da carga | **descontinuado**: pode ser removido da máquina |
| Documentos `CARGA-DE-DADOS.md` e `AGENTE-DE-CARGA.md` | instruções vivas | mantidos **só como histórico**, com aviso no topo |

## O que fica no banco (legado, inofensivo)

Nada foi apagado do banco. Continuam existindo, sem uso: a função `sincronizar_planilha`, a tabela `carga_status`, as colunas `chave_planilha` e `ausente_na_planilha` e o valor `fonte = 'planilha'` das linhas já importadas. A regra "editado na web vence a planilha" deixou de ter efeito porque não há mais carga.

**Limpeza opcional futura (precisa de aprovação, mexe no banco de produção):** revogar o `EXECUTE` de `sincronizar_planilha` do papel `radar_escritor` e, se quiser, apagar a função, a tabela `carga_status` e as colunas legadas. Não é necessário para o funcionamento.

## Como reverter (se algum dia for preciso)

1. Reativar a tarefa: `Enable-ScheduledTask -TaskName "Radar-Carga-Planilha"`.
2. Restaurar os scripts removidos do histórico do Git (commit anterior a esta decisão) e recriar `DATABASE_URL_WRITER`.
3. Atenção: a carga por merge nunca sobrescreve o que foi editado na web, mas **marca como "ausente" o que não estiver na planilha**; com a base já migrada para o Radar isso esconderia oportunidades criadas só na web? Não (linhas da web são intocadas), mas esconderia linhas antigas que a planilha não tem mais. Faça um `--dry-run` antes.

## Efeito nas outras integrações

- **Planner e e-mail** nunca dependeram da planilha: usam só oportunidades criadas ou alteradas na web (`fonte = 'web'`).
- **Backup e restauração** seguem normais.
