@echo off
echo Starting Predictive Dialer System...

:: Start Backend Server in a new window
start "Predictive Dialer SERVER" cmd /k "npm run dev"

:: Start Ngrok in a new window (assuming port 3000)
start "Ngrok Tunnel" cmd /k "ngrok http 3000"

echo System started. Check the opened windows for logs.
