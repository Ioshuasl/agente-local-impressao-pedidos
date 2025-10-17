@echo off
cd C:\Users\kenio\impressao-automatica-testes\agente-local

start npm start

timeout /t 5 /nobreak

start ngrok http 4000

pause
