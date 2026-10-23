@echo off
rem Radar para Planner: roda as duas etapas em sequencia. Chamado pelo Agendador do Windows (tarefa Radar-Planner integracao).
rem Etapa 1: exportador do Radar (le o banco e grava eventos em eventos\entrada).
rem Etapa 2: processar-eventos com --sim (cria ou atualiza os cartoes no Planner; --sim = sem perguntar, rotina aprovada).
rem Log em logs\integracao.log. As variaveis DATABASE_URL_PLANNER e PLANNER_EVENTOS_DIR vem do ambiente do usuario.
rem ATENCAO: manter este arquivo SOMENTE em ASCII e com fim de linha CRLF (o cmd.exe se confunde com acentos).
setlocal
set PYTHONUTF8=1
if not exist "C:\Users\CTC\planner-auto\logs" mkdir "C:\Users\CTC\planner-auto\logs"
set LOG=C:\Users\CTC\planner-auto\logs\integracao.log

echo ===== %DATE% %TIME% ===== >> "%LOG%"
cd /d "C:\Users\CTC\Downloads\radar-prevendas-react\radar-prevendas-react"
node scripts\planner-eventos.mjs >> "%LOG%" 2>&1
if errorlevel 1 goto erro_exportador

cd /d "C:\Users\CTC\planner-auto"
python planner_auto.py processar-eventos --sim >> "%LOG%" 2>&1
if errorlevel 1 goto erro_processar
exit /b 0

:erro_exportador
echo [ERRO] exportador falhou, processar-eventos nao foi executado >> "%LOG%"
exit /b 1

:erro_processar
echo [ERRO] processar-eventos falhou >> "%LOG%"
exit /b 1
