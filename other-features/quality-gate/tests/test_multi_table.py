"""multi-id: detection rate by card count and how well the per-card judge names the unreadable cards (invented sheets)."""
import cv2
import numpy as np

from app.jobs import WorkerConfig, run_check
from tests.conftest import png
from tests.imaging import blur, noise
from tests.test_gate import sheet

CFG = WorkerConfig()


def warp_slightly(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = np.float32([[w * 0.01, h * 0.01], [w * 0.99, 0], [w, h * 0.995], [0, h]])
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=(90, 120, 150))


def test_detection_rate_by_card_count():
    rows = []
    for n in (1, 2, 4, 6, 10, 12):
        frame = (2400, 3200) if n <= 12 else (3200, 4200)
        img = noise(sheet(n, card_scale=0.17 if n > 8 else 0.2, frame=frame, seed=n), 4.0, seed=n)
        result = run_check(png(warp_slightly(img)), CFG, "multi-id")
        rows.append((n, result["info"]["cards"], result["info"]["unreadable"], result["verdict"]))
    print("\ncards drawn | found | judged unreadable | verdict")
    for n, found, bad, verdict in rows:
        print(f"{n:11d} | {found:5d} | {bad:17d} | {verdict}")
    assert all(abs(found - n) <= 1 for n, found, _, _ in rows)
    assert sum(found == n for n, found, _, _ in rows) >= 5


def test_the_judge_names_how_many_blurred_cards_not_which_person():
    rows = []
    for n in (4, 6):
        for blurred in (0, 1, 2):
            frame = (2400, 3200)
            canvas = sheet(n, frame=frame, seed=10 + n)
            # blur the first `blurred` cards by blurring their region of the sheet
            cols = 4
            for i in range(blurred):
                r, c = divmod(i, cols)
                cx, cy = int(frame[1] * (c + 0.5) / cols), int(frame[0] * (r + 0.5) / 4)
                y0, y1, x0, x1 = max(0, cy - 300), cy + 300, max(0, cx - 400), cx + 400
                canvas[y0:y1, x0:x1] = blur(canvas[y0:y1, x0:x1], 9)
            result = run_check(png(canvas), CFG, "multi-id")
            rows.append((n, blurred, result["info"]["cards"], result["info"]["unreadable"]))
    print("\ncards | blurred | found | judged unreadable")
    for row in rows:
        print("%5d | %7d | %5d | %17d" % row)
    exact = sum(found == n and bad == blurred for n, blurred, found, bad in rows)
    assert exact >= len(rows) - 1
