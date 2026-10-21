# Carga de dados (agente → Postgres)

O painel lê do Postgres (Neon). Um agente externo lê a planilha `BaseLicitacao.xlsx` (aba **Base Governo**) e substitui a base a cada execução (por exemplo, a cada 2 dias).

## Contrato
Cada linha segue o formato do painel (`functions/_lib/rows.ts`):
`ano, mes, status, uf, torre, linhaServico, vistoria, analista, motivoNoGo, motivoLost, contaVinculada, orcamento, valorCtc, valorVencedor, sla, processo, orgao, descritivo, dataPregao, acaoIA`.
`ano`/`mes` (`2026-03`) derivam de **Data Pregão**; `dataPregao` vai como `dd/mm/aaaa`. Valores monetários são números.

## Duas formas de carregar
1. **Matriz bruta da aba** (mais simples para o agente): salvar `usedRange.values` em JSON e rodar
   ```
   DATABASE_URL_WRITER='postgresql://radar_escritor:<senha>@ep-sparkling-hat-b61akqwy.c-2.sa-east-1.aws.neon.tech/neondb?sslmode=require' \
     node scripts/sync-db.mjs aba.json --fonte "agente-claude"  # merge (F4); load-db.mjs é a carga total antiga
   ```
   O script converte o cabeçalho real da planilha (33 colunas) nos campos acima.
2. **JSON já no contrato:** `node scripts/load-db.mjs linhas.json` (sem `--raw`).

A carga é **atômica** (uma transação): se algo falhar, a base anterior permanece. Um array vazio é recusado, para nunca zerar o painel por engano. A última carga aparece no painel ("Última atualização").

## Segurança
- `radar_escritor` só executa `carregar_oportunidades()`; não lê, não apaga e não cria objetos.
- `radar_leitor` (usado pela API) só faz SELECT.
- Senhas ficam fora do Git: `DATABASE_URL_WRITER` no ambiente do agente; `DATABASE_URL` como *secret* no projeto Cloudflare Pages.
- A API só responde com um JWT válido do Cloudflare Access (ver README).
