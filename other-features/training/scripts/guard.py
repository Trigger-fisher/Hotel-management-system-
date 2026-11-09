"""Resource guard: the training scripts never use more than about 65% of this PC (MJ's rule).

Used by every script in this folder (build_dataset, pseudo_label, finetune_rec, evaluate). What it does:
  * CPU: thread and worker caps = floor(LIMIT x logical cores), minimum 1, written into OMP / MKL / OpenBLAS / NumExpr /
    onnxruntime / Paddle settings BEFORE those libraries load; the process runs at BELOW NORMAL priority on Windows.
  * RAM: `wait_for_ram()` blocks (sleeping) while system RAM use is above the RAM limit (default 70%), so no more work is loaded.
  * GPU: Paddle may take at most LIMIT of the card's memory (FLAGS_fraction_of_gpu_memory_to_use) and torch, if ever used,
    gets set_per_process_memory_fraction(LIMIT). A watchdog reads nvidia-smi every 30 s; above 80 C (GPU) or 85 C (CPU package,
    when readable) it PAUSES the training process and resumes at 70 C. When no temperature can be read it says so and uses a
    duty cycle instead (run 25 min, rest 5 min).
  * Disk: `check_disk()` refuses to start when the output drive has under 15% free or less than the estimated need.
  * Ctrl+C: `StopFlag` lets loops finish the current item and stop cleanly.

Limits can be changed with flags (--cpu-limit, --ram-limit, --gpu-limit) or environment variables
TRAIN_CPU_LIMIT, TRAIN_RAM_LIMIT, TRAIN_GPU_LIMIT (fractions such as 0.65), TRAIN_GPU_MAX_C, TRAIN_CPU_MAX_C, TRAIN_RESUME_C,
TRAIN_DISK_MIN_FREE. The limits are printed at start. Needs psutil (own copy of nothing; written for this folder on 2026-11-04)."""
from __future__ import annotations

import math
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Limits:
    cpu: float = 0.65
    ram: float = 0.70
    gpu: float = 0.65
    gpu_max_c: float = 80.0
    cpu_max_c: float = 85.0
    resume_c: float = 70.0
    disk_min_free: float = 0.15
    poll_s: float = 30.0
    duty_run_s: float = 25 * 60
    duty_rest_s: float = 5 * 60
    logical_cores: int = field(default_factory=lambda: os.cpu_count() or 1)

    @classmethod
    def from_env(cls, cpu=None, ram=None, gpu=None) -> "Limits":
        return cls(cpu=cpu or _env_float("TRAIN_CPU_LIMIT", 0.65), ram=ram or _env_float("TRAIN_RAM_LIMIT", 0.70),
                   gpu=gpu or _env_float("TRAIN_GPU_LIMIT", 0.65), gpu_max_c=_env_float("TRAIN_GPU_MAX_C", 80),
                   cpu_max_c=_env_float("TRAIN_CPU_MAX_C", 85), resume_c=_env_float("TRAIN_RESUME_C", 70),
                   disk_min_free=_env_float("TRAIN_DISK_MIN_FREE", 0.15))

    @property
    def threads(self) -> int:
        return max(1, math.floor(self.cpu * self.logical_cores))

    def describe(self) -> str:
        return (f"limits: {self.threads} of {self.logical_cores} logical cores ({self.cpu:.0%}), below-normal priority, "
                f"RAM stop at {self.ram:.0%}, GPU memory {self.gpu:.0%}, pause at GPU {self.gpu_max_c:.0f} C / CPU {self.cpu_max_c:.0f} C, "
                f"resume at {self.resume_c:.0f} C, disk needs {self.disk_min_free:.0%} free")


THREAD_VARS = ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS",
               "CPU_NUM", "FLAGS_paddle_num_threads")


def thread_env(limits: Limits, gpu_total_mb: float | None = None) -> dict[str, str]:
    """Environment for this process and any child (Paddle training): thread caps and the GPU memory cap.
    Paddle: FLAGS_gpu_memory_limit_mb is a hard ceiling (set when the card size is known from nvidia-smi);
    FLAGS_fraction_of_gpu_memory_to_use is the same share for the first allocation."""
    env = {k: str(limits.threads) for k in THREAD_VARS}
    env["FLAGS_fraction_of_gpu_memory_to_use"] = f"{limits.gpu:.2f}"
    if gpu_total_mb:
        env["FLAGS_gpu_memory_limit_mb"] = str(int(gpu_total_mb * limits.gpu))
    return env


def _preset() -> None:
    """On import: caps for numpy / OpenBLAS / MKL, which read these variables once when they load. A flag given later
    (apply) also updates OpenCV, onnxruntime sessions and child processes."""
    for k, v in thread_env(Limits.from_env()).items():
        os.environ.setdefault(k, v)


_preset()


def lower_priority(pid: int | None = None) -> bool:
    try:
        import psutil
        p = psutil.Process(pid or os.getpid())
        p.nice(psutil.BELOW_NORMAL_PRIORITY_CLASS if os.name == "nt" else 10)
        return True
    except Exception:  # noqa: BLE001 - priority is best effort
        return False


def apply(limits: Limits | None = None, quiet: bool = False) -> Limits:
    """Call FIRST in every script, before numpy / onnxruntime / cv2 / paddle start their thread pools."""
    limits = limits or Limits.from_env()
    os.environ.update(thread_env(limits))
    lower_priority()
    try:
        import cv2
        cv2.setNumThreads(limits.threads)
    except Exception:  # noqa: BLE001
        pass
    try:
        import torch  # only if it happens to be installed; this folder does not need it
        torch.set_num_threads(limits.threads)
        if torch.cuda.is_available():
            torch.cuda.set_per_process_memory_fraction(limits.gpu)
    except Exception:  # noqa: BLE001
        pass
    if not quiet:
        print(limits.describe(), flush=True)
    return limits


def ort_options(limits: Limits):
    """onnxruntime SessionOptions with the thread cap (for our own sessions)."""
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = limits.threads
    so.inter_op_num_threads = 1
    return so


def ram_used() -> float:
    import psutil
    return psutil.virtual_memory().percent / 100.0


def wait_for_ram(limits: Limits, reader: Callable[[], float] = ram_used, sleep: Callable[[float], None] = time.sleep,
                 max_wait_s: float = 3600, stop: "StopFlag | None" = None) -> float:
    """Blocks while RAM use is above the limit. Returns the seconds waited."""
    waited = 0.0
    while reader() > limits.ram and waited < max_wait_s and not (stop and stop.stopped):
        if waited == 0:
            print(f"\nRAM use above {limits.ram:.0%}: waiting before loading more", flush=True)
        sleep(2.0)
        waited += 2.0
    if waited:
        print(f"RAM below the limit again after {waited:.0f} s, continuing", flush=True)
    return waited


def batch_size_for_ram(limits: Limits, bytes_per_item: int, wanted: int, total_bytes: int | None = None,
                       used_fraction: float | None = None) -> int:
    """The largest batch (<= wanted) whose memory keeps system RAM under the limit (half the headroom, to be safe)."""
    import psutil
    vm = psutil.virtual_memory()
    total = total_bytes or vm.total
    used = used_fraction if used_fraction is not None else vm.percent / 100
    headroom = round(max(0.0, limits.ram - used) * total * 0.5)
    return max(1, min(wanted, int(headroom // max(1, bytes_per_item))))


def check_disk(path: Path, need_bytes: int, limits: Limits, usage=shutil.disk_usage) -> str | None:
    """A reason to refuse, or None. The drive must keep LIMIT free after the estimated need is written."""
    path = Path(path)
    probe = path
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    du = usage(str(probe))
    if du.free / du.total < limits.disk_min_free:
        return f"only {du.free / du.total:.0%} free on the output drive (need at least {limits.disk_min_free:.0%})"
    if du.free - need_bytes < limits.disk_min_free * du.total:
        return f"not enough space: about {need_bytes / 1e9:.1f} GB needed and {limits.disk_min_free:.0%} must stay free"
    return None


class StopFlag:
    """Ctrl+C sets `stopped`; loops check it and stop after the current item (a second Ctrl+C stops at once)."""

    def __init__(self) -> None:
        self.stopped = False
        try:
            signal.signal(signal.SIGINT, self._handler)
        except ValueError:  # not the main thread (tests)
            pass

    def _handler(self, *_):
        if self.stopped:
            raise KeyboardInterrupt
        self.stopped = True
        print("\nstopping after the current item (Ctrl+C again to stop now)", flush=True)


# ------------------------------------------------------------------ temperatures
def gpu_reading() -> dict | None:
    """{temp, util, mem_used, mem_total} from nvidia-smi, or None when it cannot be read."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run([exe, "--query-gpu=temperature.gpu,utilization.gpu,memory.used,memory.total",
                              "--format=csv,noheader,nounits"], capture_output=True, timeout=15, check=False).stdout.decode()
        t, u, mu, mt = (float(x) for x in out.strip().splitlines()[0].split(","))
        return {"temp": t, "util": u, "mem_used": mu, "mem_total": mt}
    except Exception:  # noqa: BLE001
        return None


def cpu_temp() -> float | None:
    """CPU package temperature when Windows exposes it without admin (often it does not), else None."""
    try:
        import psutil
        temps = getattr(psutil, "sensors_temperatures", lambda: {})() or {}
        vals = [t.current for arr in temps.values() for t in arr if t.current]
        if vals:
            return max(vals)
    except Exception:  # noqa: BLE001
        pass
    if os.name == "nt":
        try:
            out = subprocess.run(["powershell", "-NoProfile", "-Command",
                                  "(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | "
                                  "Measure-Object CurrentTemperature -Maximum).Maximum"],
                                 capture_output=True, timeout=20, check=False).stdout.decode().strip()
            if out:
                return float(out) / 10 - 273.15
        except Exception:  # noqa: BLE001
            pass
    return None


class Watchdog:
    """Pauses / resumes a worker by temperature. `pause()` / `resume()` are callables (for a child process:
    psutil suspend / resume). Readers are injectable so the logic is testable with invented temperatures."""

    def __init__(self, limits: Limits, pause: Callable[[], None], resume: Callable[[], None],
                 gpu_temp: Callable[[], float | None] | None = None, cpu_temp_reader: Callable[[], float | None] | None = None,
                 clock: Callable[[], float] = time.monotonic, log: Callable[[str], None] = print) -> None:
        self.l, self.pause, self.resume, self.clock, self.log = limits, pause, resume, clock, log
        self.gpu_temp = gpu_temp or (lambda: (gpu_reading() or {}).get("temp"))
        self.cpu_temp = cpu_temp_reader or cpu_temp
        self.paused = False
        self.mode: str | None = None  # "temperature" or "duty"
        self.since = clock()
        self.events: list[str] = []

    def step(self) -> None:
        g, c = self.gpu_temp(), self.cpu_temp()
        if self.mode is None:
            self.mode = "temperature" if (g is not None or c is not None) else "duty"
            if self.mode == "duty":
                self.log(f"no temperature can be read: using a duty cycle ({self.l.duty_run_s / 60:.0f} min run, {self.l.duty_rest_s / 60:.0f} min rest)")
            else:
                self.log(f"temperatures readable: GPU {'yes' if g is not None else 'no'}, CPU {'yes' if c is not None else 'no'}")
        now = self.clock()
        if self.mode == "duty":
            if not self.paused and now - self.since >= self.l.duty_run_s:
                self._set(True, "duty cycle rest", now)
            elif self.paused and now - self.since >= self.l.duty_rest_s:
                self._set(False, "duty cycle run", now)
            return
        hot = (g is not None and g >= self.l.gpu_max_c) or (c is not None and c >= self.l.cpu_max_c)
        cool = (g is None or g <= self.l.resume_c) and (c is None or c <= self.l.resume_c)
        if not self.paused and hot:
            self._set(True, f"hot (GPU {g} C, CPU {c} C)", now)
        elif self.paused and cool:
            self._set(False, f"cooled (GPU {g} C, CPU {c} C)", now)

    def _set(self, pause: bool, why: str, now: float) -> None:
        (self.pause if pause else self.resume)()
        self.paused, self.since = pause, now
        self.events.append(("pause: " if pause else "resume: ") + why)
        self.log(self.events[-1])

    def run_in_thread(self, done: threading.Event) -> threading.Thread:
        def loop():
            while not done.wait(self.l.poll_s):
                try:
                    self.step()
                except Exception as exc:  # noqa: BLE001 - a broken reading must not kill training
                    self.log(f"watchdog reading failed: {type(exc).__name__}")
        t = threading.Thread(target=loop, daemon=True)
        t.start()
        return t


def run_guarded(cmd: list[str], limits: Limits, cwd: str | None = None, env: dict | None = None) -> int:
    """Runs a training command as a child process with the thread caps, below-normal priority and the temperature watchdog.
    Ctrl+C is passed on so the child can stop; the last checkpoint stays."""
    import psutil
    g = gpu_reading()
    full_env = {**os.environ, **thread_env(limits, g["mem_total"] if g else None), **(env or {})}
    if g:
        print(f"GPU memory cap for training: {full_env['FLAGS_gpu_memory_limit_mb']} MiB of {g['mem_total']:.0f}", flush=True)
    proc = subprocess.Popen(cmd, cwd=cwd, env=full_env)
    lower_priority(proc.pid)
    ps = psutil.Process(proc.pid)

    def family():
        try:
            return [ps, *ps.children(recursive=True)]
        except psutil.Error:
            return []

    def pause():
        for p in family():
            try:
                p.suspend()
            except psutil.Error:
                pass

    def resume():
        for p in family():
            try:
                p.resume()
            except psutil.Error:
                pass

    done = threading.Event()
    dog = Watchdog(limits, pause, resume)
    dog.run_in_thread(done)
    try:
        return proc.wait()
    except KeyboardInterrupt:
        resume()
        proc.terminate()
        return proc.wait()
    finally:
        done.set()
        resume()


def add_args(ap) -> None:
    ap.add_argument("--cpu-limit", type=float, help="share of logical cores to use (default 0.65, env TRAIN_CPU_LIMIT)")
    ap.add_argument("--ram-limit", type=float, help="pause loading above this RAM use (default 0.70, env TRAIN_RAM_LIMIT)")
    ap.add_argument("--gpu-limit", type=float, help="share of GPU memory (default 0.65, env TRAIN_GPU_LIMIT)")


def from_args(a) -> Limits:
    return Limits.from_env(getattr(a, "cpu_limit", None), getattr(a, "ram_limit", None), getattr(a, "gpu_limit", None))


if __name__ == "__main__":  # prints the limits this PC gets
    lim = Limits.from_env()
    print(lim.describe())
    g = gpu_reading()
    print("GPU:", "not readable" if g is None else f"{g['temp']:.0f} C, {g['util']:.0f}% busy, {g['mem_used']:.0f}/{g['mem_total']:.0f} MiB")
    c = cpu_temp()
    print("CPU temperature:", "not readable without admin (duty cycle fallback for CPU)" if c is None else f"{c:.0f} C")
    print(f"RAM in use now: {ram_used():.0%}")
    sys.exit(0)
