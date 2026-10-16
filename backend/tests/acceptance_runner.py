"""Run required software/SITL checks and produce an auditable acceptance bundle."""

import argparse
import html
import hashlib
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from importlib.metadata import version, PackageNotFoundError
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4
from mission_control.build_info import source_info

ROOT = Path(__file__).resolve().parents[2]


def source_manifest(root):
    files = {}
    for directory in (
        "backend/mission_control",
        "backend/tests",
        "frontend/src",
        "frontend/e2e",
        "frontend/public",
        "prototype",
        "tests/fixtures",
    ):
        for path in sorted((root / directory).rglob("*")):
            if (
                path.is_file()
                and "__pycache__" not in path.parts
                and path.suffix != ".pyc"
            ):
                files[path.relative_to(root).as_posix()] = hashlib.sha256(
                    path.read_bytes()
                ).hexdigest()
    for relative in (
        "backend/requirements.txt",
        "backend/requirements-serial.txt",
        "frontend/package.json",
        "frontend/package-lock.json",
        "frontend/vite.config.ts",
        "frontend/playwright.config.ts",
        "frontend/tsconfig.json",
    ):
        path = root / relative
        if path.is_file():
            files[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
    digest = hashlib.sha256(
        json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return dict(schema_version=1, sha256=digest, files=files)


def now():
    return datetime.now(timezone.utc).isoformat()


def junit_complete(path):
    tree = ET.parse(path)
    cases = tree.findall(".//testcase")
    if not cases:
        raise ValueError("Required test report contains no tests.")
    if tree.findall(".//skipped"):
        raise ValueError("Mandatory test was skipped.")
    if tree.findall(".//failure") or tree.findall(".//error"):
        raise ValueError("Test report contains failures/errors.")
    return len(cases)


def write_reports(output, summary):
    output.mkdir(parents=True, exist_ok=True)
    (output / "summary.json").write_text(
        json.dumps(summary, indent=2, allow_nan=False), encoding="utf-8"
    )
    suite = ET.Element(
        "testsuite",
        name="Mission Control acceptance",
        tests=str(len(summary["checks"])),
        failures=str(sum(c["status"] != "passed" for c in summary["checks"])),
    )
    for check in summary["checks"]:
        case = ET.SubElement(
            suite, "testcase", name=check["name"], time=str(check.get("duration_s", 0))
        )
        if check["status"] != "passed":
            ET.SubElement(
                case, "failure", message=check.get("error") or check["status"]
            ).text = check.get("error") or "Mandatory check did not pass."
        ET.SubElement(case, "system-out").text = check.get("log", "")
    ET.ElementTree(suite).write(
        output / "junit.xml", encoding="utf-8", xml_declaration=True
    )
    rows = "".join(
        "<tr><th>"
        + html.escape(c["name"])
        + "</th><td>"
        + html.escape(c["status"])
        + "</td><td>"
        + str(c.get("duration_s", 0))
        + "</td><td>"
        + html.escape(c.get("error") or "")
        + '</td><td><a href="'
        + html.escape(c.get("log", ""), quote=True)
        + '">Raw log</a></td></tr>'
        for c in summary["checks"]
    )
    (output / "report.html").write_text(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mission Control acceptance</title><style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:20px;background:#0c1721;color:#e3edf4}table{border-collapse:collapse;width:100%}td,th{border:1px solid #405064;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#65d1df}</style><h1>Mission Control acceptance · '
        + html.escape(summary["status"])
        + "</h1><p>"
        + html.escape(summary["suite"])
        + " · "
        + html.escape(summary["started_utc"])
        + "</p><p>Physical hardware: pending, outside this software/SITL acceptance.</p><table><thead><tr><th>Required check</th><th>Result</th><th>Wall seconds</th><th>Reason</th><th>Evidence</th></tr></thead><tbody>"
        + rows
        + "</tbody></table><h2>Version and execution context</h2><pre>"
        + html.escape(
            json.dumps({k: v for k, v in summary.items() if k != "checks"}, indent=2)
        )
        + "</pre></html>",
        encoding="utf-8",
    )


def run_check(name, command, cwd, output, timeout, env=None, report=None):
    log = output / (name + ".log")
    started = time.monotonic()
    result = dict(
        name=name,
        status="failed",
        command=command,
        cwd=str(cwd),
        log=log.name,
        error=None,
    )
    try:
        with log.open("w", encoding="utf-8") as stream:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                env=env,
                stdout=stream,
                stderr=subprocess.STDOUT,
                start_new_session=os.name != "nt",
            )
            try:
                code = process.wait(timeout=timeout)
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as interruption:
                # Python asyncio runners handle SIGINT by cancelling their main task,
                # executing their owned-process cleanup. Never kill by port/name.
                if os.name != "nt":
                    os.killpg(process.pid, signal.SIGINT)
                else:
                    process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    if os.name != "nt":
                        os.killpg(process.pid, signal.SIGKILL)
                    else:
                        process.kill()
                    process.wait()
                if isinstance(interruption, KeyboardInterrupt):
                    result["interrupted"] = True
                    raise RuntimeError(
                        "Acceptance interrupted; remaining mandatory checks did not run."
                    )
                raise RuntimeError(
                    f"Mandatory check timed out after {timeout} seconds; inspect process cleanup logs."
                )
        if code != 0:
            raise RuntimeError(f"Command exited with code {code}.")
        if report:
            result["test_count"] = junit_complete(report)
        result["status"] = "passed"
    except (OSError, ValueError, RuntimeError, ET.ParseError) as exc:
        result["error"] = str(exc)
    result["duration_s"] = round(time.monotonic() - started, 3)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", required=True, choices=["software", "sitl", "all"])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    output = (
        args.output
        or ROOT
        / ".runtime/acceptance"
        / f"{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-{uuid4().hex[:8]}"
    ).resolve()
    output.mkdir(parents=True, exist_ok=False)
    manifest = source_manifest(ROOT)
    (output / "source-manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )
    summary = dict(
        schema_version=1,
        suite=args.suite,
        status="running",
        started_utc=now(),
        ended_utc=None,
        application_version=json.loads((ROOT / "frontend/package.json").read_text())[
            "version"
        ],
        python=sys.version,
        platform=platform.platform(),
        **source_info(),
        hardware="pending; no physical board/sensor acceptance",
        checks=[],
    )
    summary["source_sha256"] = manifest["sha256"]
    summary["dependencies"] = {}
    for package in (
        "fastapi",
        "pydantic",
        "pymavlink",
        "shapely",
        "pyserial",
        "pytest",
    ):
        try:
            summary["dependencies"][package] = version(package)
        except PackageNotFoundError:
            summary["dependencies"][package] = None
    checks = []
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm") or "npm"
    env = os.environ.copy()
    if args.suite in ("software", "all"):
        checks += [
            (
                "backend-tests",
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    "-q",
                    "--junitxml=" + str(output / "backend-tests.xml"),
                ],
                ROOT / "backend",
                180,
                env,
                output / "backend-tests.xml",
            ),
            (
                "frontend-tests",
                [
                    npm,
                    "test",
                    "--",
                    "--reporter=default",
                    "--reporter=junit",
                    "--outputFile=" + str(output / "frontend-tests.xml"),
                ],
                ROOT / "frontend",
                180,
                env,
                output / "frontend-tests.xml",
            ),
            (
                "production-build",
                [npm, "run", "build"],
                ROOT / "frontend",
                180,
                env,
                None,
            ),
        ]
        serial_env = {**env, "MISSION_EVIDENCE_DIR": str(output / "serial-pty")}
        checks.append(
            (
                "http-websocket",
                [sys.executable, "-m", "tests.socket_runner"],
                ROOT / "backend",
                30,
                {**env, "MISSION_EVIDENCE_DIR": str(output / "http-websocket")},
                None,
            )
        )
        checks.append(
            (
                "serial-pty",
                [sys.executable, "-m", "tests.serial_runner"],
                ROOT / "backend",
                60,
                serial_env,
                None,
            )
        )
        emulator_env = {**env, "MISSION_EVIDENCE_DIR": str(output / "emulator")}
        checks.append(
            (
                "subprocess-emulator",
                [sys.executable, "-m", "tests.emulator_runner"],
                ROOT / "backend",
                90,
                emulator_env,
                None,
            )
        )
        browser_env = {
            **env,
            "MISSION_BROWSER_ARTIFACTS": str(output / "browser-artifacts"),
            "MISSION_BROWSER_JSON": str(output / "browser-results.json"),
            "MISSION_BROWSER_JUNIT": str(output / "browser-tests.xml"),
        }
        checks.append(
            (
                "browser-critical-flows",
                [npm, "run", "test:e2e"],
                ROOT / "frontend",
                600,
                browser_env,
                output / "browser-tests.xml",
            )
        )
    if args.suite in ("sitl", "all"):
        for name, module, limit in [
            ("sitl-baseline", "tests.integration_runner", 900),
            ("sitl-experiments", "tests.experiment_runner", 1200),
            ("sitl-paired-flights", "tests.comparison_runner", 900),
        ]:
            checks.append(
                (
                    name,
                    [sys.executable, "-m", module],
                    ROOT / "backend",
                    limit,
                    {**env, "MISSION_EVIDENCE_DIR": str(output / name)},
                    None,
                )
            )
    summary["checks"] = [
        dict(
            name=name,
            status="not_run",
            error="Mandatory check has not run.",
            command=command,
            log=name + ".log",
        )
        for name, command, *_ in checks
    ]
    write_reports(output, summary)
    for index, (name, command, cwd, timeout, check_env, report) in enumerate(checks):
        print("Running " + name, flush=True)
        result = run_check(name, command, cwd, output, timeout, check_env, report)
        summary["checks"][index] = result
        write_reports(output, summary)
        print(
            name
            + ": "
            + result["status"]
            + ((" · " + result["error"]) if result["error"] else ""),
            flush=True,
        )
        if result.get("interrupted"):
            break
    summary.update(
        status="passed"
        if len(summary["checks"]) == len(checks)
        and all(c["status"] == "passed" for c in summary["checks"])
        else "failed",
        ended_utc=now(),
    )
    write_reports(output, summary)
    print(str(output / "report.html"), flush=True)
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    sys.exit(main())
