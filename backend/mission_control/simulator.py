import asyncio
import os
from pathlib import Path
import subprocess
import tempfile

REVISION='92b0cd788ec29406f26c6f9c31d5ceedbd1cc538'
HOME=(41.0082,28.9784,30.0,0.0)

class Simulator:
    def __init__(self, runtime=None, state_directory=None):
        self.runtime=Path(runtime or os.environ.get('MISSION_RUNTIME','/opt/mission-control'))
        self.state_directory=Path(state_directory or '.runtime/simulator')
        self.process=None
        self.log=None
        self.workdir=None

    @property
    def running(self): return self.process is not None and self.process.returncode is None

    async def start(self,speedup=1):
        if self.running: raise RuntimeError('An owned simulator is already running.')
        checkout=self.runtime/'ardupilot'
        executable=checkout/'build/sitl/bin/arducopter'
        if not executable.is_file(): raise RuntimeError('SITL is not installed. Run simulator/setup.sh first.')
        revision=subprocess.run(['git','rev-parse','HEAD'],cwd=checkout,capture_output=True,text=True,check=True).stdout.strip()
        if revision!=REVISION: raise RuntimeError('Simulator revision differs from Copter-4.6.3.')
        self.state_directory.mkdir(parents=True,exist_ok=True)
        self.workdir=Path(tempfile.mkdtemp(prefix='flight-',dir=self.state_directory.resolve()))
        self.log=(self.workdir/'sitl.log').open('wb')
        self.process=await asyncio.create_subprocess_exec(str(executable),'-S','-I0','--model','quad','--speedup',str(speedup),
            '--home',','.join(map(str,HOME)),'--defaults',str(checkout/'Tools/autotest/default_params/copter.parm'),
            '--serial0=udpclient:127.0.0.1:14550',cwd=self.workdir,stdout=self.log,stderr=asyncio.subprocess.STDOUT)
        await asyncio.sleep(0.2)
        if not self.running: raise RuntimeError(f'SITL failed to start. Inspect {self.workdir / "sitl.log"}.')

    async def stop(self):
        if self.running:
            self.process.terminate()
            try: await asyncio.wait_for(self.process.wait(),5)
            except asyncio.TimeoutError:
                self.process.kill(); await self.process.wait()
        if self.log: self.log.close(); self.log=None

