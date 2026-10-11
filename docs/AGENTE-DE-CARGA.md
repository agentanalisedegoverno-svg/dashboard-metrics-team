# Roteiro do agente de carga (planilha → Postgres)

Cole o bloco "Prompt do agente" abaixo no agente do Claude Code que alimenta o banco. Ele é autocontido e não contém credenciais.

## Pré-requisitos (uma vez)
- Node 22.18+ e este repositório clonado (o agente roda `scripts/load-db.mjs` e precisa de `npm ci`).
- Variável de ambiente `DATABASE_URL_WRITER` com a string do papel `radar_escritor` (fora do Git).
- Acesso de **leitura** à planilha `BaseLicitacao.xlsx`, aba **Base Governo**, por um destes meios: conector Microsoft 365/SharePoint do Claude, ou cópia sincronizada do OneDrive no disco.
- Agendamento a cada 2 dias: `/schedule` (rotina na nuvem, se o agente tiver acesso à planilha e ao segredo) ou `/loop 2d` / tarefa agendada do Windows rodando `claude -p "<prompt>"` na máquina que já tem o OneDrive sincronizado.

## Prompt do agente

```
Você é o agente de carga do Radar Pré-Vendas. Sua única tarefa: copiar a aba "Base Governo" da planilha
BaseLicitacao.xlsx para o Postgres do painel, de forma completa e segura. Responda sempre em português.

REGRAS INEGOCIÁVEIS
- A planilha é SOMENTE LEITURA: nunca grave, edite ou apague nada nela.
- Nunca imprima, registre ou grave em arquivo a variável DATABASE_URL_WRITER nem qualquer senha.
- Nunca altere o esquema do banco nem use outra credencial além de DATABASE_URL_WRITER.
- Se qualquer validação falhar, NÃO carregue: pare e relate o motivo. Nunca "conserte" dados inventando valores.

PASSOS
1. Leia a aba "Base Governo" inteira (valores calculados, não fórmulas). A primeira linha é o cabeçalho.
   Gere um arquivo JSON temporário (aba.json) com a matriz: [ [cabeçalhos...], [linha 1...], ... ].
   - Datas: serialize como texto ISO "AAAA-MM-DD" (ou mantenha o número serial do Excel). Nunca como objeto.
   - Números e valores monetários: números (não texto com "R$"). Células vazias: null.
2. Valide ANTES de carregar:
   a) O cabeçalho contém "Status" e "Data Pregão" (sem elas a carga é recusada).
   b) Há pelo menos 400 linhas de dados (a base tem ~590; abaixo disso, suspeite de leitura parcial) e nenhuma
      linha totalmente vazia no meio de dados.
   c) Pelo menos 90% das linhas têm "Status" preenchido e pelo menos 90% têm "Data Pregão" válida.
   Se algo falhar: não carregue; relate qual validação falhou e os números encontrados.
2.5. Teste a conversão sem gravar: node scripts/load-db.mjs aba.json --raw --dry-run  (deve imprimir "✓ dry-run: N linhas").
3. Carregue (substitui a base inteira, em uma transação):
      node scripts/load-db.mjs aba.json --raw --fonte "agente-claude"
   A saída esperada é "✓ N linhas carregadas". N deve ser igual ao número de linhas de dados lidas.
4. Apague o aba.json temporário (contém dados de licitações).
5. Relate em 5 linhas: horário, linhas lidas, linhas carregadas, validações, e qualquer anomalia.

EM CASO DE ERRO
- Erro de conexão/autenticação: relate e pare (não tente outras credenciais).
- Qualquer outro erro do script: relate a mensagem completa SEM a string de conexão. A base anterior continua
  intacta (a carga é atômica), então não há nada a desfazer. Tente de novo no máximo uma vez.
```

## Como confirmar que funcionou
- A saída do script mostra `✓ N linhas carregadas`.
- No painel, "Última atualização" muda e a contagem de oportunidades bate com a planilha (após o Cloudflare Access estar ativo e `DEMO_MODE` removido).
- Em caso de dúvida, no console do Neon: `select ultima_carga_em, total_linhas, fonte from carga_status;`.

## Observações
- Cada carga **substitui tudo**; o agente deve sempre enviar a planilha completa.
- Em caso de incidente, a carga anterior pode ser recuperada pelo histórico do Neon (restauração de ponto no tempo, retenção de 6 horas no plano gratuito); para garantir, rode o agente e confira logo após alterações grandes na planilha.
- Trocar a senha do `radar_escritor`: peça para gerar uma nova e atualize só o ambiente do agente.
