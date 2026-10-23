# Carga automática da planilha (planilha → banco, por merge)

> **Mudou em 22/10/2026:** a carga deixou de depender de um agente de IA (que nunca chegou a ser agendado). Agora é uma **tarefa do Windows** determinística, sem custo de modelo: exporta a planilha e sincroniza por merge. O nome do arquivo (AGENTE-DE-CARGA) foi mantido para não quebrar links.

## O que roda

Tarefa **`Radar-Carga-Planilha`** (Agendador de Tarefas do Windows), **dias úteis às 07:30** (e assim que possível se o computador estiver desligado nesse horário). Ela executa [`scripts/carga-planilha.cmd`](../scripts/carga-planilha.cmd):

1. [`scripts/exportar_planilha.py`](../scripts/exportar_planilha.py) copia `BaseLicitacao.xlsx` (OneDrive sincronizado) para uma pasta temporária, **somente leitura** (o original nunca é aberto), lê a aba *Base Governo* e gera `aba.json`. Valida o cabeçalho e recusa arquivo "espaço reservado" do OneDrive.
2. [`scripts/sync-db.mjs`](../scripts/sync-db.mjs) sincroniza por **merge** (`sincronizar_planilha`): atualiza o que mudou, insere o novo, **nunca sobrescreve o que foi editado na web** e marca como "ausente" (sem apagar) o que sumiu. Recusa a carga se vierem menos de 400 linhas.
3. Apaga a cópia e o `aba.json` (contêm dados de licitações).

Log: `%USERPROFILE%\.radar\carga.log` (procure `[OK]` ou `[ERRO]`). Relatório de qualidade da última carga: `%USERPROFILE%\.radar\ultimo-relatorio.json`.

## Pré-requisitos (uma vez, na máquina da carga)
- **Python** com `openpyxl` (`python -m pip install openpyxl`) e **Node 22.18+**; repositório do Radar clonado com `npm ci`, **na branch `main`** (a tarefa usa a pasta do projeto).
- **OneDrive:** a planilha precisa estar disponível localmente (*Sempre manter neste dispositivo*).
- Variável de ambiente do usuário `DATABASE_URL_WRITER` com a string do papel `radar_escritor` (fora do Git):
  ```powershell
  [Environment]::SetEnvironmentVariable("DATABASE_URL_WRITER", "<string>", "User")
  ```
- Criar a tarefa:
  ```powershell
  $acao = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c "C:\caminho\radar-prevendas-react\scripts\carga-planilha.cmd"'
  $gat  = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At 7:30am
  $conf = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RunOnlyIfNetworkAvailable
  Register-ScheduledTask -TaskName "Radar-Carga-Planilha" -Action $acao -Trigger $gat -Settings $conf
  ```

## Como conferir
- Rodar agora: `Start-ScheduledTask -TaskName "Radar-Carga-Planilha"` e ver o fim do `carga.log` (`[OK] carga concluida`). Resultado da tarefa 0 = sucesso.
- Última carga no banco: `select ultima_carga_em, total_linhas, fonte, erro from carga_status;` (a fonte da tarefa é `agendador`).
- **Alerta:** o workflow *Vigia do backup* (diário) também falha, e o GitHub avisa por e-mail, se a última carga tiver mais de **80 horas** (cobre o fim de semana).

## Regras importantes
- O banco é a fonte da verdade; a planilha entra por merge enquanto existir (convivência). A chave da linha é processo + órgão + data do pregão + torre: corrigir um desses campos na planilha gera uma linha nova e marca a antiga como ausente (o painel ignora as ausentes).
- O papel `radar_escritor` só executa `sincronizar_planilha`. A carga total antiga (`carregar_oportunidades`, que apagava tudo) foi **revogada** dele (migração 002, aplicada em 22/10/2026).
- Trocar a senha do `radar_escritor`: `ALTER ROLE radar_escritor PASSWORD '...'` no Neon e atualizar `DATABASE_URL_WRITER` na máquina da carga.

## Cuidado com arquivos `.cmd`
O `cmd.exe` se confunde com **acentos** e com fim de linha estilo Linux. Mantenha `scripts/carga-planilha.cmd` e `planner-auto/rodar-integracao.cmd` **somente em ASCII e com CRLF** (o `.gitattributes` já força CRLF).

## Encerramento
Quando a planilha for desativada (roadmap), desligue a tarefa: `Disable-ScheduledTask -TaskName "Radar-Carga-Planilha"` e remova a verificação de carga do *Vigia do backup*.
