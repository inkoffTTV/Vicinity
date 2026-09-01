# Vicinity — хостинг сервера на домашнем ПК (без VPS).
# Запуск: ЗАПУСТИТЬ-СЕРВЕР-ДОМА.bat (или прямо этот скрипт).
# Делает: правило фаервола (один раз, спросит админа) → запуск VicinityServer →
# печатает адреса для друзей → опционально туннель localhost.run.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe  = Join-Path $root 'build\backend\Release\VicinityServer.exe'
if (-not (Test-Path $exe)) {
    Write-Host "Не найден $exe" -ForegroundColor Red
    Write-Host "Собери бэкенд: cmake --build build/backend --config Release"
    pause; exit 1
}

# ── Правило фаервола (одноразово; нужны права администратора) ──
netsh advfirewall firewall show rule name="Vicinity Server" | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Добавляю правило фаервола для порта 8080 (запрос прав администратора)..."
    Start-Process netsh -Verb RunAs -Wait -ArgumentList `
        'advfirewall firewall add rule name="Vicinity Server" dir=in action=allow protocol=TCP localport=8080'
}

# ── Запуск сервера (рабочая папка = папка exe: там vicinity.db и uploads/) ──
if (-not (Get-Process VicinityServer -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -WindowStyle Minimized
    Start-Sleep -Seconds 2
    Write-Host "Сервер запущен (порт 8080)." -ForegroundColor Green
} else {
    Write-Host "Сервер уже запущен." -ForegroundColor Green
}

# ── Адреса для друзей ──
$lan = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254*' } |
        Select-Object -First 1).IPAddress
try { $wan = Invoke-RestMethod 'https://api.ipify.org' -TimeoutSec 6 } catch { $wan = '<не удалось определить>' }
Write-Host ""
Write-Host "=== АДРЕСА ДЛЯ ДРУЗЕЙ (поле «Адрес сервера» в Vicinity) ===" -ForegroundColor Cyan
Write-Host ("  В твоей сети (Wi-Fi/LAN):  http://{0}:8080" -f $lan)
Write-Host ("  Из интернета:              http://{0}:8080" -f $wan)
Write-Host ("     ^ для этого пробрось порт 8080 на роутере на {0}" -f $lan)
Write-Host "       (роутер: 192.168.0.1 или 192.168.1.1 -> Port Forwarding -> TCP 8080)"
Write-Host ""
Write-Host "Если проброс порта невозможен (серый IP/CGNAT) — используй туннель:"
$t = Read-Host "Запустить туннель localhost.run сейчас? (y/n)"
if ($t -eq 'y') {
    Write-Host "Туннель запускается; адрес вида https://XXXX.lhr.life появится ниже."
    Write-Host "Друзья вписывают ЕГО в «Адрес сервера». Окно не закрывать!"
    ssh -o StrictHostKeyChecking=no -R 80:localhost:8080 nokey@localhost.run
}
pause
