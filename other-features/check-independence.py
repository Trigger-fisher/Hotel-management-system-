"""Independence check for other-features. Run:  python other-features/check-independence.py

Every folder must be fully self-contained. This scans each folder (not .venv, node_modules, caches, .tessdata, samples)
and FAILS (exit 1) when it finds:
  1. a path or import that points into a sibling folder ("../", "other-features/<sibling>", "import <sibling>"),
  2. a sibling's environment / secret name (each service has its own prefix),
  3. an HTTP call built from a sibling's URL variable (covered by 2: <PREFIX>_URL),
  4. two folders sharing a published port or a key name.
README files may DESCRIBE a possible flow; they are not scanned. Plain words in comments (for example
"copied from compressor on 2026-11-04") are allowed: only real paths, imports and variable names count."""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# folder -> (environment prefixes it OWNS, secret name, port)
SERVICES = {
    "compressor": (("COMPRESSOR_",), "COMPRESSOR_KEY", 8080),
    "antivirus": (("SCANNER_",), "SCANNER_KEY", 8081),
    "pdf-to-image": (("CONVERTER_",), "CONVERTER_KEY", 8082),
    "reader": (("READER_",), "READER_KEY", 8083),
    "quality-gate": (("GATE_",), "GATE_KEY", 8084),
    "id-capture": ((), "", 8085),
    "intake-worker": (("INTAKE_",), "INTAKE_MASTER_KEY", 0),
    "training": (("TRAIN_",), "", 0),
}
SKIP_DIRS = {".venv", "node_modules", "__pycache__", ".pytest_cache", ".tessdata", "samples-local", ".git"}
SCAN_SUFFIXES = {".py", ".js", ".mjs", ".html", ".yml", ".yaml", ".conf", ".txt", ".sql", ".sh", ".json", ".example", ".toml", ""}
SELF = Path(__file__).name


def files(folder: Path):
    for path in folder.rglob("*"):
        if path.is_file() and not (set(path.relative_to(folder).parts) & SKIP_DIRS):
            name = path.name
            if name.lower().startswith("readme") or path.suffix.lower() == ".md":
                continue
            if path.suffix.lower() in SCAN_SUFFIXES or name in ("Dockerfile", ".env.example", ".dockerignore", ".gitignore"):
                yield path


def violations() -> list[str]:
    found: list[str] = []
    names = list(SERVICES)
    for folder_name, (own_prefixes, _, _) in SERVICES.items():
        folder = ROOT / folder_name
        if not folder.is_dir():
            continue
        siblings = [n for n in names if n != folder_name]
        foreign_prefixes = [p for n in siblings for p in SERVICES[n][0]]
        sibling_alt = "|".join(re.escape(n) for n in siblings)
        path_ref = re.compile(rf"other-features[/\\]+(?:{sibling_alt})\b")
        climb_ref = re.compile(r"(?:\.\.[/\\])+")
        import_ref = re.compile(rf"^\s*(?:from|import)\s+(?:{sibling_alt.replace('-', '_')})\b", re.M)
        for path in files(folder):
            try:
                text = path.read_text(encoding="utf-8-sig", errors="replace")
            except OSError:
                continue
            rel = path.relative_to(ROOT)
            depth = len(path.relative_to(folder).parts) - 1  # how many folders deep inside its own folder
            for lineno, line in enumerate(text.splitlines(), 1):
                if path_ref.search(line):
                    found.append(f"{rel}:{lineno}: path into another folder")
                for climb in climb_ref.finditer(line):
                    if climb.group(0).count("..") > depth:  # climbing out of its own folder
                        found.append(f"{rel}:{lineno}: relative path climbs out of its folder")
                for prefix in foreign_prefixes:
                    if re.search(rf"\b{prefix}[A-Z0-9_]+", line):
                        found.append(f"{rel}:{lineno}: uses another service's setting name ({prefix}...)")
                        break
            if import_ref.search(text):
                found.append(f"{rel}: imports a sibling folder")
    # shared ports / key names
    ports: dict[int, str] = {}
    keys: dict[str, str] = {}
    for name, (_, key, port) in SERVICES.items():
        if not (ROOT / name).is_dir():
            continue
        if port:
            if port in ports:
                found.append(f"port {port} is used by both {ports[port]} and {name}")
            ports[port] = name
        if key:
            if key in keys:
                found.append(f"secret name {key} is used by both {keys[key]} and {name}")
            keys[key] = name
    return found


def main() -> int:
    present = [n for n in SERVICES if (ROOT / n).is_dir()]
    problems = violations()
    print("folder          port   secret name")
    for n in present:
        print(f"{n:15s} {SERVICES[n][2] or '-':<6} {SERVICES[n][1] or '-'}")
    if problems:
        print(f"\nFAILED: {len(problems)} problem(s)")
        for p in problems:
            print("  " + p)
        return 1
    print(f"\nOK: {len(present)} folders checked, no cross-folder paths, imports, setting names or shared ports/keys.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
