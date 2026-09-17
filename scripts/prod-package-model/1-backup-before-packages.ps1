# ===========================================================================
# גיבוי DB הייצור לפני השדרוג למודל המארזים
# ===========================================================================
#   .\1-backup-before-packages.ps1
#   .\1-backup-before-packages.ps1 -OutDir "D:\backups"
#   .\1-backup-before-packages.ps1 -Container postgres -User p7300admin -Database testingsite
#
# מה הוא עושה:
#   1. מוודא ש-docker רץ ושהקונטיינר של הפוסטגרס רץ.
#   2. לוקח את שם המשתמש ושם ה-DB מהקונטיינר עצמו (POSTGRES_USER / POSTGRES_DB),
#      אלא אם נתת אותם כפרמטרים.
#   3. מריץ pg_dump בפורמט custom (-Fc) בתוך הקונטיינר, מעתיק את הקובץ החוצה
#      (docker cp — בינארי, בלי שה-PowerShell יגע בתוכן), ומוחק את העותק הזמני.
#   4. בודק שהקובץ לא ריק ושאפשר לקרוא אותו (pg_restore --list).
#   5. מדפיס איך משחזרים.
#
# הגיבוי הוא של DB האפליקציה בלבד; ה-DB של Keycloak לא נוגע בשדרוג.
# מריצים על שרת ה-DB (המכונה שבה רץ הקונטיינר).
# ===========================================================================
param(
    [string]$Container = "postgres",
    [string]$OutDir = "E:\package-model\backups",
    [string]$User = "",
    [string]$Database = ""
)

# לא "Stop": docker ו-pg_dump כותבים הודעות רגילות ל-stderr, ו-PowerShell 5.1
# היה הופך אותן לשגיאה. קודי היציאה נבדקים במפורש.
$ErrorActionPreference = "Continue"

function Fail([string]$msg) {
    Write-Host ""
    Write-Host "!! $msg" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== גיבוי לפני השדרוג למארזים ===" -ForegroundColor Cyan

# ---- 1. docker + container -------------------------------------------------
$null = docker version 2>$null
if ($LASTEXITCODE -ne 0) { Fail "docker לא זמין. הרץ את הסקריפט על שרת ה-DB, כמשתמש שיכול להריץ docker." }
$state = docker inspect -f '{{.State.Status}}' $Container 2>$null
if ("$state".Trim() -ne "running") { Fail "הקונטיינר '$Container' לא רץ (מצב: '$state')." }

# ---- 2. user / database ----------------------------------------------------
if (-not $User)     { $User     = ("$(docker exec $Container sh -c 'printf %s "$POSTGRES_USER"')").Trim() }
if (-not $Database) { $Database = ("$(docker exec $Container sh -c 'printf %s "$POSTGRES_DB"')").Trim() }
if (-not $User -or -not $Database) { Fail "לא הצלחתי לקרוא POSTGRES_USER / POSTGRES_DB מהקונטיינר. תן אותם עם -User ו- -Database." }
Write-Host "  קונטיינר: $Container · משתמש: $User · DB: $Database"

$ready = docker exec $Container pg_isready -U $User -d $Database 2>$null
if ($LASTEXITCODE -ne 0) { Fail "הפוסטגרס לא מקבל חיבורים ($ready)." }

# ---- 3. dump inside the container, then copy out ---------------------------
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }
$stamp   = Get-Date -Format "yyyyMMdd-HHmmss"
$name    = "$Database-before-packages-$stamp.dump"
$inside  = "/tmp/$name"
$outFile = Join-Path $OutDir $name

Write-Host "  מריץ pg_dump (-Fc) ..."
docker exec $Container pg_dump -U $User -Fc -f $inside $Database
if ($LASTEXITCODE -ne 0) { Fail "pg_dump נכשל." }

$entries = ("$(docker exec $Container sh -c "pg_restore --list $inside | grep -c -v '^;'")").Trim()
if ($LASTEXITCODE -ne 0 -or -not $entries -or [int]$entries -lt 10) { Fail "קובץ הגיבוי לא נראה תקין (pg_restore --list החזיר '$entries')." }

docker cp "${Container}:$inside" $outFile | Out-Null
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outFile)) { Fail "docker cp נכשל — הקובץ לא הועתק ל-$outFile." }
docker exec $Container rm -f $inside 2>$null | Out-Null

$size = (Get-Item $outFile).Length
if ($size -lt 1024) { Fail "קובץ הגיבוי קטן מדי ($size bytes)." }

# ---- 4. a few counts, so the backup can be matched to the state ------------
$counts = docker exec $Container psql -U $User -d $Database -tAX -c "SELECT (SELECT count(*) FROM items) || ' items, ' || (SELECT count(*) FROM shipments) || ' shipments, ' || (SELECT count(*) FROM item_routes) || ' routes'"
Write-Host ""
Write-Host "  הגיבוי נשמר: $outFile" -ForegroundColor Green
Write-Host "  גודל: $([math]::Round($size / 1MB, 2)) MB · אובייקטים בגיבוי: $entries · תוכן: $("$counts".Trim())" -ForegroundColor Green

# ---- 5. how to restore -----------------------------------------------------
Write-Host ""
Write-Host "  שחזור (רק אם צריך לחזור אחורה; מוחק ומחליף את ה-DB הנוכחי):" -ForegroundColor Yellow
Write-Host "    docker cp `"$outFile`" ${Container}:/tmp/restore.dump"
Write-Host "    docker exec $Container pg_restore -U $User -d $Database --clean --if-exists --no-owner /tmp/restore.dump"
Write-Host "    docker exec $Container rm -f /tmp/restore.dump"
Write-Host ""
Write-Host "עכשיו אפשר להריץ את 2-upgrade-to-packages.sql." -ForegroundColor Cyan
Write-Host ""
