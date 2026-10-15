import asyncio,json,time,sys
from uuid import uuid4
from .models import utc_now
from .emulator_protocol import decode
from .emulator_sender import PROFILES

class Receiver(asyncio.DatagramProtocol):
    def __init__(self,owner):self.owner=owner
    def datagram_received(self,data,address):self.owner.receive(data,address)

class Emulator:
    def __init__(self,store):
        self.store=store;self.task=None;self.transport=None;self.process=None;self.run=None;self.owner=None
        self.stop_lock=asyncio.Lock()
    @property
    def active(self):return self.task is not None and not self.task.done()
    def status(self):
        current=json.loads(json.dumps(self.run)) if self.run else None
        if current:
            latest=next((e['frame'] for e in reversed(current['packets']) if e['classification']=='accepted'),None)
            age=time.monotonic()-self.started-latest['received_elapsed_s'] if latest and self.active else None
            current['latest']=latest if self.active and age is not None and age<3 else None
            current['stream_state']='connected' if current['latest'] else 'stale' if self.active else 'closed'
        return current
    def start(self,owner,profile,seed,duration):
        if self.active:raise RuntimeError('An emulator run is already active.')
        if profile not in PROFILES or not isinstance(seed,int) or not 0<=seed<=2**31-1 or not 5<=duration<=60:raise ValueError('Invalid experiment settings.')
        self.owner=owner;self.started=time.monotonic();self.seen=set();self.maxima={};self.current_boot=-1
        self.run=dict(schema_version=1,source='emulator',id=str(uuid4()),profile=profile,seed=seed,rate_hz=5,duration_s=duration,expected_packets=duration*5,
            status='running',started_utc=utc_now(),ended_utc=None,error=None,packets=[],counters=dict(received=0,accepted=0,duplicates=0,out_of_order=0,corrupt=0,foreign=0,sequence_missing=0,boots=0))
        self.store.save_emulator(self.run);self.task=asyncio.create_task(self.execute())
        return self.status()
    def receive(self,data,address):
        if not self.run or self.run['status']!='running':return
        counters=self.run['counters'];counters['received']+=1;frame=None;error=None
        try:
            frame=decode(data)
            if address[0]!='127.0.0.1' or frame['stream_id']!=self.run['id'].replace('-',''):
                classification='foreign';counters['foreign']+=1
            else:
                boot,seq=frame['boot_id'],frame['sequence'];key=(boot,seq)
                if seq>=self.run['expected_packets'] or boot not in ([0,1] if self.run['profile']=='restart' else [0]):raise ValueError('unexpected_sequence_or_boot')
                if key in self.seen:classification='duplicate';counters['duplicates']+=1
                else:
                    late=boot<self.current_boot or seq<self.maxima.get(boot,-1)
                    self.seen.add(key);self.maxima[boot]=max(seq,self.maxima.get(boot,-1));self.current_boot=max(boot,self.current_boot)
                    classification='out_of_order' if late else 'accepted';counters['out_of_order' if late else 'accepted']+=1
                counters['boots']=len(self.maxima)
                counters['sequence_missing']=sum(v+1 for v in self.maxima.values())-len(self.seen)
        except ValueError as exc:classification='corrupt';error=str(exc);counters['corrupt']+=1;frame=None
        elapsed=time.monotonic()-self.started
        if frame:frame.update(received_elapsed_s=elapsed,received_utc=utc_now())
        self.run['packets'].append(dict(received_elapsed_s=elapsed,received_utc=utc_now(),classification=classification,error=error,frame=frame,raw_hex=data[:1024].hex(),datagram_bytes=len(data)))
        self.store.save_emulator(self.run)
    async def execute(self):
        try:
            loop=asyncio.get_running_loop();self.transport,_=await loop.create_datagram_endpoint(lambda:Receiver(self),local_addr=('127.0.0.1',14600))
            count=self.run['expected_packets'];parts=[(0,count)] if self.run['profile']!='restart' else [(0,count//2),(1,count-count//2)]
            for boot,size in parts:
                self.process=await asyncio.create_subprocess_exec(sys.executable,'-m','mission_control.emulator_sender','--stream',self.run['id'].replace('-',''),'--profile',self.run['profile'],'--seed',str(self.run['seed']),'--count',str(size),'--boot',str(boot),stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL)
                code=await asyncio.wait_for(self.process.wait(),65)
                if code:raise RuntimeError(f'Owned sender exited with code {code}.')
                if len(parts)>1:await asyncio.sleep(.6)
            await asyncio.sleep(.5)
            if not self.seen:raise RuntimeError('No valid packet observed from the owned sender.')
            self.run['counters']['sequence_missing']=count-len(self.seen)
            self.run['status']='completed'
        except asyncio.CancelledError:self.run.update(status='interrupted',error='Stopped before experiment completion.')
        except Exception as exc:self.run.update(status='failed',error=str(exc))
        finally:
            if self.process and self.process.returncode is None:
                self.process.terminate()
                try:await asyncio.wait_for(self.process.wait(),3)
                except asyncio.TimeoutError:self.process.kill();await self.process.wait()
            if self.transport:self.transport.close();self.transport=None
            self.run['ended_utc']=utc_now();self.store.save_emulator(self.run)
    async def stop(self):
        async with self.stop_lock:
            if self.active:
                await asyncio.sleep(0)
                if not self.task.done() and self.run['status']=='running':self.task.cancel()
                await asyncio.shield(self.task)
