"""Optional source provenance, available without simulator dependencies."""

import subprocess
from pathlib import Path

VERSION = "1.8.0"


def source_info():
    root = Path(__file__).resolve().parents[2]
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            text=True,
            timeout=3,
            stderr=subprocess.DEVNULL,
        ).strip()
        dirty = bool(
            subprocess.check_output(
                ["git", "status", "--porcelain", "--untracked-files=normal"],
                cwd=root,
                text=True,
                timeout=3,
                stderr=subprocess.DEVNULL,
            ).strip()
        )
        return dict(software_revision=revision, software_dirty=dirty)
    except (OSError, subprocess.SubprocessError):
        return dict(software_revision=None, software_dirty=None)
