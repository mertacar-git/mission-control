"""Production UI against real owned local services, with verified-TLS test adapter."""
import json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from mission_control.prototype import setup, ROOT
from tests.test_operator_accounts import PASSWORD


def main():
    output=Path(os.environ.get('MISSION_EVIDENCE_DIR',ROOT/'test-results/prototype-browser')).resolve()
    output.mkdir(parents=True,exist_ok=True)
    results=[]
    for viewport in ('desktop','mobile'):
        with tempfile.TemporaryDirectory(prefix='flw-prototype-') as temporary:
            directory=Path(temporary)/'runtime';setup(directory,'admin',PASSWORD)
            log_path=output/f'launcher-{viewport}.log'
            with log_path.open('w') as log:
                process=subprocess.Popen([sys.executable,'-m','mission_control.prototype','--directory',str(directory),'start','--no-browser','--seconds','30'],cwd=ROOT/'backend',stdout=log,stderr=subprocess.STDOUT)
            try:
                deadline=time.monotonic()+15
                while time.monotonic()<deadline and 'READY SYNTHETIC' not in log_path.read_text():
                    assert process.poll() is None,'Owned prototype startup failed'
                    time.sleep(.1)
                assert 'READY SYNTHETIC' in log_path.read_text(),'Prototype did not become ready'
                result=subprocess.run([shutil.which('node') or 'node',str(ROOT/'frontend/acceptance/center-prototype.mjs'),str(directory),str(output),viewport],cwd=ROOT/'frontend',stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=45)
                (output/f'browser-{viewport}.log').write_text(result.stdout)
                assert result.returncode==0,result.stdout
                results.append(dict(viewport=viewport,status='passed',transport='verified TLS 1.3 adapter; OS/browser trust not accepted',physical_sensor=False))
                assert process.wait(timeout=40)==0,'Prototype did not stop cleanly'
                assert not (directory/'launcher.lock').exists()
                assert not list(directory.glob('run-*/serial.token'))
            finally:
                if process.poll() is None:
                    if os.name=='nt':process.wait(timeout=40)
                    else:process.terminate();process.wait(timeout=15)
    (output/'results.json').write_text(json.dumps(dict(status='passed',cases=results,hardware='pending',second_pc='pending'),indent=2))
    print('Production center browser acceptance passed: desktop and 390 px; no physical/LAN acceptance.',flush=True)


if __name__=='__main__':main()
