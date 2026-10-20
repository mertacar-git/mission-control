"""Check disconnect cleanup through real ASGI transport, without telemetry/SITL."""
import asyncio
import json
import socket
import threading
import time
import uvicorn
import websockets
from mission_control.api import create_app


def test_closed_websockets_release_subscribers_without_waiting_for_telemetry():
    app=create_app(':memory:')
    with socket.socket() as available:
        available.bind(('127.0.0.1',0));port=available.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error'))
    thread=threading.Thread(target=server.run,daemon=True);thread.start()
    try:
        deadline=time.monotonic()+10
        while not server.started and thread.is_alive() and time.monotonic()<deadline:time.sleep(.01)
        assert server.started
        async def check():
            for _ in range(3):
                async with websockets.connect(f'ws://127.0.0.1:{port}/ws',origin='http://127.0.0.1:8000',open_timeout=3) as connection:
                    assert json.loads(await asyncio.wait_for(connection.recv(),3))['type']=='snapshot'
                    assert len(app.state.manager.subscribers)==1
                # Network close is asynchronous. Require cleanup well before the
                # ten-second telemetry/keepalive wait, without TestClient task cancellation.
                deadline=time.monotonic()+1
                while app.state.manager.subscribers and time.monotonic()<deadline:await asyncio.sleep(.01)
                assert not app.state.manager.subscribers
        asyncio.run(check())
    finally:
        server.should_exit=True;thread.join(10)
        assert not thread.is_alive()
