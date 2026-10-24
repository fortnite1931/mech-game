@echo off
chcp 65001 >nul
echo ══════════════════════════════════════════════
echo   ПЕРЕЗАПУСК DEV-СЕРВЕРА (чистый сброс)
echo ══════════════════════════════════════════════
echo.

cd /d "%~dp0"

rem 1. Убиваем ТОЛЬКО vite-процессы этого проекта
echo [1/3] Останавливаю старые процессы vite...
for /f "tokens=2 delims=," %%P in ('wmic process where "name='node.exe' and CommandLine like '%%vite%%'" get ProcessId^,CommandLine /format:csv 2^>nul ^| find "SEGA-MIRONGAME"') do (
  echo    останавливаю PID %%~P
  taskkill /F /PID %%~P >nul 2>&1
)

rem 2. Проверяем свободную память
echo.
echo [2/3] Состояние памяти...
for /f "tokens=2" %%M in ('wmic OS get FreePhysicalMemory /value ^| find "="') do set FREEMB=%%M
set /a FREEMB=!FREEMB! / 1024
echo    свободно: !FREEMB! МБ
if !FREEMB! LT 1500 (
  echo.
  echo ⚠  Мало памяти! Закрой лишние вкладки браузера и редакторы,
  echo    затем запусти это окно снова. Vite с three.js ест ~700 МБ.
)

rem 3. Запускаем заново
echo.
echo [3/3] Запускаю dev-сервер на порту 7777...
echo.
start "WASTELAND FORGE DEV (:7777)" cmd /k "cd /d "%~dp0" && npm run dev -- --port 7777"

echo.
echo ══════════════════════════════════════════════
echo  Готово. Через пару секунд открой:
echo    http://localhost:7777
echo  Если оверлей с ошибкой останется —
echo  нажми Ctrl+Shift+R (жёсткая перезагрузка).
echo ══════════════════════════════════════════════
pause
