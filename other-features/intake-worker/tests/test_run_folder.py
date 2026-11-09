"""The local-folder runner on invented cards: naming, collisions, the 500 KB cap, the report, and no personal values on the console."""
import csv
import subprocess
import sys
from pathlib import Path

import pytest

from tests import cards as C

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_folder.py"
sys.path.insert(0, str(SCRIPT.parent))
import run_folder  # noqa: E402


def test_naming_and_collisions():
    taken = set()
    f = {"name": {"value": "ramesh KUMAR shah"}}
    assert run_folder.output_name(f, "aadhaar", "jpg", taken) == "Ramesh_Shah_Aadhaar.jpg"
    assert run_folder.output_name(f, "aadhaar", "jpg", taken) == "Ramesh_Shah_Aadhaar_2.jpg"
    assert run_folder.output_name(f, "aadhaar", "jpg", taken) == "Ramesh_Shah_Aadhaar_3.jpg"
    assert run_folder.output_name({}, "pan", "png", taken) == "Unknown_PAN.png"
    assert run_folder.output_name({"name": {"value": "Madonna"}}, "voter-id", "jpg", taken) == "Madonna_VoterID.jpg"
    assert run_folder.output_name({"name": {"value": "A/B ../ C"}}, "unknown", "jpg", taken) == "AB_C_Document.jpg"


def test_random_sample_is_repeatable_and_streams():
    paths = (Path(f"x{i}.jpg") for i in range(100))
    a = list(run_folder.sample(paths, 10, seed=7))
    b = list(run_folder.sample((Path(f"x{i}.jpg") for i in range(100)), 10, seed=7))
    c = list(run_folder.sample((Path(f"x{i}.jpg") for i in range(100)), 10, seed=8))
    assert a == b and a != c and len(a) == 10 and len(set(a)) == 10


def test_runner_end_to_end_on_invented_cards(tmp_path):
    src, out = tmp_path / "GUEST ID ALL", tmp_path / "out"
    (src / "sub").mkdir(parents=True)
    C.aadhaar_front().save(src / "a1.png")
    C.aadhaar_front().save(src / "sub" / "a2.jpg")          # same person twice: the second gets _2
    C.pan_card(name="Peter Zwolle", dob="05/06/1985").save(src / "sub" / "p.png")
    (src / "notes.txt").write_text("not an id")
    (src / "broken.jpg").write_bytes(b"MZ not a picture")
    before = {p: p.read_bytes() for p in src.rglob("*") if p.is_file()}
    run = subprocess.run([sys.executable, str(SCRIPT), "--in", str(src), "--out", str(out), "--seed", "1"], capture_output=True, text=True, timeout=900)
    console = run.stdout + run.stderr
    assert run.returncode == 0, console
    pictures = [p for p in out.iterdir() if p.suffix in (".jpg", ".png", ".webp")]
    saved = sorted(p.stem for p in pictures)
    print("\nsaved:", saved)
    assert "Ramesh_Shah_Aadhaar" in saved and "Ramesh_Shah_Aadhaar_2" in saved and "Peter_Zwolle_PAN" in saved
    assert pictures and all(p.stat().st_size <= 512_000 for p in pictures)
    rows = list(csv.DictReader(open(out / "report.csv", encoding="utf-8")))
    assert len(rows) == 4  # the .txt is skipped; the broken .jpg is a row
    bad = [r for r in rows if "broken" in r["input"]][0]
    assert bad["status"] == "rejected: unsupported_type" and bad["steps_passed"] == ""
    good = [r for r in rows if r["status"].startswith("done")]
    # every ID photo takes the card path (MJ, 5 Nov 2026): the fast part (find, read, inspect, group), then the background part
    assert len(good) == 3 and all(r["steps_passed"].replace("scan>", "") == "type>rebuild>gate>find>read>inspect>group>cut>enhance>merge>compress"
                                  and int(r["bytes_after"]) > 0 for r in good)
    assert all(0 < float(r["form_seconds"]) < float(r["saved_seconds"]) for r in good)
    assert (out / "report.html").exists()
    for secret in ("Ramesh", "Shah", "Zwolle", "234567890124", "ABCPE", "a1.png", "GUEST ID ALL"):
        assert secret not in console  # counts only on the console
    assert {p: p.read_bytes() for p in src.rglob("*") if p.is_file()} == before  # the input folder is untouched


def test_runner_one_picture_per_person_across_two_sheets(tmp_path, monkeypatch, capsys):
    """--pool: fronts and backs on different sheets of one folder; one picture per person, rows per person, resume."""
    from app import people
    from tests import sheets as S
    import numpy as np
    from PIL import Image
    from tests import faces as F
    monkeypatch.setattr(people, "cut", S.stub_cut)  # the cutter has its own tests
    monkeypatch.setenv("INTAKE_READ_QR", "true")  # Anil's second back carries only a QR (QR reading is off by default)
    g = S.GUESTS

    def front(i: int):  # each front carries its guest's INVENTED drawn face (MJ's photo rule rejects a front without one)
        return Image.fromarray(F.put_photo(np.asarray(S.front(g[i]).convert("RGB")), F.photo(F.identity((2, 16, 27, 20)[i]), 0),
                                           (40, 190, 190, 370)))
    src, out = tmp_path / "sheets", tmp_path / "out"
    src.mkdir()
    S.sheet([front(0), S.back(g[1])]).save(src / "sheet1.png")
    S.sheet([front(1), S.back(g[0], with_number=False)]).save(src / "sheet2.png")
    S.sheet([front(2), front(3)], columns=1).save(src / "single-sheet.png")  # pooled too: same folder
    argv = ["run_folder.py", "--in", str(src), "--out", str(out), "--pool"]
    monkeypatch.setattr(sys, "argv", argv)
    assert run_folder.main() == 0
    console = capsys.readouterr().out
    saved = sorted(p.name for p in out.iterdir() if p.suffix in (".jpg", ".png", ".webp"))
    print("\nsaved:", saved)
    assert [n.rsplit(".", 1)[0] for n in saved] == ["Anil_Mehra_Aadhaar", "Kavita_Joshi_Aadhaar", "Meena_Desai_Aadhaar", "Suresh_Patel_Aadhaar"]
    assert all((out / n).stat().st_size <= 512_000 for n in saved)
    rows = list(csv.DictReader(open(out / "report.csv", encoding="utf-8")))
    assert len(rows) == 4 and [r["person"] for r in rows] == ["1", "2", "3", "4"]
    by = {r["output"].rsplit(".", 1)[0]: r for r in rows}
    assert by["Anil_Mehra_Aadhaar"]["evidence"] == "qrNameDob" and by["Kavita_Joshi_Aadhaar"]["evidence"] == "aadhaarNumber"
    assert by["Anil_Mehra_Aadhaar"]["sides"] == "front+back" and by["Anil_Mehra_Aadhaar"]["cards"] == "1+4"
    assert "unpairedSide" in by["Suresh_Patel_Aadhaar"]["flags"] and by["Suresh_Patel_Aadhaar"]["status"] == "done (check)"
    assert "name:filled" in by["Kavita_Joshi_Aadhaar"]["filled"] and "address:filled" in by["Kavita_Joshi_Aadhaar"]["filled"]
    report = (out / "report.csv").read_text(encoding="utf-8")
    for secret in ("Anil Mehra", g[0].number, "Lake View", "1981"):
        assert secret not in console and secret not in report  # counts on the console; filled/empty only in the report
    # Resume: nothing runs again, the rows stay.
    assert run_folder.main() == 0
    again = capsys.readouterr().out
    assert again.startswith("\n0 jobs run, 4 rows resumed") or "0 jobs run, 4 rows resumed" in again
    assert len(list(csv.DictReader(open(out / "report.csv", encoding="utf-8")))) == 4
    assert sorted(p.name for p in out.iterdir() if p.suffix in (".jpg", ".png", ".webp")) == saved


def test_the_runner_refuses_an_output_folder_inside_the_repository(tmp_path):
    repo_out = Path(__file__).resolve().parents[1] / "scratch-out"
    run = subprocess.run([sys.executable, str(SCRIPT), "--in", str(tmp_path), "--out", str(repo_out)], capture_output=True, text=True, timeout=60)
    assert run.returncode == 1 and not repo_out.exists()
