@echo off
setlocal
cd /d "%~dp0"
if errorlevel 1 goto directory_failed

where node >nul 2>nul
if errorlevel 1 goto node_missing
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 goto node_missing
where npm >nul 2>nul
if errorlevel 1 goto node_missing

echo Instalando as dependencias do CleanFrame...
call npm ci
set "_cleanframe_exit=%errorlevel%"
if not "%_cleanframe_exit%"=="0" goto failed

echo Compilando e abrindo o instalador do CleanFrame...
call npm run desktop:install
set "_cleanframe_exit=%errorlevel%"
if not "%_cleanframe_exit%"=="0" goto failed
exit /b 0

:node_missing
echo.
echo Instale Node.js 24 ou superior, com npm, e abra este arquivo novamente.
echo Download oficial: https://nodejs.org/en/download
set "_cleanframe_exit=1"
goto failed

:directory_failed
echo Nao foi possivel abrir a pasta do projeto.
set "_cleanframe_exit=1"

:failed
echo.
echo A instalacao foi interrompida. Confira a mensagem acima.
pause
exit /b %_cleanframe_exit%
