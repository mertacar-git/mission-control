"""Real subprocess/UDP acceptance, including process restart, raw replay and export."""
import asyncio,json
from pathlib import Path
from mission_control.emulator import Emulator
from mission_control.store import Store
from mission_control.emulator_protocol import encode
from .test_emulator import STREAM

async def main():
    root=Path(__file__).resolve().parents[2];output=root/'docs/verification/emulator';public=root/'frontend/public/emulator'
    output.mkdir(parents=True,exist_ok=True);public.mkdir(parents=True,exist_ok=True)
    store=Store(':memory:');emulator=Emulator(store);results=[];index=[]
    try:
        for profile in ['nominal','mixed','sensor_gap','restart']:
            emulator.start('acceptance',profile,42,5);await emulator.task
            run=emulator.run;assert run['status']=='completed',run['error']
            count=run['counters'];assert count['accepted']>0
            if profile=='nominal':assert count['sequence_missing']==0 and count['corrupt']==0
            if profile=='mixed':assert count['corrupt']>0 and count['sequence_missing']>0 and count['out_of_order']>0
            if profile=='sensor_gap':assert any(e['frame'] and e['frame']['relative_altitude_m'] is None for e in run['packets'])
            if profile=='restart':assert count['boots']==2 and count['sequence_missing']==0
            for folder in (output,public):(folder/f'{run["id"]}.json').write_text(json.dumps(run,indent=2))
            index.append({k:v for k,v in run.items() if k!='packets'});results.append(dict(profile=profile,status='passed',id=run['id'],counters=count))
            print(f'{profile}: passed {count}',flush=True)
        emulator.start('acceptance','nominal',42,10);await asyncio.sleep(.3);await emulator.stop()
        assert emulator.run['status']=='interrupted' and emulator.process.returncode is not None
        results.append(dict(profile='explicit cancellation and cleanup',status='passed'))
        (output/'results.json').write_text(json.dumps(results,indent=2))
        for folder in (output,public):(folder/'index.json').write_text(json.dumps(index,indent=2))
        vector=encode(STREAM,2,17,3400,41.0082,28.9784,20.25,5.5,12.6)
        (root/'prototype/golden-vectors.json').write_text(json.dumps(dict(schema_version=1,stream_hex=STREAM.hex(),packet_hex=vector.hex(),decoded=dict(flags=15,boot_id=2,sequence=17,source_time_ms=3400,latitude_e7=410082000,longitude_e7=289784000,altitude_m=20.25,speed_ms=5.5,voltage_v=12.6)),indent=2))
    finally:await emulator.stop();store.close()

if __name__=='__main__':asyncio.run(main())
