import subprocess
import sys
from pathlib import Path

from tests.conftest import png
from tests.imaging import blur
from tests.test_gate import page

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "calibrate.py"
STATE = SCRIPT.with_name(".calibrate-state.json")


def run(args, env=None):
    import os
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, timeout=300, env={**os.environ, **(env or {})})


def test_does_nothing_when_the_folder_is_missing_or_empty(tmp_path):
    assert "nothing to do" in run(["--samples", str(tmp_path / "nope")]).stdout
    assert "nothing to do" in run(["--samples", str(tmp_path)]).stdout


def test_prints_only_aggregates_and_is_resumable(tmp_path):
    folder = tmp_path / "SECRET-GUEST-NAMES" / "nested"
    folder.mkdir(parents=True)
    for i in range(6):
        (folder / f"private_person_{i}.png").write_bytes(png(blur(page(scale=1), 0.5 + i)))
    (folder / "notes.txt").write_text("not an image")
    (folder / "broken.jpg").write_bytes(b"not really a jpeg")
    try:
        first = run(["--samples", str(tmp_path), "--profile", "generic", "--workers", "2", "--fresh", "--limit", "4"])
        assert "files measured: 4" in first.stdout or "files measured: 3" in first.stdout
        second = run(["--samples", str(tmp_path), "--profile", "generic", "--workers", "2"], env={"SAMPLES_DIR": ""})
        assert "files measured: 6" in second.stdout and "unreadable: 1" in second.stdout
        output = first.stdout + second.stdout + first.stderr + second.stderr
        for secret in ("SECRET", "private_person", "broken", "notes", "nested"):
            assert secret not in output
        assert "blurLaplacian" in second.stdout and "suggested limit" in second.stdout
        state = STATE.read_text()
        assert "private_person" not in state and "SECRET" not in state
    finally:
        STATE.unlink(missing_ok=True)


def test_samples_dir_environment_variable_is_used(tmp_path):
    (tmp_path / "a.png").write_bytes(png(page(scale=1)))
    try:
        out = run(["--workers", "1", "--fresh"], env={"SAMPLES_DIR": str(tmp_path)})
        assert "files measured: 1" in out.stdout
    finally:
        STATE.unlink(missing_ok=True)
