<#
.SYNOPSIS
    Backs up PostgreSQL and MinIO from the DB server's Docker containers and
    prunes old backups.

.DESCRIPTION
    Every run writes one folder:  <BackupRoot>\yyyy-MM-dd_HHmmss_<noon|night>\
        postgres-<database>.dump   pg_dump custom format (restore with pg_restore)
        minio-<bucket>.tar         latest version of every object in the bucket

    The folder is written as "<name>.partial" and renamed only after every
    dump succeeded, so a half-written backup is never mistaken for a good one.

    Retention (age counted in calendar days back from today):
        0-6 days            everything (noon + night)
        7-20 days           one per day   - the night backup
        21 days - 3 months  one per week  - the earliest of the week (Sun-Sat)
        older               one per month - the earliest of the month
    Pruning runs only after a successful backup (or with -PruneOnly).

    Fridays and Saturdays are skipped (use -Force to back up anyway).

.EXAMPLE
    .\Backup-Databases.ps1 -Slot Night

.EXAMPLE
    .\Backup-Databases.ps1 -PruneOnly -WhatIf     # show what retention would delete

.EXAMPLE
    # Restore:
    #   docker cp postgres-testingsite.dump postgres:/tmp/r.dump
    #   docker exec postgres pg_restore -U appuser -d testingsite --clean --if-exists /tmp/r.dump
    #   tar -xf minio-digitalfactory-files.tar -C .\restore   then   mc mirror .\restore <alias>/digitalfactory-files
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('Auto', 'Noon', 'Night')]
    [string]$Slot = 'Auto',
    [string]$BackupRoot = 'C:\backups\scheduled',
    [string]$PostgresContainer = 'postgres',
    [string]$MinioContainer = 'FileServiceDB',
    # Empty = every non-template database on the server.
    [string[]]$Databases = @(),
    [string]$DockerExe = 'docker',
    [int]$KeepAllDays = 7,
    [int]$KeepDailyDays = 21,
    [int]$KeepWeeklyMonths = 3,
    [switch]$PruneOnly,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$SnapshotPattern = '^(\d{4}-\d{2}-\d{2})_(\d{6})_(noon|night)$'
$LogDir = Join-Path $BackupRoot 'logs'
$LogFile = Join-Path $LogDir ('backup-{0:yyyy-MM}.log' -f (Get-Date))

# Logging uses .NET directly so it still works under -WhatIf.
function Write-Log([string]$Message) {
    $line = '{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $Message
    Write-Host $line
    [void][IO.Directory]::CreateDirectory($LogDir)
    [IO.File]::AppendAllText($LogFile, $line + [Environment]::NewLine)
}

# Runs docker with the given arguments, returns stdout, throws on non-zero exit.
# Never put double quotes inside an argument: Windows PowerShell 5.1 does not
# escape them for native commands.
function Invoke-Docker {
    $out = & $DockerExe @args
    if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') failed (exit code $LASTEXITCODE)" }
    $out
}

function Backup-Postgres([string]$Dest) {
    $user = (Invoke-Docker exec $PostgresContainer printenv POSTGRES_USER | Select-Object -First 1).Trim()
    $dbs = $Databases
    if (-not $dbs) {
        $dbs = Invoke-Docker exec $PostgresContainer psql -U $user -d postgres -At -c `
            "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1"
        $dbs = @($dbs | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    if (-not $dbs) { throw 'No PostgreSQL databases found to back up' }

    foreach ($db in $dbs) {
        $inContainer = "/tmp/pgbackup-$db.dump"
        $target = Join-Path $Dest "postgres-$db.dump"
        Write-Log "postgres: dumping '$db'"
        try {
            Invoke-Docker exec $PostgresContainer pg_dump -U $user -d $db -Fc -f $inContainer | Out-Null
            Invoke-Docker cp "${PostgresContainer}:$inContainer" $target | Out-Null
        } finally {
            & $DockerExe exec $PostgresContainer rm -f $inContainer | Out-Null
        }
        Write-Log ('postgres: {0} ({1:N1} MB)' -f (Split-Path $target -Leaf), ((Get-Item $target).Length / 1MB))
    }
}

function Backup-Minio([string]$Dest) {
    # The MinIO image ships `mc`; credentials come from the container's own env.
    $mcInit = 'export MC_CONFIG_DIR=/tmp/.mc-backup; set -f; mc alias set bk http://localhost:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD >/dev/null'
    $lines = Invoke-Docker exec $MinioContainer sh -c "$mcInit && mc ls --json bk"
    $buckets = @($lines | Where-Object { $_ -match '^\s*\{' } | ForEach-Object { ($_ | ConvertFrom-Json).key.TrimEnd('/') } | Where-Object { $_ })
    if (-not $buckets) { Write-Log 'minio: no buckets found'; return }

    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    foreach ($bucket in $buckets) {
        $inContainer = "/tmp/miniobackup-$bucket"
        $hostTmp = Join-Path $Dest "_tmp-$bucket"
        $target = Join-Path $Dest "minio-$bucket.tar"
        Write-Log "minio: exporting bucket '$bucket'"
        try {
            Invoke-Docker exec $MinioContainer sh -c "$mcInit && rm -rf $inContainer && mkdir -p $inContainer && mc mirror --quiet bk/$bucket $inContainer >/dev/null" | Out-Null
            Invoke-Docker cp "${MinioContainer}:$inContainer/." $hostTmp | Out-Null
            & $tarExe -cf $target -C $hostTmp .
            if ($LASTEXITCODE -ne 0) { throw "tar failed for bucket '$bucket' (exit code $LASTEXITCODE)" }
        } finally {
            & $DockerExe exec $MinioContainer rm -rf $inContainer | Out-Null
            if (Test-Path $hostTmp) { Remove-Item $hostTmp -Recurse -Force }
        }
        Write-Log ('minio: {0} ({1:N1} MB)' -f (Split-Path $target -Leaf), ((Get-Item $target).Length / 1MB))
    }
}

function Get-Snapshots {
    if (-not (Test-Path $BackupRoot)) { return @() }
    $today = (Get-Date).Date
    Get-ChildItem $BackupRoot -Directory | ForEach-Object {
        if ($_.Name -match $SnapshotPattern) {
            $date = [datetime]::ParseExact($Matches[1], 'yyyy-MM-dd', $null)
            [pscustomobject]@{
                Dir  = $_
                Date = $date
                Time = $Matches[2]
                Slot = $Matches[3]
                Age  = ($today - $date).Days
            }
        }
    }
}

# Returns the snapshots to keep. Each tier picks a stable representative (night
# backup of the day, earliest of the week/month) so a backup moving into an
# older tier is never deleted in favour of one that is deleted later.
function Select-Retained($Snapshots) {
    $today = (Get-Date).Date
    $weeklyEdge = $today.AddDays(-$KeepDailyDays).AddMonths(-$KeepWeeklyMonths)
    $keep = New-Object System.Collections.Generic.List[object]

    $Snapshots | Where-Object { $_.Age -lt $KeepAllDays } | ForEach-Object { $keep.Add($_) }

    $perDay = @($Snapshots | Where-Object { $_.Age -ge $KeepAllDays } |
        Group-Object { $_.Date.ToString('yyyy-MM-dd') } | ForEach-Object {
            $_.Group | Sort-Object @{ e = { $_.Slot -eq 'night' }; Descending = $true }, @{ e = 'Time'; Descending = $true } |
                Select-Object -First 1
        })

    $perDay | Where-Object { $_.Age -lt $KeepDailyDays } | ForEach-Object { $keep.Add($_) }

    $perDay | Where-Object { $_.Age -ge $KeepDailyDays -and $_.Date -ge $weeklyEdge } |
        Group-Object { $_.Date.AddDays(-[int]$_.Date.DayOfWeek).ToString('yyyy-MM-dd') } |
        ForEach-Object { $keep.Add(($_.Group | Sort-Object Date | Select-Object -First 1)) }

    $perDay | Where-Object { $_.Date -lt $weeklyEdge } |
        Group-Object { $_.Date.ToString('yyyy-MM') } |
        ForEach-Object { $keep.Add(($_.Group | Sort-Object Date | Select-Object -First 1)) }

    $keep
}

function Invoke-Prune {
    [CmdletBinding(SupportsShouldProcess)] param()
    $snapshots = @(Get-Snapshots)
    $keepNames = @(Select-Retained $snapshots | ForEach-Object { $_.Dir.Name })
    $deleted = 0
    foreach ($s in $snapshots) {
        if ($keepNames -notcontains $s.Dir.Name -and $PSCmdlet.ShouldProcess($s.Dir.FullName, 'Delete old backup')) {
            Remove-Item $s.Dir.FullName -Recurse -Force
            Write-Log "prune: deleted $($s.Dir.Name)"
            $deleted++
        }
    }
    # Leftovers of runs that crashed before cleaning up after themselves.
    Get-ChildItem $BackupRoot -Directory -Filter '*.partial' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } | ForEach-Object {
            if ($PSCmdlet.ShouldProcess($_.FullName, 'Delete stale partial backup')) {
                Remove-Item $_.FullName -Recurse -Force
                Write-Log "prune: deleted stale $($_.Name)"
            }
        }
    Write-Log "prune: kept $($keepNames.Count), deleted $deleted"
}

# ---------------------------------------------------------------------------

try {
    if ($PruneOnly) {
        Invoke-Prune
        exit 0
    }
    if ($WhatIfPreference) { throw '-WhatIf is only supported together with -PruneOnly' }

    $now = Get-Date
    if (-not $Force -and $now.DayOfWeek -in [DayOfWeek]::Friday, [DayOfWeek]::Saturday) {
        Write-Log "skipped: no backups on $($now.DayOfWeek)"
        exit 0
    }
    if ($Slot -eq 'Auto') { $Slot = if ($now.Hour -lt 18) { 'Noon' } else { 'Night' } }

    $name = '{0:yyyy-MM-dd_HHmmss}_{1}' -f $now, $Slot.ToLower()
    $partial = Join-Path $BackupRoot "$name.partial"
    Write-Log "=== backup $name started ==="
    [void][IO.Directory]::CreateDirectory($partial)
    try {
        Backup-Postgres $partial
        Backup-Minio $partial
    } catch {
        Remove-Item $partial -Recurse -Force -ErrorAction SilentlyContinue
        throw
    }
    Rename-Item $partial $name
    Write-Log "=== backup $name completed ==="

    Invoke-Prune
    exit 0
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    exit 1
}
