<#
.SYNOPSIS
    start-dev.ps1 -- Windows PowerShell port of dev.sh.

.DESCRIPTION
    Runs the Biruk Subli AI service (FastAPI/uvicorn) and the web frontend
    (Vite) together for local and LAN (Wi-Fi) testing.

    Both servers bind to 0.0.0.0 so phones and other machines on the same
    network can reach them. Ctrl+C stops both; no zombies left on 8000/5173.

    Each service runs in its own console window so its log keeps the native
    tool colour and stays on screen if the service crashes. The launcher
    watches both and tears the survivor down as soon as either one stops.

.PARAMETER AiPort
    Port for the AI service. Precedence: -AiPort, then $env:AI_PORT, then 8000.

.PARAMETER WebPort
    Port for the Vite frontend. Precedence: -WebPort, then $env:WEB_PORT, then 5173.

.EXAMPLE
    .\start-dev.ps1

.EXAMPLE
    .\start-dev.ps1 -AiPort 8001 -WebPort 5174

.EXAMPLE
    $env:AI_PORT = 8001; .\start-dev.ps1
#>
[CmdletBinding()]
param(
    [int]$AiPort,
    [int]$WebPort
)

$ErrorActionPreference = 'Stop'

# --- env var fallbacks -------------------------------------------------------
# dev.sh reads AI_PORT / WEB_PORT; keep that working alongside the native
# -AiPort / -WebPort parameters.
if (-not $PSBoundParameters.ContainsKey('AiPort')) {
    if ($env:AI_PORT) { $AiPort = [int]$env:AI_PORT } else { $AiPort = 8000 }
}
if (-not $PSBoundParameters.ContainsKey('WebPort')) {
    if ($env:WEB_PORT) { $WebPort = [int]$env:WEB_PORT } else { $WebPort = 5173 }
}

$Root   = $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
$AiDir  = Join-Path $Root 'ai-service'
$WebDir = Join-Path $Root 'web'

# --- output helpers ----------------------------------------------------------
# dev.sh colourises only when stdout is a TTY; mirror that so piping the
# launcher into a file or another tool yields clean text.
$script:UseColor = $true
try { $script:UseColor = -not [Console]::IsOutputRedirected } catch { }

function Write-Info {
    param([string]$Message)
    if ($script:UseColor) {
        Write-Host '==> ' -NoNewline -ForegroundColor Green
        Write-Host $Message -ForegroundColor White
    } else {
        Write-Host "==> $Message"
    }
}

function Write-Warn {
    param([string]$Message)
    if ($script:UseColor) {
        Write-Host '==> ' -NoNewline -ForegroundColor Yellow
        Write-Host $Message -ForegroundColor Yellow
    } else {
        Write-Host "==> $Message"
    }
}

function Write-Die {
    param([string]$Message)
    if ($script:UseColor) {
        Write-Host '==> ' -NoNewline -ForegroundColor Red
        Write-Host $Message -ForegroundColor Red
    } else {
        Write-Host "==> $Message"
    }
    exit 1
}

# --- helpers -----------------------------------------------------------------

# PowerShell port of the `ss -ltnH sport = :PORT` probe, with the /dev/tcp
# connect attempt as the fallback.
function Test-PortInUse {
    param([int]$Port)

    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        try {
            $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
            if ($listeners) { return $true }
            return $false
        } catch {
            # No listener: the cmdlet raises a non-terminating "no matching
            # objects" error. Fall through to the connect probe to be sure.
        }
    }

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

# PowerShell port of `ip route get 1.1.1.1` + the `hostname -I` fallback.
#
# The UDP-connect trick (which asks the routing table which local address would
# source traffic to a public IP, sending no packets) is checked first, but it is
# NOT trusted blindly: on Windows a VPN tunnel such as Cloudflare WARP or a
# Hyper-V/WSL vSwitch usually has a lower interface metric than Wi-Fi, so the
# route lookup answers with a tunnel address no phone on the LAN can reach.
# Physical adapters are therefore preferred, and the route lookup is only the
# fallback when no physical adapter holds a usable address.
function Get-LanIp {
    $candidates = @()

    try {
        $adapters = Get-NetAdapter -Physical -ErrorAction Stop |
                    Where-Object { $_.Status -eq 'Up' }

        foreach ($adapter in $adapters) {
            $metric = 9999
            $iface = Get-NetIPInterface -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
            if ($iface) { $metric = $iface.InterfaceMetric }

            $addrs = Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                     Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }

            foreach ($addr in $addrs) {
                $candidates += [pscustomobject]@{ IP = $addr.IPAddress; Metric = $metric }
            }
        }
    } catch {
        # NetAdapter unavailable (Server Core, restricted session) -- fall back.
    }

    if ($candidates.Count -gt 0) {
        return ($candidates | Sort-Object Metric | Select-Object -First 1).IP
    }

    try {
        $udp = New-Object System.Net.Sockets.UdpClient
        $udp.Connect('1.1.1.1', 53)
        $addr = ([System.Net.IPEndPoint]$udp.Client.LocalEndPoint).Address
        $udp.Dispose()
        if ($addr -and -not [System.Net.IPAddress]::IsLoopback($addr) -and $addr.ToString() -ne '0.0.0.0') {
            return $addr.ToString()
        }
    } catch { }

    return '127.0.0.1'
}

# PowerShell port of `trap 'kill 0'`: dev.sh kills the whole process group,
# Windows kills the whole process tree. /T is what takes down npm -> node ->
# vite and the uvicorn --reload supervisor with its worker.
function Stop-ServiceTree {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Label
    )

    if ($null -eq $Process) { return }

    $alive = $true
    try { $alive = -not $Process.HasExited } catch { $alive = $false }
    if (-not $alive) { return }

    Write-Host ('      stopping {0} (pid {1})' -f $Label, $Process.Id) -ForegroundColor DarkGray
    & taskkill.exe /PID $Process.Id /T /F > $null 2>&1
}

# --- pre-flight checks -------------------------------------------------------
if (-not (Test-Path (Join-Path $AiDir 'main.py'))) {
    Write-Die "ai-service\main.py not found (looked in $AiDir)"
}
if (-not (Test-Path (Join-Path $WebDir 'package.json'))) {
    Write-Die "web\package.json not found (looked in $WebDir)"
}

# npm ships several shims on Windows; Start-Process needs npm.cmd, because the
# npm.ps1 that `Get-Command npm` resolves to first cannot be launched directly.
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) {
    $fallback = Join-Path $env:ProgramFiles 'nodejs\npm.cmd'
    if (Test-Path $fallback) { $npmCmd = $fallback }
}
if (-not $npmCmd) {
    Write-Die "npm.cmd not found -- install Node.js to run the Vite frontend."
}

# Prefer the project's venv. The repo has requirements.txt and no pyproject,
# so `uv run` would build a fresh env and re-download torch; a venv created
# under WSL/Linux has bin/ instead of Scripts/ and cannot be used from Windows.
$venvDir     = Join-Path $AiDir 'venv'
$venvUvicorn = Join-Path $AiDir 'venv\Scripts\uvicorn.exe'
$venvPython  = Join-Path $AiDir 'venv\Scripts\python.exe'

$AiExe = $null
$AiArgPrefix = @()

if (Test-Path $venvUvicorn) {
    $AiExe = $venvUvicorn
} elseif (Test-Path $venvPython) {
    # Tolerate a venv holding uvicorn as a module but no console shim.
    $AiExe = $venvPython
    $AiArgPrefix = @('-m', 'uvicorn')
} else {
    $uv = Get-Command uv -ErrorAction SilentlyContinue
    if ($uv) {
        $AiExe = $uv.Source
        $AiArgPrefix = @('run', '--with-requirements', 'requirements.txt', 'uvicorn')
        Write-Warn "No ai-service\venv -- falling back to 'uv run' (may re-resolve/download dependencies)."
    } else {
        $globalUvicorn = Get-Command uvicorn -ErrorAction SilentlyContinue
        if ($globalUvicorn) {
            $AiExe = $globalUvicorn.Source
            if (Test-Path $venvDir) {
                Write-Warn "ai-service\venv has no Scripts\uvicorn.exe (created under WSL/Linux?) -- using the global uvicorn instead."
            } else {
                Write-Warn "No ai-service\venv and no 'uv' -- using the global uvicorn. Install the deps there, or create the env:"
            }
            Write-Warn "  python -m venv ai-service\venv"
            Write-Warn "  ai-service\venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt"
        } else {
            Write-Die "No ai-service\venv, no 'uv' and no global uvicorn. Create the env:
    python -m venv ai-service\venv
    ai-service\venv\Scripts\python.exe -m pip install -r ai-service\requirements.txt"
        }
    }
}

if (-not (Test-Path (Join-Path $WebDir 'node_modules'))) {
    Write-Die "web\node_modules missing -- run: cd web; npm install"
}

# --- port checks -------------------------------------------------------------
foreach ($p in @($AiPort, $WebPort)) {
    if (Test-PortInUse -Port $p) {
        Write-Die "Port $p is already in use. Stop the process using it, or override with -AiPort / -WebPort (or AI_PORT= / WEB_PORT=)."
    }
}

# --- launch ------------------------------------------------------------------
$aiArgs = @()
if ($AiArgPrefix.Count -gt 0) { $aiArgs += $AiArgPrefix }
$aiArgs += @('main:app', '--host', '0.0.0.0', '--port', "$AiPort", '--reload')

Write-Info "Starting AI service  -> http://0.0.0.0:$AiPort (loading CLIP model on first run)"
$aiProc = Start-Process -FilePath $AiExe -ArgumentList $aiArgs `
    -WorkingDirectory $AiDir -PassThru

Write-Info "Starting web frontend -> http://0.0.0.0:$WebPort"
$webProc = Start-Process -FilePath $npmCmd `
    -ArgumentList @('run', 'dev', '--', '--host', '0.0.0.0', '--port', "$WebPort") `
    -WorkingDirectory $WebDir -PassThru

$IP = Get-LanIp
$banner = @"

  Biruk Subli -- dev servers running

  Local:   http://localhost:$WebPort
  Network: http://${IP}:$WebPort          (open this on your phone)
  API:     http://${IP}:$AiPort/health     (LAN)

  Both bind to 0.0.0.0. On the first run Windows Firewall may prompt for
  node.exe and python.exe -- allow Private networks, or your phone cannot
  reach $WebPort/tcp and $AiPort/tcp.
  Press Ctrl+C to stop both servers.

"@
Write-Host $banner -ForegroundColor White

# --- wait, then teardown -----------------------------------------------------
# dev.sh does `wait -n`: exit (and tear everything down) as soon as either
# server stops. The `finally` block is what runs on Ctrl+C.
$exitedLabel = $null
$exitCode = 0

try {
    while ($true) {
        $aiAlive = $true
        $webAlive = $true
        try { $aiAlive = -not $aiProc.HasExited } catch { $aiAlive = $false }
        try { $webAlive = -not $webProc.HasExited } catch { $webAlive = $false }

        if (-not $aiAlive) {
            $exitedLabel = 'AI service'
            try { $exitCode = $aiProc.ExitCode } catch { $exitCode = 1 }
            break
        }
        if (-not $webAlive) {
            $exitedLabel = 'Web frontend'
            try { $exitCode = $webProc.ExitCode } catch { $exitCode = 1 }
            break
        }

        Start-Sleep -Milliseconds 400
    }
} finally {
    Stop-ServiceTree -Process $aiProc -Label 'AI service'
    Stop-ServiceTree -Process $webProc -Label 'Web frontend'
}

if ($exitedLabel) {
    Write-Warn "$exitedLabel exited (status $exitCode) -- shutting down the other."
}

exit $exitCode
