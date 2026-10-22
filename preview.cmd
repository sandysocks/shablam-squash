@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  node scripts\serve.mjs
) else (
  set ELECTRON_RUN_AS_NODE=1
  "%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe" scripts\serve.mjs
)
pause
