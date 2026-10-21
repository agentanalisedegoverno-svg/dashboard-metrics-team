@echo off
rem Radar -> Planner: roda as duas etapas em sequência. Chamado pelo Agendador do Windows.
rem  1) exportador (lê o banco e grava eventos em eventos\entrada)
rem  2) processar-eventos --sim (cria/atualiza os cartões no Planner; --sim = sem perguntar, rotina aprovada)
rem Log: logs\integracao.log. As variáveis DATABASE_URL_PLANNER e PLANNER_EVENTOS_DIR vêm do ambiente do usuário.
setlocal
set PYTHONUTF8=1
if not exist "C:\Users\CTC\planner-auto\logs" mkdir "C:\Users\CTC\planner-auto\logs"
set LOG=C:\Users\CTC\planner-auto\logs\integracao.log

echo ===== %DATE% %TIME% ===== >> "%LOG%"
cd /d "C:\Users\CTC\Downloads\radar-prevendas-react\radar-prevendas-react"
node scripts\planner-eventos.mjs >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERRO] exportador falhou, processar-eventos nao foi executado >> "%LOG%"
  exit /b 1
)

cd /d "C:\Users\CTC\planner-auto"
python planner_auto.py processar-eventos --sim >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [ERRO] processar-eventos falhou >> "%LOG%"
  exit /b 1
)
exit /b 0
