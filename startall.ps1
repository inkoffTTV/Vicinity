# Vicinity автозапуск: поднимает сервер (если не запущен) и держит SSH-туннель живым.
$ErrorActionPreference = "SilentlyContinue"

$serverExe = "C:\Users\St999\Downloads\CPMessenger\build\backend\Release\VicinityServer.exe"
$serverDir = "C:\Users\St999\Downloads\CPMessenger\build\backend\Release"

# 1) Сервер
if (-not (Get-Process VicinityServer -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $serverExe -WorkingDirectory $serverDir -WindowStyle Hidden
    Start-Sleep -Seconds 2
}

# 2) Туннель (бесконечный watchdog — сам переподключается после обрывов)
& "C:\Users\St999\Downloads\CPMessenger\tunnel.ps1"
