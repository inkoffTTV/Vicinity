# Vicinity tunnel watchdog — держит SSH-туннель к serveo живым,
# автоматически переподключается после обрывов сети.
# Адрес для друга: https://vicinitymsg.serveousercontent.com  (стабильный после регистрации ключа)

$key = "$env:USERPROFILE\.ssh\id_ed25519"
$ssh = "C:\WINDOWS\System32\OpenSSH\ssh.exe"

Write-Host "=== Vicinity tunnel watchdog ===" -ForegroundColor Cyan
Write-Host "Адрес для друга: https://vicinitymsg.serveousercontent.com" -ForegroundColor Green
Write-Host "Не закрывай это окно, пока друг подключён. Ctrl+C для остановки." -ForegroundColor Yellow
Write-Host ""

while ($true) {
    Write-Host "[$(Get-Date -Format HH:mm:ss)] Поднимаю туннель..." -ForegroundColor Cyan
    & $ssh -i $key `
        -o StrictHostKeyChecking=accept-new `
        -o ServerAliveInterval=20 `
        -o ServerAliveCountMax=3 `
        -o ExitOnForwardFailure=yes `
        -R vicinitymsg:80:localhost:8080 serveo.net
    Write-Host "[$(Get-Date -Format HH:mm:ss)] Туннель оборвался. Переподключаюсь через 3 сек..." -ForegroundColor Red
    Start-Sleep -Seconds 3
}
