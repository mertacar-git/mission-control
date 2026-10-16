param([switch]$Synthetic)
$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$serialPython = Join-Path $projectPath '.venv-serial/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $serialPython)) {
    py -3.12 -m venv (Join-Path $projectPath '.venv-serial')
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required.' }
}
& $serialPython -m pip install -r (Join-Path $projectPath 'backend/requirements-serial.txt')
if ($LASTEXITCODE -ne 0) { throw 'Serial receiver dependencies could not be installed.' }
Push-Location (Join-Path $projectPath 'backend')
try {
    if ($Synthetic) { & $serialPython -m mission_control.serial_service --synthetic }
    else { & $serialPython -m mission_control.serial_service }
} finally { Pop-Location }
