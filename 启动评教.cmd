@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
if not exist "node_modules\playwright\package.json" (
  echo 依赖缺失，请先在本目录运行 npm.cmd ci 和 npx.cmd playwright install chromium。
  pause
  exit /b 1
)
node evaluate-current.js
set "SCRIPT_EXIT=%ERRORLEVEL%"
echo.
if not "%SCRIPT_EXIT%"=="0" echo 运行已停止，请查看上方提示。
pause
exit /b %SCRIPT_EXIT%
