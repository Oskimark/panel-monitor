@echo off
chcp 65001 >nul
title Panel de Monitoreo de Servidores
cd /d "%~dp0"

echo ===================================================
echo   Iniciando Panel de Monitoreo de Infraestructura
echo ===================================================
echo.

if not exist "node_modules\" (
    echo Instalando dependencias por primera vez...
    call npm install
    echo.
)

:: Abre el navegador tras 3 segundos en segundo plano
start /b "" cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

call npm run dev
pause
