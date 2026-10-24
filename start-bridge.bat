@echo off
chcp 65001 >nul
echo ╔════════════════════════════════════════════════════════════════╗
echo ║         WASTELAND FORGE — AI BRIDGE STARTUP                  ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
cd /d "%~dp0"
echo Свободная память (нужно > 1.5 ГБ, иначе Vite упадёт):
for /f "tokens=2" %%M in ('wmic OS get FreePhysicalMemory /value ^| find "="') do set FREEMB=%%M
set /a FREEMB=!FREEMB! / 1024
echo    !FREEMB! МБ
echo.
echo Запуск моста (agent-bridge.mjs)...
start "AI BRIDGE" node agent-bridge.mjs
echo    Мост на http://127.0.0.1:8787 — токен смотри в его окне
echo.
echo Запускаю редактор на порту 7777...
start "WASTELAND FORGE DEV (:7777)" cmd /k "cd /d "%~dp0" && npm run dev -- --port 7777"
echo.
echo ============================================
echo Открой http://localhost:7777 через 3-5 секунд
echo Вкладка "Помощник" справа — подключи токен
echo.
echo ВАЖНО: не запускай npm run build, пока открыт
echo редактор — вместе они съедают всю память.
echo ============================================
echo.
pause