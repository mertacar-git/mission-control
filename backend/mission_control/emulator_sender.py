"""Separate process; produces synthetic sensors, never MAVLink or actuator commands."""
import argparse,math,random,socket,time
from .emulator_protocol import encode

PROFILES=('nominal','loss','corruption','reorder','mixed','sensor_gap','restart')
def schedule(seed,profile,count,stream,boot=0):
    rng=random.Random(seed);packets=[]
    for i in range(count):
        missing=profile=='sensor_gap' and count//3<=i<2*count//3
        packet=encode(stream,boot,i,i*200,None if missing else 41.0082+15/111194.9266*math.sin(i/15),None if missing else 28.9784+15/(111194.9266*math.cos(math.radians(41.0082)))*math.cos(i/15),None if missing else 20+3*math.sin(i/10),5,12.6-.001*i)
        action=rng.random()
        if (profile=='loss' and action<.2) or (profile=='mixed' and action<.12):continue
        if (profile=='corruption' and i%7==3) or (profile=='mixed' and .12<=action<.22):
            damaged=bytearray(packet);damaged[-8]^=0x40;packet=bytes(damaged)
        delay=.35 if profile in ('reorder','mixed') and i%8==3 else (rng.uniform(0,.12) if profile=='mixed' else 0)
        packets.append((i*.2+delay,packet))
        if profile in ('reorder','mixed') and i%9==5:packets.append((i*.2+delay+.025,packet))
    return sorted(packets,key=lambda p:p[0])

def main():
    p=argparse.ArgumentParser();p.add_argument('--stream',required=True);p.add_argument('--seed',type=int,default=42);p.add_argument('--profile',choices=PROFILES,default='nominal');p.add_argument('--count',type=int,required=True);p.add_argument('--boot',type=int,default=0);args=p.parse_args()
    stream=bytes.fromhex(args.stream)
    if len(stream)!=16 or not 1<=args.count<=300:raise ValueError('Invalid bounded stream.')
    sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);started=time.monotonic()
    try:
        for at,packet in schedule(args.seed,args.profile,args.count,stream,args.boot):
            time.sleep(max(0,started+at-time.monotonic()));sock.sendto(packet,('127.0.0.1',14600))
    finally:sock.close()

if __name__=='__main__':main()
