import importlib.util, json, subprocess, sys, tempfile
from pathlib import Path
from mission_control.prototype import setup, preflight, launch, ROOT
assert importlib.util.find_spec('pymavlink') is None
assert importlib.util.find_spec('shapely') is None
with tempfile.TemporaryDirectory(prefix='flw-clean-center-') as temporary:
    directory=Path(temporary)/'prototype'
    setup(directory,'admin','test-only clean smoke passphrase')
    preflight(directory)
    result=subprocess.run(['powershell','-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'simulator/run-prototype.ps1'),'-Action','Check','-Directory',str(directory),'-PythonPath',sys.executable],capture_output=True,text=True)
    assert result.returncode==0,result.stdout+result.stderr
    print(result.stdout.strip())
    launch(directory,open_browser=False,seconds=2)
    assert not (directory/'launcher.lock').exists()
    assert not list(directory.glob('run-*/serial.token'))
print(json.dumps(dict(status='passed',python=sys.version.split()[0],environment='fresh Windows venv with requirements-center only',pymavlink=False,shapely=False)))
