@echo off
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js dan npm belum tersedia. Pasang Node.js 24 terlebih dahulu.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm.cmd run build
if errorlevel 1 (
  pause
  exit /b 1
)
echo Buka http://127.0.0.1:4180 di browser PC ini.
echo Tekan Ctrl+C untuk menghentikan server.
call npm.cmd run preview
pause
