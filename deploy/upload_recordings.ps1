<#
Заливка записей турнира с ПК в мини-приложение бота TI:IT TOP (бот лежит на сервере в /opt/ti-it-top, в репозитории его нет —
поэтому скрипт здесь, в deploy/).

Что делает: берёт новые .mp4 из папки OBS, по имени «2026-10-23 17-49-45.mp4» считает время начала (местное → UTC),
собирает тройку <id>.mp4 + <id>.jpg (кадр) + <id>.json и заливает в /opt/ti-it-top/RECORDINGS на сервере через
папку .incoming (бот видит запись только после появления .json, поэтому недокачанный файл не подхватится).
Повторный запуск уже загруженное пропускает (список в .uploaded.json рядом с видео и проверка на сервере).

Запуск:  powershell -ExecutionPolicy Bypass -File upload_recordings.ps1            — залить всё новое
         powershell -ExecutionPolicy Bypass -File upload_recordings.ps1 -WhatIf    — только показать план
         ... -Tournament 2                                                          — привязать к турниру №2
             (без параметра бот сам подбирает турнир по матчам, сыгранным во время записи)

Нужно на ПК: ssh/scp (встроены в Windows 10/11) и вход на сервер по ключу без пароля:
    ssh-keygen -t ed25519            (Enter на все вопросы)
    type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@13.143.162.211 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
Для кадра-превью и точной длительности — ffmpeg:  winget install Gyan.FFmpeg  (без него длительность и высоту
скрипт берёт из свойств файла Windows, а превью не делает — карточка будет без картинки).
#>
param(
    [string]$Source = "C:\Users\St999\Videos\Tournament",
    [string]$Server = "root@13.143.162.211",
    [string]$Remote = "/opt/ti-it-top/RECORDINGS",
    [int]$Tournament = 0,
    # Файл, изменённый меньше этого числа минут назад, считается ещё записываемым
    [int]$SettleMinutes = 3,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"
$ledgerPath = Join-Path $Source ".uploaded.json"
$ledger = @{}
if (Test-Path $ledgerPath) {
    try { (Get-Content $ledgerPath -Raw | ConvertFrom-Json).PSObject.Properties | ForEach-Object { $ledger[$_.Name] = $_.Value } } catch { }
}
function Save-Ledger { $ledger | ConvertTo-Json | Set-Content $ledgerPath -Encoding UTF8 }

$ffprobe = Get-Command ffprobe -ErrorAction SilentlyContinue
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if (-not $ffprobe) { Write-Host "ffprobe не найден: длительность возьму из свойств Windows, превью не будет (winget install Gyan.FFmpeg)" -ForegroundColor Yellow }

function Invoke-Ssh([string]$cmd) {
    $out = & ssh -o BatchMode=yes -o ConnectTimeout=15 $Server $cmd 2>&1
    if ($LASTEXITCODE -ne 0) { throw "ssh: $out" }
    return $out
}

# Длительность (с) и высота (px): ffprobe, иначе свойства файла через проводник
function Get-VideoInfo([System.IO.FileInfo]$file) {
    if ($ffprobe) {
        $json = & ffprobe -v error -show_entries "format=duration:stream=height,codec_type" -of json $file.FullName | ConvertFrom-Json
        $video = $json.streams | Where-Object { $_.codec_type -eq "video" } | Select-Object -First 1
        return @{ duration = [math]::Round([double]$json.format.duration, 1); height = [int]$video.height }
    }
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.Namespace($file.DirectoryName)
    $item = $folder.ParseName($file.Name)
    # 27 — длительность (чч:мм:сс), 314 — высота кадра; номера свойств проводника Windows
    $dur = $folder.GetDetailsOf($item, 27)
    $h = $folder.GetDetailsOf($item, 314) -replace "\D", ""
    $seconds = 0.0
    if ($dur -match "^(\d+):(\d+):(\d+)$") { $seconds = [int]$Matches[1] * 3600 + [int]$Matches[2] * 60 + [int]$Matches[3] }
    return @{ duration = $seconds; height = $(if ($h) { [int]$h } else { $null }) }
}

# Время начала записи: из имени OBS «2026-10-23 17-49-45.mp4», иначе время создания файла (местное время ПК)
function Get-StartTime([System.IO.FileInfo]$file) {
    if ($file.BaseName -match "^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2})") {
        return Get-Date -Year $Matches[1] -Month $Matches[2] -Day $Matches[3] -Hour $Matches[4] -Minute $Matches[5] -Second $Matches[6] -Millisecond 0
    }
    return $file.CreationTime
}

# Шесть цифр хвоста id — из хэша имени: один и тот же файл всегда даёт тот же id
function Get-Suffix([string]$name) {
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = $md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($name))
    return "{0:D6}" -f ([BitConverter]::ToUInt32($bytes, 0) % 1000000)
}

$files = Get-ChildItem -Path $Source -Filter *.mp4 -File | Sort-Object LastWriteTime
if (-not $files) { Write-Host "В $Source нет .mp4"; exit 0 }

Invoke-Ssh "mkdir -p '$Remote/.incoming'" | Out-Null
$remoteJsons = @((Invoke-Ssh "ls '$Remote' | grep '\.json$' || true") | ForEach-Object { $_.Trim() -replace "\.json$", "" } | Where-Object { $_ })
# Имена исходных файлов уже загруженных записей (поле source в json): так не зальём то, что заливал старый скрипт
$remoteSources = @{}
foreach ($line in @(Invoke-Ssh "cd '$Remote' && grep -H '\"source\"' *.json 2>/dev/null || true")) {
    if ($line -match '^(.+?)\.json:.*"source"\s*:\s*"(.+?)"') { $remoteSources[$Matches[2]] = $Matches[1] }
}

foreach ($f in $files) {
    if ($ledger.ContainsKey($f.Name)) { Write-Host "пропуск (уже загружен): $($f.Name)"; continue }
    if ($remoteSources.ContainsKey($f.Name)) {
        Write-Host "пропуск (уже на сервере как $($remoteSources[$f.Name])): $($f.Name)"
        $ledger[$f.Name] = $remoteSources[$f.Name]; Save-Ledger
        continue
    }
    if ((Get-Date) - $f.LastWriteTime -lt [TimeSpan]::FromMinutes($SettleMinutes)) { Write-Host "пропуск (ещё пишется): $($f.Name)"; continue }

    $start = Get-StartTime $f
    $startUtc = $start.ToUniversalTime()
    $id = $startUtc.ToString("yyyyMMdd-HHmmss") + "-" + (Get-Suffix $f.Name)
    if ($remoteJsons -contains $id) {
        Write-Host "пропуск (уже на сервере): $($f.Name) → $id"
        $ledger[$f.Name] = $id; Save-Ledger
        continue
    }

    $info = Get-VideoInfo $f
    $meta = [ordered]@{
        title       = "Трансляция " + $start.ToString("dd.MM.yyyy HH:mm")
        recorded_at = $startUtc.ToString("yyyy-MM-ddTHH:mm:ssZ")
        duration    = $info.duration
        size        = $f.Length
        height      = $info.height
        source      = $f.Name
        uploaded_at = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.ffffffZ")
    }
    if ($Tournament -gt 0) { $meta.tournament_id = $Tournament }

    Write-Host ("`n{0} -> {1}  ({2:N1} ГБ, {3} с, {4}p)" -f $f.Name, $id, ($f.Length / 1GB), $info.duration, $info.height)
    if ($WhatIf) { continue }

    $tmp = Join-Path $env:TEMP "rec-$id"
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $jsonPath = Join-Path $tmp "$id.json"
    [System.IO.File]::WriteAllText($jsonPath, ($meta | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
    $jpgPath = $null
    if ($ffmpeg) {
        $jpgPath = Join-Path $tmp "$id.jpg"
        # Кадр через 2% длительности (чтобы не попасть на чёрный экран в начале), ширина 640
        $at = [math]::Max(5, [math]::Floor($info.duration * 0.02))
        & ffmpeg -v error -y -ss $at -i $f.FullName -frames:v 1 -vf "scale=640:-2" -q:v 4 $jpgPath
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path $jpgPath)) { $jpgPath = $null }
    }

    Write-Host "  заливаю видео..."
    & scp -o BatchMode=yes -q $f.FullName "${Server}:$Remote/.incoming/$id.mp4"
    if ($LASTEXITCODE -ne 0) { throw "scp видео не прошёл: $($f.Name)" }
    $remoteSize = (Invoke-Ssh "stat -c %s '$Remote/.incoming/$id.mp4'").Trim()
    if ([int64]$remoteSize -ne $f.Length) { throw "размер на сервере $remoteSize != $($f.Length), файл не докачан: $($f.Name)" }
    if ($jpgPath) { & scp -o BatchMode=yes -q $jpgPath "${Server}:$Remote/.incoming/$id.jpg" }
    & scp -o BatchMode=yes -q $jsonPath "${Server}:$Remote/.incoming/$id.json"
    if ($LASTEXITCODE -ne 0) { throw "scp json не прошёл: $($f.Name)" }
    # Сначала видео и кадр, последним json — бот покажет запись только целиком
    Invoke-Ssh "cd '$Remote/.incoming' && mv -f '$id.mp4' .. && (test -f '$id.jpg' && mv -f '$id.jpg' .. || true) && mv -f '$id.json' .." | Out-Null
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue

    $ledger[$f.Name] = $id; Save-Ledger
    Write-Host "  готово: $id" -ForegroundColor Green
}
Write-Host "`nВсё. Записи в мини-приложении появятся сразу."
