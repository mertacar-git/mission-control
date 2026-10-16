"""Exercise actual installed Uvicorn HTTP/WebSocket transport without SITL."""

import asyncio
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path
import websockets
from mission_control.api import create_app

app = create_app(database=os.environ.get("MISSION_SOCKET_DATABASE", ":memory:"))


async def main():
    root = Path(__file__).resolve().parents[2]
    output = Path(
        os.environ.get("MISSION_EVIDENCE_DIR", root / ".runtime/socket-acceptance")
    )
    output.mkdir(parents=True, exist_ok=True)
    with socket.socket() as available:
        available.bind(("127.0.0.1", 0))
        port = available.getsockname()[1]
    with (
        tempfile.TemporaryDirectory() as temporary,
        (output / "server.log").open("w") as log,
    ):
        env = {
            **os.environ,
            "MISSION_SOCKET_DATABASE": str(Path(temporary) / "transport.sqlite3"),
        }
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "tests.socket_runner:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
            ],
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
        )
        try:
            health = None
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError("Clean server exited before readiness.")
                try:
                    with urllib.request.urlopen(
                        f"http://127.0.0.1:{port}/api/v1/health", timeout=0.3
                    ) as response:
                        health = json.load(response)
                    break
                except OSError:
                    await asyncio.sleep(0.1)
            assert health and health["status"] == "ok"
            async with websockets.connect(
                f"ws://127.0.0.1:{port}/ws",
                origin="http://127.0.0.1:8000",
                open_timeout=5,
            ) as connection:
                snapshot = json.loads(await asyncio.wait_for(connection.recv(), 5))
                assert (
                    snapshot["type"] == "snapshot"
                    and snapshot["payload"]["state"] == "closed"
                )
                assert not snapshot["payload"]["simulator_owned"]
            (output / "results.json").write_text(
                json.dumps(
                    dict(
                        status="passed",
                        health=health,
                        websockets_version=websockets.__version__,
                        snapshot=snapshot,
                    ),
                    indent=2,
                )
            )
        finally:
            process.send_signal(
                signal.SIGINT
            ) if os.name != "nt" else process.terminate()
            try:
                await asyncio.to_thread(process.wait, 10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise


if __name__ == "__main__":
    asyncio.run(main())
