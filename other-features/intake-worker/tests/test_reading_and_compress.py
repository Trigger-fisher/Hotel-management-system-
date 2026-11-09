"""Part 10: the reading set (every wrong field flagged, not silently stored) and compression (cap, floor, round-trip)."""
import io
import time

import numpy as np
import pytest
from PIL import Image

from app import compress as comp
from tests import cards as C
from tests.conftest import make_job, make_pipeline, opened

CASES = {  # card builder -> expected document type, and a field that must be read
    "aadhaar": (C.aadhaar_front, "aadhaar", "documentNumber", C.AADHAAR),
    "pan": (C.pan_card, "pan", "documentNumber", "ABCPE1234F"),
    "driving-licence": (C.driving_licence, "driving-licence", "documentNumber", "MH1220110012345"),
    "voter-id": (C.voter_id, "voter-id", "documentNumber", "ABC1234567"),
    "employee-card": (C.employee_card, "employee-card", "documentNumber", "E-10492"),
}


@pytest.fixture()
def pipe(storage, engines, clamd):
    return make_pipeline(storage, engines, clamd.address)


def run(pipe, storage, img, **kw):
    job = make_job(storage, C.png(img), **kw)
    return pipe.process(job), job


def test_detection_and_field_accuracy_per_type(pipe, storage):
    hits = {}
    for name, (build, want, field, value) in CASES.items():
        result, _ = run(pipe, storage, build(), job_id=f"job-{name}")
        got = result["document_type"]["type"]
        field_ok = result["fields"].get(field, {}).get("value") == value
        hits[name] = (got == want, field_ok)
        print(f"\n{name:16s} type {got:16s} field {field}: {'ok' if field_ok else 'WRONG'}  doubtful={result['doubtful_fields']}")
    assert all(t and f for t, f in hits.values()), hits


def test_a_wrong_number_is_flagged_not_silently_stored(pipe, storage):
    bad = C.aadhaar_front(number="2345 6789 0123")  # fails the Verhoeff check
    result, _ = run(pipe, storage, bad)
    assert result["fields"]["documentNumber"]["valid"] is False
    assert "documentNumber" in result["doubtful_fields"] and result["needs_human_check"] is True


def test_qr_that_disagrees_with_the_text_makes_the_name_doubtful(storage, engines, clamd):
    """QR reading is OFF by default (MJ, 5 Nov 2026); the code stays behind INTAKE_READ_QR and still works when switched on."""
    off, _ = run(make_pipeline(storage, engines, clamd.address), storage, C.aadhaar_front(qr_name="Someone Else Entirely"))
    assert "name" not in off["doubtful_fields"] and "qrLast4" not in off["fields"]
    pipe = make_pipeline(storage, engines, clamd.address, read_qr=True)
    result, _ = run(pipe, storage, C.aadhaar_front(qr_name="Someone Else Entirely"), job_id="job-qr-on")
    assert "name" in result["doubtful_fields"] and result["needs_human_check"] is True


def test_unknown_card_is_read_not_failed_and_the_picture_is_kept(pipe, storage):
    result, job = run(pipe, storage, C.unknown_card())
    assert result["document_type"]["type"] == "unknown" and "unknownDocumentType" in result["flags"]
    assert result["needs_human_check"] is True and result["status"] == "done"
    assert opened(storage, job)[:2] in (b"\xff\xd8", b"\x89P")  # still saved so reception can type the fields


def test_only_chosen_fields_come_back_never_the_full_text(pipe, storage):
    result, _ = run(pipe, storage, C.pan_card())
    assert "lines" not in result and "text" not in result
    assert "Permanent Account Number" not in str(result)


def test_type_hint_and_configured_type_without_changing_worker_code(pipe, storage):
    club = C.unknown_card()
    config = {"name": "club-card", "keywords": ["golden club"], "fields": {"memberSince": r"since\s+(\d{4})"}}
    result, _ = run(pipe, storage, club, type_config=config)
    assert result["document_type"]["type"] == "club-card" and result["fields"]["memberSince"]["value"] == "2019"
    assert result["document_type"]["guessed"] == "unknown"  # the reader still guesses, reception confirms
    hinted, _ = run(pipe, storage, C.pan_card(), document_type="pan", job_id="job-hint")
    assert hinted["document_type"]["type"] == "pan"


def test_front_and_back_in_one_job_are_merged_and_judged(pipe, storage):
    """Two files of one ID (front, back): every ID photo takes the card path; the two cards pair by their number."""
    from tests import faces as F
    from tests import sheets as S
    g = S.GUESTS[0]
    front = Image.fromarray(F.put_photo(np.asarray(S.front(g).convert("RGB")), F.photo(F.identity(2), 0), (40, 190, 190, 370)))
    result, job = run(pipe, storage, front, back=C.png(S.back(g)))
    assert result["pages"] == 2 and result["same_person"] is not None and result["person"]["sides"] == ["front", "back"]
    stacked = Image.open(io.BytesIO(opened(storage, job)))
    assert stacked.height > S.CARD[1] * 1.9  # front above back in one picture


def test_mrz_passport_is_checked_per_field(pipe, storage):
    result, _ = run(pipe, storage, C.mrz_card("TD3", "PASSPORT"))
    print("\npassport:", result["document_type"], {k: v.get("valid") for k, v in result["fields"].items()})
    assert result["document_type"]["type"] in ("passport", "unknown")  # OCR of the MRZ strip is the weak point


# ---- compression -------------------------------------------------------------------------------

def noisy_picture(side=1400, seed=3):
    rng = np.random.default_rng(seed)
    base = np.asarray(Image.fromarray(rng.integers(0, 255, (side // 8, side // 8, 3), dtype=np.uint8)).resize((side, side), Image.BICUBIC))
    return base


def test_compress_meets_the_cap_and_the_floor_when_it_can():
    pic = np.asarray(C.pan_card().convert("RGB"))
    data, fmt, flags, scores = comp.compress(pic, cap=200_000)
    assert len(data) <= 200_000 and scores["ssim"] >= comp.SSIM_FLOOR and not flags


def test_quality_wins_over_size_only_when_the_hard_cap_is_switched_off():
    pic = noisy_picture()
    data, fmt, flags, scores = comp.compress(pic, cap=20_000, target=None, hard_cap=False)  # impossible at SSIM 0.98
    assert "sizeCapExceeded" in flags and len(data) > 20_000
    assert (scores["ssim"] >= comp.SSIM_FLOOR) or fmt == "png"
    data, fmt, flags, scores = comp.compress(pic, cap=20_000, target=None)  # default: the cap is a hard maximum
    assert len(data) <= 20_000 and "qualityFloorRelaxed" in flags


def test_lossless_setting_gives_identical_pixels():
    """The hotel's "keep an exact copy" (MJ, 5 Nov 2026): WebP lossless, the same pixels, smaller than PNG; above the cap it is
    flagged, never made smaller."""
    pic = np.asarray(C.pan_card().convert("RGB"))
    data, fmt, flags, scores = comp.compress(pic, lossless=True)
    assert fmt == "webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP" and np.array_equal(comp.decode(data), pic)
    assert not flags and scores["lossless"] is True and len(data) < len(comp.png(pic))
    small_cap = len(data) - 1
    again, fmt, flags, _ = comp.compress(pic, cap=small_cap, lossless=True)
    assert again == data and flags == ["sizeCapExceeded"] and np.array_equal(comp.decode(again), pic)


def test_ocr_round_trip_refuses_a_candidate_that_changes_a_key_field():
    pic = np.tile(np.asarray(C.pan_card().convert("RGB")), (3, 3, 1))  # above the PNG size, so JPEG is searched
    cap = len(comp._jpeg(pic, 88))  # only qualities up to 88 fit: below the trust level, so the round trip is asked
    seen = []

    def accept(candidate):
        seen.append(1)
        return len(seen) >= 2  # the best fitting quality "changes a number": the next one down is tried
    data, fmt, flags, scores = comp.compress(pic, cap=cap, accept=accept, target=None)
    assert fmt == "jpeg" and len(seen) == 2 and scores["quality"] == 84 and not flags


def test_the_best_quality_that_fits_is_chosen_and_small_pictures_stay_lossless():
    pic = np.tile(np.asarray(C.pan_card().convert("RGB")), (3, 3, 1))
    data, fmt, flags, scores = comp.compress(pic, cap=len(comp._jpeg(pic, 95)), target=None)
    assert fmt == "jpeg" and scores["quality"] == 95
    small = np.asarray(C.pan_card().convert("RGB"))
    data, fmt, flags, scores = comp.compress(small, cap=512_000)
    assert fmt in ("png", "jpeg") and len(data) <= 512_000 and not flags


def test_150_kb_is_tried_first_and_500_kb_is_a_hard_maximum():
    """MJ (4 Nov 2026): aim for 150 KB first, never above 500 KB."""
    pic = np.tile(np.asarray(C.pan_card().convert("RGB")), (2, 2, 1))
    data, fmt, flags, scores = comp.compress(pic)
    assert len(data) <= comp.DEFAULT_TARGET and scores["target"] == "met" and scores.get("ssim", 1.0) >= comp.SSIM_FLOOR
    noisy = np.clip(pic.astype(np.int16) + np.random.default_rng(3).normal(0, 16, pic.shape), 0, 255).astype(np.uint8)
    noisy = np.tile(noisy, (2, 1, 1))  # noise does not compress: SSIM 0.98 cannot fit in 500 KB
    data, fmt, flags, scores = comp.compress(noisy)
    assert len(data) <= comp.DEFAULT_CAP and "targetMissed" in flags and "sizeCapExceeded" not in flags

def test_the_real_round_trip_runs_for_id_card_jobs_and_keeps_the_number(pipe, storage):
    result, job = run(pipe, storage, C.pan_card())
    again = comp.decode(opened(storage, job))
    assert result["fields"]["documentNumber"]["value"] == "ABCPE1234F" and again.shape[1] == C.SIZE[0]
    assert result["scores"]["compress"].get("ssim", 1.0) >= comp.SSIM_FLOOR


def test_a_hotel_cap_and_lossless_come_from_the_job_row(pipe, storage):
    result, job = run(pipe, storage, C.pan_card(), lossless=True, job_id="job-lossless")
    assert result["scores"]["format"] == "webp" and np.array_equal(comp.decode(opened(storage, job)), np.asarray(C.pan_card().convert("RGB")))
    assert result["scores"]["enhance"] == [] and result["scores"]["compress"]["lossless"] is True  # nothing touched the pixels


def test_timing_of_one_id_both_sides(pipe, storage):
    t0 = time.perf_counter()
    run(pipe, storage, C.aadhaar_front(), back=C.png(C.driving_licence()), job_id="job-timing")
    print(f"\none ID, two sides, real engines: {time.perf_counter() - t0:.1f} s on this PC")
