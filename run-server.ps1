# Vicinity server watchdog — держит сервер живым: если он падает, поднимает заново
# через 2 секунды. Падения пишутся в server_crash.log, stderr — в srv_stderr.txt.
$dir = "C:\Users\St999\Downloads\CPMessenger\build\backend\Release"
$exe = "$dir\VicinityServer.exe"
$crashLog = "C:\Users\St999\Downloads\CPMessenger\server_crash.log"

Write-Host "=== Vicinity server watchdog (авто-перезапуск) ===" -ForegroundColor Cyan

while ($true) {
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] СТАРТ сервера" | Out-File -Append -Encoding utf8 $crashLog
    Write-Host "[$(Get-Date -Format HH:mm:ss)] сервер запущен" -ForegroundColor Green
    $p = Start-Process -FilePath $exe -WorkingDirectory $dir -PassThru -WindowStyle Hidden `
            -RedirectStandardError "$dir\srv_stderr.txt" -RedirectStandardOutput "$dir\srv_stdout.txt"
    $p.WaitForExit()
    $code = $p.ExitCode
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] сервер ВЫШЕЛ (код=$code). Перезапуск через 2с." | Out-File -Append -Encoding utf8 $crashLog
    Write-Host "[$(Get-Date -Format HH:mm:ss)] сервер упал (код $code) — перезапуск..." -ForegroundColor Red
    Start-Sleep -Seconds 2
}
