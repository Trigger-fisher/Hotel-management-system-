"""Check the deployment pack without Docker:  python validate.py   (exit 1 when something is wrong).

There is no Docker on the PC this pack was written on, so nothing here has ever been started. This script only proves that the
files hang together: the compose file parses, every build folder, Dockerfile, copied file and model script exists, every setting
name a service receives is one that service really reads (its own .env.example), every ${NAME} has a line in .env.example, only
nginx publishes ports, the memory limits fit the 16 GB VPS, every service has a restart policy and a healthcheck, nginx sends
each host name to the right service and port, the shell scripts have Linux line endings, and the worker's clamd image loads
the Sanesecurity feeds (daily, SHA-256 checked) and leaves the stamp the worker reads for the 48-hour alert. It reads files only; it prints
names and numbers, never values from any .env file.
"""
from __future__ import annotations

import fnmatch
import re
import sys
from pathlib import Path

import yaml

DEPLOY = Path(__file__).resolve().parent
ROOT = DEPLOY.parent  # other-features

# service -> (folder, port inside, needs the card cutter)
BUILT = {
    "compressor": ("compressor", 8080, False),
    "antivirus": ("antivirus", 8081, False),
    "pdf-to-image": ("pdf-to-image", 8082, False),
    "reader": ("reader", 8083, True),
    "quality-gate": ("quality-gate", 8084, False),
    "intake-worker": ("intake-worker", None, True),
}
ALL_SERVICES = set(BUILT) | {"nginx", "clamd", "certbot"}
TOOLS = {"certbot"}  # run on demand only (profile "tools")
HOSTS = {"compressor": "compressor", "scanner": "antivirus", "pdf": "pdf-to-image", "reader": "reader", "gate": "quality-gate"}
UPLOAD_SETTING = {"compressor": "COMPRESSOR_MAX_UPLOAD_MB", "antivirus": "SCANNER_MAX_UPLOAD_MB",
                  "pdf-to-image": "CONVERTER_MAX_UPLOAD_MB", "reader": "READER_MAX_UPLOAD_MB", "quality-gate": "GATE_MAX_UPLOAD_MB"}
# Names in a folder's .env.example that the pack deliberately does NOT pass, with the reason.
NOT_PASSED = {
    "READER_TESSERACT": "optional; the image's PATH is used",
    "READER_TESSDATA": "optional; the system tessdata is used",
    "READER_CARDCUT_MODEL": "set by the reader image (model fetched at build)",
    "READER_FACE_MODELS_DIR": "set by the reader image (models fetched at build)",
    "GATE_THRESHOLDS": "optional override; defaults in code",
    "CARDCUT_ARCH": "set by the intake-worker image",
    "CARDCUT_MODEL": "set by the intake-worker image (model fetched at build)",
    "FACE_MODELS_DIR": "set by the intake-worker image (models fetched at build)",
}
FIXED_IN_COMPOSE = {"SCANNER_CLAMD", "INTAKE_CLAMD", "INTAKE_SIGNATURES_DIR"}  # written literally, not taken from .env
CLAMD_FOLDER = ROOT / "intake-worker" / "clamd"   # the worker's own clamd image (official image + Sanesecurity feeds)
CLAMD_SCRIPTS = ["feeds.sh", "entry.sh"]
MEMORY_BUDGET_GB = 14.5          # 16 GB VPS minus about 1.5 GB for Ubuntu and Docker
CUTTER_MIN_GB = 3.0              # card cutter about 1.4-1.5 GB per process plus OCR and the face models
SCRIPTS = ["lib.sh", "first-certs.sh", "update.sh", "rollback.sh", "health.sh", "renew-certs.sh", "backup.sh", "ufw.sh"]


def env_names(path: Path) -> list[str]:
    """Active NAME=... lines (comments skipped)."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^([A-Z][A-Z0-9_]*)=", line.strip())
        if m:
            out.append(m.group(1))
    return out


def memory_gb(text: str) -> float:
    m = re.fullmatch(r"(\d+(?:\.\d+)?)([kmg])", str(text).strip().lower())
    if not m:
        raise ValueError(f"memory limit not understood: {text}")
    n, unit = float(m.group(1)), m.group(2)
    return n / {"k": 1024 * 1024, "m": 1024, "g": 1}[unit]


def load_compose() -> dict:
    return yaml.safe_load((DEPLOY / "docker-compose.yml").read_text(encoding="utf-8"))


def dockerfile_info(folder: Path) -> dict:
    text = (folder / "Dockerfile").read_text(encoding="utf-8")
    joined = re.sub(r"\\\n", " ", text)
    copies, envs, runs, exposes = [], set(), [], []
    for line in joined.splitlines():
        s = line.strip()
        if s.startswith("COPY "):
            parts = [p for p in s[5:].split() if not p.startswith("--")]
            copies.extend(parts[:-1])
        elif s.startswith("ENV "):
            body = s[4:]
            for m in re.finditer(r"([A-Z][A-Z0-9_]*)[= ]", body):
                envs.add(m.group(1))
                break
            envs.update(re.findall(r"\b([A-Z][A-Z0-9_]*)=", body))
        elif s.startswith("RUN "):
            runs.append(s[4:])
        elif s.startswith("EXPOSE "):
            exposes.extend(int(p.split("/")[0]) for p in s[7:].split())
    return {"copies": copies, "envs": envs, "runs": runs, "exposes": exposes}


def dockerignore(folder: Path) -> list[str]:
    path = folder / ".dockerignore"
    if not path.is_file():
        return []
    return [p.strip().rstrip("/") for p in path.read_text(encoding="utf-8").splitlines() if p.strip() and not p.startswith("#")]


def ignored(rel: str, patterns: list[str]) -> str | None:
    parts = rel.replace("\\", "/").split("/")
    for pat in patterns:
        if pat.startswith("!"):
            continue
        for i in range(1, len(parts) + 1):
            if fnmatch.fnmatch("/".join(parts[:i]), pat):
                return pat
    return None


# ---------------------------------------------------------------- checks (each returns a list of problems)

def check_services(c: dict) -> list[str]:
    found = set(c.get("services", {}))
    out = []
    if found != ALL_SERVICES:
        out.append(f"services differ: missing {sorted(ALL_SERVICES - found)}, extra {sorted(found - ALL_SERVICES)}")
    for name, svc in c["services"].items():
        if svc.get("ports") and name != "nginx":
            out.append(f"{name} publishes ports; only nginx may")
        if svc.get("network_mode") == "host":
            out.append(f"{name} uses the host network")
    if sorted(str(p) for p in c["services"]["nginx"].get("ports", [])) != ["443:443", "80:80"]:
        out.append("nginx must publish exactly 80 and 443")
    return out


def check_builds(c: dict) -> list[str]:
    out = []
    for name, (folder_name, port, _) in BUILT.items():
        svc = c["services"][name]
        build = svc.get("build")
        ctx = build if isinstance(build, str) else (build or {}).get("context")
        if ctx != f"../{folder_name}":
            out.append(f"{name}: build context {ctx!r}, expected ../{folder_name}")
            continue
        folder = (DEPLOY / ctx).resolve()
        if not (folder / "Dockerfile").is_file():
            out.append(f"{name}: no Dockerfile in {folder_name}")
            continue
        if not str(svc.get("image", "")).startswith(f"hms/{name}:${{HMS_TAG"):
            out.append(f"{name}: image must be hms/{name}:${{HMS_TAG...}} so roll back can find old images")
        info = dockerfile_info(folder)
        if port is None and info["exposes"]:
            out.append(f"{name}: Dockerfile exposes {info['exposes']} but the worker must have no port")
        if port is not None and info["exposes"] != [port]:
            out.append(f"{name}: Dockerfile EXPOSE {info['exposes']}, expected [{port}]")
        patterns = dockerignore(folder)
        for src in info["copies"]:
            if not (folder / src).exists():
                out.append(f"{name}: Dockerfile copies {src}, which does not exist in {folder_name}")
            hit = ignored(src, patterns)
            if hit:
                out.append(f"{name}: Dockerfile copies {src} but {folder_name}/.dockerignore excludes it ({hit!r}): the build fails")
        for run in info["runs"]:
            for script in re.findall(r"python\s+(scripts/[\w.-]+\.py)", run):
                if not (folder / script).is_file():
                    out.append(f"{name}: Dockerfile runs {script}, which does not exist")
                if script not in info["copies"]:
                    out.append(f"{name}: Dockerfile runs {script} without copying it first")
    return out


def check_env(c: dict) -> list[str]:
    out = []
    for name, (folder_name, _, _) in BUILT.items():
        folder = ROOT / folder_name
        example = set(env_names(folder / ".env.example"))
        image_env = dockerfile_info(folder)["envs"]
        given = c["services"][name].get("environment") or {}
        if isinstance(given, list):
            given = dict(item.split("=", 1) for item in given)
        for key in given:
            if key not in example:
                out.append(f"{name}: receives {key}, which is not in {folder_name}/.env.example")
            if key in image_env:
                out.append(f"{name}: overrides {key}, which the image sets (it would blank the model path)")
        for key in example:
            if key not in given and key not in NOT_PASSED:
                out.append(f"{name}: {folder_name}/.env.example has {key} but the compose file does not pass it")
        for key in NOT_PASSED:
            if key in given:
                out.append(f"{name}: passes {key}, which is listed as not passed ({NOT_PASSED[key]})")
        for key, value in given.items():
            if key in FIXED_IN_COMPOSE:
                if "${" in str(value):
                    out.append(f"{name}: {key} should be written literally")
            elif not re.fullmatch(r"\$\{" + re.escape(key) + r"(:[-?].*)?\}", str(value)):
                out.append(f"{name}: {key} must come from .env as ${{{key}...}}")
    # every ${NAME} has a line in deploy/.env.example; every line there is used somewhere
    text = (DEPLOY / "docker-compose.yml").read_text(encoding="utf-8")
    used = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", text))
    deploy_example = env_names(DEPLOY / ".env.example")
    dupes = {k for k in deploy_example if deploy_example.count(k) > 1}
    if dupes:
        out.append(f"deploy/.env.example repeats {sorted(dupes)}")
    for key in sorted(used - set(deploy_example)):
        out.append(f"compose uses ${{{key}}} but deploy/.env.example has no {key}= line")
    scripts_text = "\n".join((DEPLOY / "scripts" / s).read_text(encoding="utf-8") for s in SCRIPTS if (DEPLOY / "scripts" / s).is_file())
    for key in deploy_example:
        if key not in used and key not in scripts_text:
            out.append(f"deploy/.env.example has {key}, which nothing uses")
    # the secrets are required (compose refuses to start without them)
    for key in ("COMPRESSOR_KEY", "SCANNER_KEY", "CONVERTER_KEY", "READER_KEY", "GATE_KEY", "INTAKE_MASTER_KEY", "INTAKE_DATABASE_URL"):
        if not re.search(r"\$\{" + key + r":\?", text):
            out.append(f"{key} must be required (${{{key}:?...}})")
    if ".env" not in (DEPLOY / ".gitignore").read_text(encoding="utf-8").split():
        out.append("deploy/.gitignore must list .env")
    return out


def check_resources(c: dict) -> list[str]:
    out = []
    total = 0.0
    for name, svc in c["services"].items():
        if name in TOOLS:
            if "tools" not in (svc.get("profiles") or []):
                out.append(f"{name} must only run on demand (profile tools)")
            continue
        if svc.get("restart") != "unless-stopped":
            out.append(f"{name}: restart policy {svc.get('restart')!r}, expected unless-stopped")
        if not (svc.get("healthcheck") or {}).get("test"):
            out.append(f"{name}: no healthcheck")
        if "no-new-privileges:true" not in (svc.get("security_opt") or []):
            out.append(f"{name}: no-new-privileges missing")
        limits = ((svc.get("deploy") or {}).get("resources") or {}).get("limits") or {}
        if "memory" not in limits or "cpus" not in limits:
            out.append(f"{name}: needs cpus and memory limits")
            continue
        gb = memory_gb(limits["memory"])
        total += gb
        if not 0 < float(limits["cpus"]) <= 4:
            out.append(f"{name}: cpus {limits['cpus']} outside 0-4")
        if name in BUILT and BUILT[name][2] and gb < CUTTER_MIN_GB:
            out.append(f"{name}: {gb:.2f} GB is too little for the card cutter (min {CUTTER_MIN_GB} GB)")
        if name == "antivirus" and gb < 3:
            out.append("antivirus: the antivirus README asks for 3 GB (clamd reload doubles memory)")
    if total > MEMORY_BUDGET_GB:
        out.append(f"memory limits add up to {total:.2f} GB, over the {MEMORY_BUDGET_GB} GB budget")
    return out


def total_memory_gb(c: dict) -> float:
    return sum(memory_gb(s["deploy"]["resources"]["limits"]["memory"]) for n, s in c["services"].items() if n not in TOOLS)


def check_networks(c: dict) -> list[str]:
    out = []
    declared = set(c.get("networks") or {})
    for name, svc in c["services"].items():
        nets = set(svc.get("networks") or [])
        if name in TOOLS:
            continue
        want = {"intake"} if name in ("intake-worker", "clamd") else {"services"}
        if nets != want:
            out.append(f"{name}: networks {sorted(nets)}, expected {sorted(want)}")
        if nets - declared:
            out.append(f"{name}: undeclared networks {sorted(nets - declared)}")
    for net, spec in (c.get("networks") or {}).items():
        if (spec or {}).get("driver", "bridge") != "bridge":
            out.append(f"network {net}: expected a bridge network")
    worker = c["services"]["intake-worker"]
    if worker["environment"].get("INTAKE_CLAMD") != "tcp:clamd:3310":
        out.append("intake-worker: INTAKE_CLAMD must be tcp:clamd:3310 (the clamd service)")
    if (worker.get("depends_on") or {}).get("clamd", {}).get("condition") != "service_healthy":
        out.append("intake-worker must wait for a healthy clamd")
    if not worker.get("read_only") or worker.get("cap_drop") != ["ALL"]:
        out.append("intake-worker: keep read_only and cap_drop ALL from its own design")
    for vol in [v.split(":")[0] for s in c["services"].values() for v in (s.get("volumes") or [])]:
        if vol.startswith("."):
            if not (DEPLOY / vol).exists():
                out.append(f"bind mount {vol} does not exist")
        elif vol not in (c.get("volumes") or {}):
            out.append(f"volume {vol} is not declared")
    return out


def check_nginx(c: dict) -> list[str]:
    out = []
    text = (DEPLOY / "nginx" / "templates" / "services.conf.template").read_text(encoding="utf-8")
    blocks = re.split(r"\n(?=server \{)", text)
    seen = {}
    for block in blocks:
        m = re.search(r"server_name ([\w-]+)\.\$\{HMS_DOMAIN\};", block)
        if not m:
            continue
        up = re.search(r"set \$upstream http://([\w-]+):(\d+);", block)
        body = re.search(r"client_max_body_size (\d+)m;", block)
        cert = re.findall(r"/etc/letsencrypt/live/([\w-]+)/", block)
        seen[m.group(1)] = (up.group(1), int(up.group(2))) if up else None
        if not up:
            out.append(f"nginx: {m.group(1)} has no upstream")
            continue
        svc = up.group(1)
        if svc not in BUILT or BUILT[svc][1] != int(up.group(2)):
            out.append(f"nginx: {m.group(1)} goes to {svc}:{up.group(2)}, not a service port")
        if set(cert) != {"hms-services"}:
            out.append(f"nginx: {m.group(1)} certificate path is not hms-services")
        env = c["services"].get(svc, {}).get("environment", {})
        limit_text = str(env.get(UPLOAD_SETTING.get(svc, ""), ""))
        lm = re.search(r":-(\d+)\}", limit_text)
        if body and lm and int(body.group(1)) < int(lm.group(1)):
            out.append(f"nginx: {m.group(1)} body limit {body.group(1)}m is below the service's upload limit {lm.group(1)} MB")
    if {h: (v[0] if v else None) for h, v in seen.items()} != HOSTS:
        out.append(f"nginx host names {sorted(seen)} do not match {sorted(HOSTS)}")
    certs = (DEPLOY / "scripts" / "first-certs.sh").read_text(encoding="utf-8")
    if "--cert-name hms-services" not in certs:
        out.append("first-certs.sh must request the certificate named hms-services")
    for host in HOSTS:
        if f'-d "{host}.$HMS_DOMAIN"' not in certs:
            out.append(f"first-certs.sh does not ask for {host}.<domain>")
    if "/.well-known/acme-challenge/" not in text or "/nginx-health" not in text:
        out.append("nginx: port 80 needs the ACME path and the health path")
    if "$request_uri" in text.split("log_format", 1)[1].split(";", 1)[0]:
        out.append("nginx: the log format must not log query strings")
    return out


def check_files() -> list[str]:
    out = []
    readme = (DEPLOY / "README.md").read_text(encoding="utf-8") if (DEPLOY / "README.md").is_file() else ""
    for s in SCRIPTS:
        path = DEPLOY / "scripts" / s
        if not path.is_file():
            out.append(f"scripts/{s} missing")
            continue
        raw = path.read_bytes()
        if b"\r" in raw:
            out.append(f"scripts/{s} has Windows line endings (breaks /bin/sh)")
        text = raw.decode("utf-8")
        if s != "lib.sh" and not text.startswith("#!/bin/sh"):
            out.append(f"scripts/{s} must start with #!/bin/sh")
        if s != "lib.sh" and "set -eu" not in text:
            out.append(f"scripts/{s} must use set -eu")
        if s != "lib.sh" and f"scripts/{s}" not in readme:
            out.append(f"README does not mention scripts/{s}")
    for rel in ("docker-compose.yml", ".env.example", "nginx/templates/services.conf.template"):
        if b"\r" in (DEPLOY / rel).read_bytes():
            out.append(f"{rel} has Windows line endings")
    for key in re.findall(r"^([A-Z_]*KEY)=(.*)$", (DEPLOY / ".env.example").read_text(encoding="utf-8"), re.M):
        if key[1] and not key[1].startswith("replace-with"):
            out.append(f".env.example: {key[0]} must be a placeholder")
    backup = (DEPLOY / "scripts" / "backup.sh").read_text(encoding="utf-8")
    if "gpg --symmetric" not in backup:
        out.append("backup.sh must encrypt the archive (it holds the keys)")
    for banned in ("clamav-db", "clamd-db", "/tmp/", "models"):
        if re.search(rf"^(?!#).*\b(cp|tar)\b.*{re.escape(banned)}", backup, re.M):
            out.append(f"backup.sh copies {banned}, which is not settings")
    return out


def fangfrisch_options(text: str) -> dict[str, str]:
    """Options of the [sanesecurity] section."""
    section = re.search(r"^\[sanesecurity\]\n(.*?)(?=^\[|\Z)", text.replace("\r", ""), re.M | re.S)
    return {k: val.strip() for k, val in re.findall(r"^(\w+)\s*=\s*(.*)$", section.group(1) if section else "", re.M)}


def check_clamd(c: dict) -> list[str]:
    out = []
    svc = c["services"]["clamd"]
    if svc.get("build") != "../intake-worker/clamd":
        out.append("clamd: build context must be ../intake-worker/clamd (the worker's own image with the Sanesecurity feeds)")
    if not str(svc.get("image", "")).startswith("hms/clamd:${HMS_TAG"):
        out.append("clamd: image must be hms/clamd:${HMS_TAG...} so roll back can find old images")
    if not (CLAMD_FOLDER / "Dockerfile").is_file():
        return out + ["clamd: no Dockerfile in intake-worker/clamd"]
    for src in dockerfile_info(CLAMD_FOLDER)["copies"]:
        if not (CLAMD_FOLDER / src).exists():
            out.append(f"clamd: Dockerfile copies {src}, which does not exist in intake-worker/clamd")
    docker = (CLAMD_FOLDER / "Dockerfile").read_text(encoding="utf-8")
    if not re.search(r"^FROM clamav/clamav:\d", docker, re.M):
        out.append("clamd: the image must start from a pinned official clamav/clamav tag")
    if not re.search(r"fangfrisch==\d", docker):
        out.append("clamd: fangfrisch must be pinned")
    m = re.search(r"FRESHCLAM_CHECKS=(\d+)", docker)
    if not m or int(m.group(1)) < 1:
        out.append("clamd: freshclam must check at least once a day (FRESHCLAM_CHECKS)")
    for s in CLAMD_SCRIPTS:
        path = CLAMD_FOLDER / s
        if not path.is_file():
            out.append(f"clamd: {s} missing")
        elif not path.read_bytes().startswith(b"#!/bin/sh"):
            out.append(f"clamd: {s} must start with #!/bin/sh")
        elif b"\r" in path.read_bytes():
            out.append(f"clamd: {s} has Windows line endings (breaks /bin/sh)")
    opts = fangfrisch_options((CLAMD_FOLDER / "fangfrisch.conf").read_text(encoding="utf-8"))
    if opts.get("enabled") != "yes":
        out.append("clamd: fangfrisch.conf must enable [sanesecurity]")
    if opts.get("interval") not in ("24h", "1d"):
        out.append("clamd: Sanesecurity must be checked daily (interval = 24h)")
    if opts.get("integrity_check") != "sha256":
        out.append("clamd: Sanesecurity files must be SHA-256 checked")
    own_urls = sorted(k for k, val in opts.items() if k.startswith("url_") and not val.lower().startswith("disabled"))
    if own_urls:
        out.append(f"clamd: fangfrisch.conf sets URLs itself ({own_urls}); only 'disabled' lines are expected")
    feeds = (CLAMD_FOLDER / "feeds.sh").read_text(encoding="utf-8") if (CLAMD_FOLDER / "feeds.sh").is_file() else ""
    if "sanesecurity.checked" not in feeds or "stamp.py" not in feeds:
        out.append("clamd: feeds.sh must write the stamp the worker reads for the 48-hour alert")
    worker = c["services"]["intake-worker"]
    folder = (worker.get("environment") or {}).get("INTAKE_SIGNATURES_DIR")
    if f"clamd-db:{folder}:ro" not in [str(x) for x in worker.get("volumes") or []]:
        out.append("intake-worker: must mount clamd-db read only at INTAKE_SIGNATURES_DIR (signature age for the heartbeat)")
    mounts = [str(x).split(":")[:2] for x in svc.get("volumes") or []]
    if ["clamd-db", "/var/lib/clamav"] not in mounts or ["clamd-fangfrisch", "/var/lib/fangfrisch"] not in mounts:
        out.append("clamd: needs clamd-db at /var/lib/clamav and clamd-fangfrisch at /var/lib/fangfrisch")
    return out


def all_problems() -> list[str]:
    c = load_compose()
    return (check_services(c) + check_builds(c) + check_env(c) + check_resources(c) + check_networks(c)
            + check_nginx(c) + check_files() + check_clamd(c))


def main() -> int:
    c = load_compose()
    problems = all_problems()
    print(f"services: {len(c['services'])}, memory limits {total_memory_gb(c):.2f} GB of {MEMORY_BUDGET_GB} GB budget")
    if problems:
        print(f"FAILED: {len(problems)} problem(s)")
        for p in problems:
            print("  " + p)
        return 1
    print("OK: compose, Dockerfiles, settings names, limits, networks, nginx and scripts hang together (never run under Docker).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
