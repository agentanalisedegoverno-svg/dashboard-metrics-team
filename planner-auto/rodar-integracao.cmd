@echo off
rem Radar: rotina de 5 em 5 minutos (seg a sex, 08h as 19h). Chamada pelo Agendador do Windows (tarefa Radar-Planner integracao).
rem Etapa 1: exportador do Radar (le o banco e grava eventos em eventos\entrada).
rem Etapa 2: processar-eventos com --sim (cria ou atualiza os cartoes no Planner; --sim = sem perguntar, rotina aprovada).
rem Etapa 3 (opcional): e-mails de nova oportunidade. So roda se SMTP_PASS existir nesta maquina; falha aqui NAO afeta o Planner.
rem Log em logs\integracao.log. As variaveis DATABASE_URL_PLANNER e PLANNER_EVENTOS_DIR (Planner) e DATABASE_URL_EMAIL, SMTP_USER
rem e SMTP_PASS (e-mail) vem do ambiente do usuario. Ver docs/OPERACAO.md.
rem ATENCAO: manter este arquivo SOMENTE em ASCII e com fim de linha CRLF (o cmd.exe se confunde com acentos).
setlocal
set PYTHONUTF8=1
set RC=0
if not exist "C:\Users\CTC\planner-auto\logs" mkdir "C:\Users\CTC\planner-auto\logs"
set LOG=C:\Users\CTC\planner-auto\logs\integracao.log

echo ===== %DATE% %TIME% ===== >> "%LOG%"
cd /d "C:\Users\CTC\Downloads\radar-prevendas-react\radar-prevendas-react"
node scripts\planner-eventos.mjs >> "%LOG%" 2>&1
if errorlevel 1 goto erro_exportador

cd /d "C:\Users\CTC\planner-auto"
python planner_auto.py processar-eventos --sim >> "%LOG%" 2>&1
if errorlevel 1 goto erro_processar
goto emails

:erro_exportador
echo [ERRO] exportador falhou, processar-eventos nao foi executado >> "%LOG%"
set RC=1
goto emails

:erro_processar
echo [ERRO] processar-eventos falhou >> "%LOG%"
set RC=1

:emails
if not defined SMTP_PASS goto fim
cd /d "C:\Users\CTC\Downloads\radar-prevendas-react\radar-prevendas-react"
node scripts\enviar-emails.mjs >> "%LOG%" 2>&1
if errorlevel 1 echo [AVISO] envio de e-mails falhou, ver as linhas acima >> "%LOG%"

:fim
exit /b %RC%
