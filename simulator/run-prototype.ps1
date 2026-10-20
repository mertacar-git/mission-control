param(
    [ValidateSet('Setup','Check','Start')][string]$Action = 'Start',
    [string]$Directory,
    [ValidateSet('synthetic','serial')][string]$Profile = 'synthetic',
    [string]$Port,
    [string]$Stream,
    [string]$PythonPath,
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
if (-not $Directory) { $Directory = Join-Path $projectPath '.runtime/prototype' }
if (-not $PythonPath) { $PythonPath = Join-Path $projectPath '.venv-center/Scripts/python.exe' }
if ($Action -eq 'Setup') {
    if (Test-Path -LiteralPath $Directory) { throw 'Setup directory already exists. Start does not recreate accounts or certificates.' }
    if (-not (Test-Path -LiteralPath $PythonPath)) {
        py -3.12 -m venv (Join-Path $projectPath '.venv-center')
        if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required.' }
    }
    & $PythonPath -m pip install -r (Join-Path $projectPath 'backend/requirements-center.txt')
    if ($LASTEXITCODE -ne 0) { throw 'Center dependencies could not be installed.' }
    Push-Location (Join-Path $projectPath 'frontend')
    try {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
        npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    } finally { Pop-Location }
}
if (-not (Test-Path -LiteralPath $PythonPath)) { throw 'Run Setup first. Start never installs or changes dependencies.' }
$prototypeArgs = @('-m','mission_control.prototype','--directory',$Directory,$Action.ToLowerInvariant())
if ($Action -eq 'Setup') {
    $prototypeArgs += @('--profile',$Profile)
    if ($Port) { $prototypeArgs += @('--port',$Port) }
    if ($Stream) { $prototypeArgs += @('--stream',$Stream) }
}
if ($Action -eq 'Start' -and $NoBrowser) { $prototypeArgs += '--no-browser' }
Push-Location (Join-Path $projectPath 'backend')
try { & $PythonPath @prototypeArgs; $prototypeExit = $LASTEXITCODE }
finally { Pop-Location }
if ($prototypeExit -ne 0) { throw 'Prototype command failed. Review the diagnostic above and the current run logs.' }
