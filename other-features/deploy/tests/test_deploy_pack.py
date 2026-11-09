"""Tests for the deployment pack. No Docker here: these check files and names only (see validate.py)."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import validate as v  # noqa: E402

# Found by this pack on 5 Nov 2026: reader/.dockerignore excludes "scripts", but reader/Dockerfile copies scripts/get_model.py and
# scripts/get_face_models.py, so "docker compose build reader" fails. The reader folder belongs to another agent today; the fix
# (drop "scripts" from reader/.dockerignore, or list only the scripts it should skip) is theirs. When it is fixed this test passes.
READER_SCRIPTS_IGNORED = "reader: Dockerfile copies scripts/get_model.py but reader/.dockerignore excludes it"


@pytest.fixture(scope="module")
def compose():
    return v.load_compose()


def test_compose_parses_and_has_every_service(compose):
    assert set(compose["services"]) == v.ALL_SERVICES
    assert v.check_services(compose) == []


def test_only_nginx_publishes_ports(compose):
    published = {n for n, s in compose["services"].items() if s.get("ports")}
    assert published == {"nginx"}


def test_build_folders_dockerfiles_and_model_scripts_exist(compose):
    problems = [p for p in v.check_builds(compose) if not p.startswith("reader: Dockerfile copies scripts/")]
    assert problems == []


@pytest.mark.xfail(strict=True, reason="reader/.dockerignore excludes scripts/ that reader/Dockerfile copies (reader agent's folder)")
def test_reader_image_can_copy_its_model_scripts(compose):
    assert not any(p.startswith(READER_SCRIPTS_IGNORED) for p in v.check_builds(compose))


def test_settings_names_come_from_each_folders_env_example(compose):
    assert v.check_env(compose) == []


def test_limits_restart_and_healthchecks_fit_the_vps(compose):
    assert v.check_resources(compose) == []
    assert v.total_memory_gb(compose) <= v.MEMORY_BUDGET_GB


def test_networks_keep_the_worker_apart(compose):
    assert v.check_networks(compose) == []


def test_nginx_routes_each_host_to_its_service(compose):
    assert v.check_nginx(compose) == []


def test_scripts_readme_and_backup(compose):
    assert v.check_files() == []


# ---- the checks themselves catch mistakes (so a green run means something)

def test_catches_a_second_published_port(compose):
    import copy
    c = copy.deepcopy(compose)
    c["services"]["reader"]["ports"] = ["8083:8083"]
    assert any("reader publishes ports" in p for p in v.check_services(c))


def test_catches_a_foreign_or_misspelled_setting(compose):
    import copy
    c = copy.deepcopy(compose)
    c["services"]["reader"]["environment"]["GATE_KEY"] = "${GATE_KEY}"
    c["services"]["compressor"]["environment"]["COMPRESSOR_MAX_UPLAOD_MB"] = "${COMPRESSOR_MAX_UPLAOD_MB}"
    problems = v.check_env(c)
    assert any("reader: receives GATE_KEY" in p for p in problems)
    assert any("COMPRESSOR_MAX_UPLAOD_MB" in p for p in problems)


def test_catches_a_blanked_model_path(compose):
    import copy
    c = copy.deepcopy(compose)
    c["services"]["intake-worker"]["environment"]["CARDCUT_MODEL"] = "${CARDCUT_MODEL:-}"
    assert any("overrides CARDCUT_MODEL" in p for p in v.check_env(c))


def test_catches_memory_over_budget_and_a_small_cutter(compose):
    import copy
    c = copy.deepcopy(compose)
    c["services"]["reader"]["deploy"]["resources"]["limits"]["memory"] = "2g"
    c["services"]["compressor"]["deploy"]["resources"]["limits"]["memory"] = "4g"
    problems = v.check_resources(c)
    assert any("reader" in p and "card cutter" in p for p in problems)
    assert any("over the" in p for p in problems)


def test_catches_missing_healthcheck_and_restart(compose):
    import copy
    c = copy.deepcopy(compose)
    del c["services"]["quality-gate"]["healthcheck"]
    c["services"]["pdf-to-image"]["restart"] = "no"
    problems = v.check_resources(c)
    assert any("quality-gate: no healthcheck" in p for p in problems)
    assert any("pdf-to-image: restart policy" in p for p in problems)


def test_catches_worker_on_the_public_network(compose):
    import copy
    c = copy.deepcopy(compose)
    c["services"]["intake-worker"]["networks"] = ["services", "intake"]
    assert any(p.startswith("intake-worker: networks") for p in v.check_networks(c))


def test_the_workers_clamd_loads_the_sanesecurity_feeds(compose):
    assert v.check_clamd(compose) == []


def test_catches_a_clamd_without_feeds_or_a_writable_mount(compose):
    import copy
    c = copy.deepcopy(compose)
    c["services"]["clamd"]["build"] = None
    c["services"]["intake-worker"]["volumes"] = ["clamd-db:/var/lib/clamav"]
    problems = v.check_clamd(c)
    assert any("build context" in p for p in problems)
    assert any("read only" in p for p in problems)


def test_fangfrisch_options_are_read_from_the_sanesecurity_section():
    opts = v.fangfrisch_options("[DEFAULT]\nx = 1\n[sanesecurity]\nenabled = yes\ninterval = 24h\nurl_junk = disabled\n[other]\ny = 2\n")
    assert opts == {"enabled": "yes", "interval": "24h", "url_junk": "disabled"}


def test_dockerignore_matching():
    assert v.ignored("scripts/get_model.py", ["scripts"]) == "scripts"
    assert v.ignored("app", [".venv", "tests"]) is None
    assert v.ignored("x.pyc", ["*.pyc"]) == "*.pyc"


def test_memory_units():
    assert v.memory_gb("512m") == 0.5 and v.memory_gb("3g") == 3 and v.memory_gb("3584m") == 3.5
