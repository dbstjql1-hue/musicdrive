@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo [MusicDrive] npm.cmd was not found. Install Node.js first.
  pause
  exit /b 1
)

call :is_port_open 5000
if errorlevel 1 (
  echo [MusicDrive] Starting backend on http://127.0.0.1:5000 ...
  start "MusicDrive Backend" cmd /k "cd /d ""%~dp0backend"" && npm.cmd start"
) else (
  echo [MusicDrive] Backend is already running on port 5000.
)

call :is_port_open 5173
if errorlevel 1 (
  echo [MusicDrive] Starting frontend on http://127.0.0.1:5173 ...
  start "MusicDrive Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm.cmd run dev -- --host 127.0.0.1"
) else (
  echo [MusicDrive] Frontend is already running on port 5173.
)

echo.
echo [MusicDrive] Keep both server windows open while using the app.
echo [MusicDrive] Open http://127.0.0.1:5173 after the servers are ready.
pause
exit /b 0

:is_port_open
powershell -NoProfile -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', %1); exit 0 } catch { exit 1 } finally { $client.Dispose() }" >nul 2>nul
exit /b %errorlevel%
