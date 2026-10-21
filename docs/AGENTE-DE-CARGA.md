# Roteiro do agente de carga (planilha → Postgres, por merge)

Cole o bloco "Prompt do agente" abaixo no agente do Claude Code que alimenta o banco. Ele é autocontido e não contém credenciais.

> **Mudou na F4:** a carga deixou de **substituir** a base. Agora é um **merge** (`scripts/sync-db.mjs` → `sincronizar_planilha`): atualiza o que mudou, insere o que é novo, **nunca sobrescreve** linhas editadas pela web e marca como "ausentes" (sem apagar) as que sumiram da planilha. Isso permite que o time cadastre e edite pela aba Oportunidades enquanto a planilha ainda existe.

## Pré-requisitos (uma vez) — execução na máquina local (Windows)
- Node 22.18+ e este repositório clonado, com `npm ci` já executado.
- **Planilha pelo OneDrive sincronizado:** no Explorer, clique com o botão direito no arquivo `BaseLicitacao.xlsx` (ou na pasta) → *Sempre manter neste dispositivo*. Sem isso, o arquivo pode ser só um "espaço reservado" na nuvem e a leitura falha.
- **Leitura sem travar o Excel:** o agente deve **copiar** o arquivo para uma pasta temporária e ler a cópia (nunca abrir o original), para não conflitar com quem estiver editando.
- **Plano B pelo conector Microsoft 365:** se o arquivo local não estiver atualizado, ler a aba pelo conector (SharePoint GOVERNO2) em vez do disco.
- Variável de ambiente do usuário com a string do `radar_escritor` (fora do Git):
  ```powershell
  [Environment]::SetEnvironmentVariable("DATABASE_URL_WRITER", "<string>", "User")
  ```
  Ela fica visível só para o seu usuário do Windows. Reabra o terminal depois de definir.
- **Agendamento a cada 2 dias (Agendador de Tarefas do Windows):**
  ```powershell
  $acao = New-ScheduledTaskAction -Execute "claude" -Argument '-p "Leia docs/AGENTE-DE-CARGA.md e execute o bloco Prompt do agente" --model claude-sonnet-5-5 --allowedTools "Bash,Read,Write"' -WorkingDirectory "C:\Users\CTC\Downloads\radar-prevendas-react\radar-prevendas-react"
  $gatilho = New-ScheduledTaskTrigger -Daily -DaysInterval 2 -At 7:00am
  Register-ScheduledTask -TaskName "RadarPreVendas-Carga" -Action $acao -Trigger $gatilho
  ```
  A máquina precisa estar ligada e com o OneDrive sincronizado no horário (marque "executar assim que possível após horário perdido" nas configurações da tarefa).

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
1. Localize o arquivo BaseLicitacao.xlsx no OneDrive sincronizado e COPIE-O para uma pasta temporária (leia só a cópia).
   Se o arquivo local estiver ausente, em modo "somente nuvem" ou com data de modificação mais antiga que a do SharePoint,
   use o conector Microsoft 365 para ler a aba. Leia a aba "Base Governo" inteira (valores calculados, não fórmulas).
   A primeira linha é o cabeçalho. (Ex.: Python openpyxl com data_only=True sobre a cópia.)
   Gere um arquivo JSON temporário (aba.json) com a matriz: [ [cabeçalhos...], [linha 1...], ... ].
   - Datas: serialize como texto ISO "AAAA-MM-DD" (ou mantenha o número serial do Excel). Nunca como objeto.
   - Números e valores monetários: números (não texto com "R$"). Células vazias: null.
2. Valide ANTES de carregar:
   a) O cabeçalho contém "Status" e "Data Pregão" (sem elas a carga é recusada).
   b) Há pelo menos 400 linhas de dados (a base tem ~590; abaixo disso, suspeite de leitura parcial) e nenhuma
      linha totalmente vazia no meio de dados.
   c) Pelo menos 90% das linhas têm "Status" preenchido e pelo menos 90% têm "Data Pregão" válida.
   Se algo falhar: não carregue; relate qual validação falhou e os números encontrados.
2.5. Teste a conversão sem gravar: node scripts/sync-db.mjs aba.json --dry-run  (imprime "Linhas: N | avisos de qualidade: M" e "✓ dry-run").
3. Sincronize (merge, em uma transação):
      node scripts/sync-db.mjs aba.json --fonte "agente-claude"
   A saída esperada é "✓ sincronizado" com recebidas = número de linhas de dados lidas. Os avisos de qualidade
   (ex.: Lost sem motivo) NÃO impedem a carga: viram pendências para corrigir pela web.
   O script recusa a carga se vierem menos de 400 linhas (proteção contra leitura parcial).
4. Apague a cópia temporária da planilha e o aba.json (contêm dados de licitações) (contém dados de licitações).
5. Relate em 5 linhas: horário, linhas lidas, inseridas/atualizadas/ausentes/protegidas (da saída do script), validações, e qualquer anomalia.

EM CASO DE ERRO
- Erro de conexão/autenticação: relate e pare (não tente outras credenciais).
- Qualquer outro erro do script: relate a mensagem completa SEM a string de conexão. A base anterior continua
  intacta (a carga é atômica), então não há nada a desfazer. Tente de novo no máximo uma vez.
```

## Como confirmar que funcionou
- A saída do script mostra `✓ sincronizado` com `recebidas` = linhas da planilha.
- No painel, "Última atualização" muda e a contagem de oportunidades bate com a planilha (após o Cloudflare Access estar ativo e `DEMO_MODE` removido).
- Em caso de dúvida, no console do Neon: `select ultima_carga_em, total_linhas, fonte from carga_status;`.

## Observações
- O agente deve sempre enviar a planilha **completa** (linhas que não vierem ficam "ausentes").
- A chave de cada linha é processo + órgão + data do pregão + torre. Se alguém corrigir um desses campos na planilha, o banco enxerga uma linha nova e marca a antiga como ausente (o painel ignora as ausentes). Edições feitas na web ficam sempre protegidas.
- Em caso de incidente, a carga anterior pode ser recuperada pelo histórico do Neon (restauração de ponto no tempo, retenção de 6 horas no plano gratuito); para garantir, rode o agente e confira logo após alterações grandes na planilha.
- Trocar a senha do `radar_escritor`: peça para gerar uma nova e atualize só o ambiente do agente.
