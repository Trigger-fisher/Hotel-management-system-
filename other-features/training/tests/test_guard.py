"""Resource guard: thread caps, RAM stop, disk refusal, pause/resume by (invented) temperatures, duty cycle."""
from __future__ import annotations

import os
from collections import namedtuple

import guard


def test_thread_cap_is_65_percent_of_logical_cores():
    assert guard.Limits(cpu=0.65, logical_cores=12).threads == 7
    assert guard.Limits(cpu=0.65, logical_cores=1).threads == 1
    assert guard.Limits(cpu=0.65, logical_cores=16).threads == 10


def test_apply_sets_thread_variables_and_priority():
    lim = guard.apply(guard.Limits(cpu=0.5, logical_cores=8), quiet=True)
    for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "FLAGS_paddle_num_threads"):
        assert os.environ[var] == "4"
    assert os.environ["FLAGS_fraction_of_gpu_memory_to_use"] == f"{lim.gpu:.2f}"
    import psutil
    if os.name == "nt":
        assert psutil.Process().nice() == psutil.BELOW_NORMAL_PRIORITY_CLASS


def test_gpu_memory_cap_in_megabytes():
    env = guard.thread_env(guard.Limits(gpu=0.65), gpu_total_mb=4096)
    assert env["FLAGS_gpu_memory_limit_mb"] == "2662"


def test_onnxruntime_sessions_get_the_cap():
    from evaluate import CtcRecognizer, bundled_rec_model
    rec = CtcRecognizer(bundled_rec_model(), threads=3)
    assert rec.sess.get_session_options().intra_op_num_threads == 3


def test_ram_stop_waits_until_use_drops():
    readings = iter([0.85, 0.80, 0.72, 0.60])
    slept = []
    waited = guard.wait_for_ram(guard.Limits(ram=0.70), reader=lambda: next(readings), sleep=slept.append)
    assert waited == 6.0 and len(slept) == 3


def test_ram_stop_does_not_wait_below_limit():
    assert guard.wait_for_ram(guard.Limits(ram=0.70), reader=lambda: 0.5, sleep=lambda s: None) == 0


def test_batch_size_keeps_ram_under_limit():
    lim = guard.Limits(ram=0.70)
    # 16 GB, 60% used -> 10% headroom = 1.6 GB, half of it = 0.8 GB -> 80 items of 10 MB
    assert guard.batch_size_for_ram(lim, 10_000_000, 256, total_bytes=16_000_000_000, used_fraction=0.60) == 80
    assert guard.batch_size_for_ram(lim, 10_000_000, 256, total_bytes=16_000_000_000, used_fraction=0.75) == 1


def test_disk_refusal(tmp_path):
    du = namedtuple("du", "total used free")
    lim = guard.Limits(disk_min_free=0.15)
    assert "free" in guard.check_disk(tmp_path, 0, lim, usage=lambda p: du(100, 90, 10))
    assert "not enough space" in guard.check_disk(tmp_path, 30, lim, usage=lambda p: du(100, 60, 40))
    assert guard.check_disk(tmp_path, 10, lim, usage=lambda p: du(100, 60, 40)) is None


def test_pause_and_resume_by_gpu_temperature():
    temps = iter([65, 79, 81, 78, 72, 70, 69])
    state = []
    dog = guard.Watchdog(guard.Limits(), pause=lambda: state.append("pause"), resume=lambda: state.append("resume"),
                         gpu_temp=lambda: next(temps), cpu_temp_reader=lambda: None, log=lambda m: None)
    seen = []
    for _ in range(7):
        dog.step()
        seen.append(dog.paused)
    assert seen == [False, False, True, True, True, False, False]  # pause at 81, stay paused until 70
    assert state == ["pause", "resume"]


def test_cpu_package_temperature_pauses_too():
    cpu = iter([80, 86, 75, 70])
    state = []
    dog = guard.Watchdog(guard.Limits(), pause=lambda: state.append("p"), resume=lambda: state.append("r"),
                         gpu_temp=lambda: 60, cpu_temp_reader=lambda: next(cpu), log=lambda m: None)
    for _ in range(4):
        dog.step()
    assert state == ["p", "r"]


def test_duty_cycle_when_no_temperature_is_readable():
    now = [0.0]
    state, logs = [], []
    lim = guard.Limits(duty_run_s=100, duty_rest_s=10)
    dog = guard.Watchdog(lim, pause=lambda: state.append("p"), resume=lambda: state.append("r"),
                         gpu_temp=lambda: None, cpu_temp_reader=lambda: None, clock=lambda: now[0], log=logs.append)
    for t in (0, 50, 100, 105, 110, 150, 210):
        now[0] = t
        dog.step()
    assert dog.mode == "duty" and "no temperature" in logs[0]
    assert state == ["p", "r", "p"]


def test_watchdog_really_suspends_and_resumes_a_child_process():
    import subprocess
    import sys
    import time

    import psutil
    child = subprocess.Popen([sys.executable, "-c", "import time\nwhile True: time.sleep(0.05)"])
    try:
        p = psutil.Process(child.pid)
        temps = iter([85, 69])
        dog = guard.Watchdog(guard.Limits(), pause=p.suspend, resume=p.resume, gpu_temp=lambda: next(temps),
                             cpu_temp_reader=lambda: None, log=lambda m: None)
        dog.step()
        time.sleep(0.2)
        assert p.status() == psutil.STATUS_STOPPED
        dog.step()
        time.sleep(0.2)
        assert p.status() != psutil.STATUS_STOPPED
    finally:
        child.kill()


def test_stop_flag():
    flag = guard.StopFlag()
    assert not flag.stopped
    flag._handler()
    assert flag.stopped
    import signal
    signal.signal(signal.SIGINT, signal.default_int_handler)
