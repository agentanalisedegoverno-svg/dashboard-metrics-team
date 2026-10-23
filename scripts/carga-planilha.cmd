@echo off
rem Carga automatica da planilha para o banco, por merge. Chamado pelo Agendador do Windows (tarefa Radar-Carga-Planilha).
rem Passo 1: exportar_planilha.py copia a planilha em modo somente leitura e gera aba.json.
rem Passo 2: sync-db.mjs sincroniza por merge, sem sobrescrever o que foi editado na web, e recusa leitura parcial.
rem Requer DATABASE_URL_WRITER no ambiente do usuario, Python com openpyxl e Node 22.18 ou mais novo.
rem Log em %USERPROFILE%\.radar\carga.log. A copia da planilha e o aba.json sao apagados no fim.
rem ATENCAO: manter este arquivo SOMENTE em ASCII e com fim de linha CRLF (o cmd.exe se confunde com acentos).
setlocal
set PYTHONUTF8=1
set LOGDIR=%USERPROFILE%\.radar
set LOG=%LOGDIR%\carga.log
set TMPD=%TEMP%\radar-carga
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
if exist "%TMPD%" rmdir /s /q "%TMPD%"
mkdir "%TMPD%"

echo ===== %DATE% %TIME% ===== >> "%LOG%"
cd /d "%~dp0.."

python scripts\exportar_planilha.py --saida "%TMPD%" >> "%LOG%" 2>&1
if errorlevel 1 goto erro_exportacao

node scripts\sync-db.mjs "%TMPD%\aba.json" --fonte "agendador" --relatorio "%LOGDIR%\ultimo-relatorio.json" >> "%LOG%" 2>&1
set RC=%ERRORLEVEL%
rmdir /s /q "%TMPD%"
if not "%RC%"=="0" goto erro_sincronizacao
echo [OK] carga concluida >> "%LOG%"
exit /b 0

:erro_exportacao
echo [ERRO] exportacao da planilha falhou; nada foi gravado no banco >> "%LOG%"
rmdir /s /q "%TMPD%"
exit /b 1

:erro_sincronizacao
echo [ERRO] sincronizacao falhou, codigo %RC% >> "%LOG%"
exit /b 1
