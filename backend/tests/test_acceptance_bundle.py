import json
import sys
import xml.etree.ElementTree as ET
import pytest
from tests.acceptance_runner import junit_complete, run_check, write_reports


def test_mandatory_skips_or_empty_reports_cannot_pass(tmp_path):
    report = tmp_path / "unit.xml"
    for body in [
        "<testsuite/>",
        "<testsuite><testcase><skipped/></testcase></testsuite>",
        "<testsuite><testcase><failure/></testcase></testsuite>",
    ]:
        report.write_text(body)
        with pytest.raises(ValueError):
            junit_complete(report)
    report.write_text('<testsuite><testcase name="ran"/></testsuite>')
    assert junit_complete(report) == 1


def test_command_failure_and_missing_required_report_fail(tmp_path):
    result = run_check(
        "failure", [sys.executable, "-c", "raise SystemExit(7)"], tmp_path, tmp_path, 10
    )
    assert result["status"] == "failed" and "7" in result["error"]
    result = run_check(
        "no-report",
        [sys.executable, "-c", 'print("completed")'],
        tmp_path,
        tmp_path,
        10,
        report=tmp_path / "absent.xml",
    )
    assert result["status"] == "failed"
    assert (tmp_path / "no-report.log").read_text().strip() == "completed"


def test_missing_checks_fail_junit_and_html_escapes_evidence(tmp_path):
    summary = dict(
        status="failed",
        suite="software",
        started_utc="now",
        checks=[
            dict(
                name="<script>bad</script>",
                status="not_run",
                error="Missing mandatory test",
                log="raw.log",
            )
        ],
    )
    write_reports(tmp_path, summary)
    assert ET.parse(tmp_path / "junit.xml").getroot().get("failures") == "1"
    assert "<script>bad</script>" not in (tmp_path / "report.html").read_text()
    assert json.loads((tmp_path / "summary.json").read_text())["status"] == "failed"


def test_timeout_is_failure_and_log_survives(tmp_path):
    result = run_check(
        "timeout",
        [sys.executable, "-c", "import time; time.sleep(10)"],
        tmp_path,
        tmp_path,
        0.05,
    )
    assert result["status"] == "failed" and "timed out" in result["error"]
    assert (tmp_path / "timeout.log").is_file()
