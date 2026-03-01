@echo off
powershell -ExecutionPolicy Bypass -File "UpdateServerBuild.ps1"
powershell -ExecutionPolicy Bypass -File "RunGameServer.ps1"
pause