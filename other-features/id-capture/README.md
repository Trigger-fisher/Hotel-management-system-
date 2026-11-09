# id-capture

A framework-free, guided capture of the **front and back of an ID** for a phone browser. Plain JavaScript, no runtime
dependencies, no build step. It opens the rear camera, shows a live outline around the document, asks for step 1 (front)
and step 2 (back), takes the picture **automatically** when the outline has stayed steady and the quick checks pass,
straightens each side to an upright rectangle, shows a preview with **Retake**, and hands the caller
`{ sessionId, sides: [{ side: 'front'|'back', blob, width, height, quad, checks }] }`. **It never uploads anything**: the
caller does that. It is fully self-contained and imports nothing from any other folder.

## Structure

| file | what | DOM? |
|---|---|---|
| `src/geometry.js` | corner ordering, quad scoring, steady-shift maths, homography, bilinear perspective warp | no |
| `src/steady.js` | steady-frame detector for auto-capture | no |
| `src/checks.js` | quick checks: blur (Laplacian), darkness, glare share, document size in frame; reason codes and messages **copied** from a quality-check module on purpose (no import across folders) | no |
| `src/cards.js` | "card too far" (print dpi of the card in the full picture) and the multi-card finder and hint | no |
| `src/jpeg.js` | heavy-compression warning for gallery JPEGs: JPEG header reader, quality from the quantisation table, bytes per pixel | no |
| `src/face.js` | optional face-presence hint on the front, browser's own `FaceDetector` only | no |
| `src/steps.js` | step state machine: front, review (retake or use), back, done; builds the result | no |
| `src/detect.js` | outline detection: pure JavaScript detector; OpenCV.js path (lazy, optional) | no |
| `src/capture.js` | thin camera / canvas glue | yes |
| `index.html`, `serve.mjs` | demo page and a tiny static server (`npm run demo`, port 8085; nothing is uploaded or logged) | yes |

Tested with `node --test` (28 tests, invented data only): corner order, convexity and scoring, homography and warp of a tilted
rectangle, the pure-JS detector finding a tilted document within 3% of the frame diagonal, the steady detector, the quick
checks with shared codes and messages, the step machine (retake, order of sides, result shape), and the checks below.

## Checks before upload (5 Nov 2026)

So reception and guests retake at once, before anything is sent. All are hints for speed; the worker checks everything again.

| check | when | rule | message |
|---|---|---|---|
| blur, darkness, glare | every camera frame (auto-capture waits) and the taken picture | as before; verified by tests | (unchanged) |
| card too far | every camera frame and every single-card picture | card's long side in the **full-size** picture against its printed size (85.6 mm ID-1; a squarer outline is taken as a 125 mm passport page): under **150 dpi** auto-capture waits and the review says retake, under **200 dpi** a soft hint. Same limits as the intake worker's clarity grade (copied 2026-11-05) | "The card is too far away. Move closer." / "Move a little closer for a sharper picture." |
| heavy compression | JPEG chosen from the gallery or camera app | quality read from the file's luminance quantisation table (libjpeg scale, same estimate and limits as the intake worker): under **25** heavy, under **45** compressed. Bytes per pixel is reported, and used only when a file has no table | "This picture is too compressed. Send the original or retake it." / "This picture looks compressed. The original reads better." |
| multi-card hint | picture chosen from the gallery or camera app | up to **12** separate cards found on a plain surface; several cards are fine (the whole picture is kept and the worker cuts it); any card under 150 dpi -> retake, more than 12 -> retake | "4 cards found." / "The cards are too small. Photograph 4 or fewer at a time." / "More than 12 cards. Photograph 4 or fewer at a time." |
| face on the front | the front side, only where the browser has a built-in `FaceDetector` | no face -> hint; face box under 40 px -> hint (40 copied from the intake worker) | "No photo found on the front. Retake with the whole front in view." / "The photo on the ID is too small. Move closer." |

**Face hint licence**: only the browser's own Shape Detection API (`FaceDetector`) is used: nothing is downloaded or bundled,
so no licence applies. It exists in Chromium on Android, ChromeOS and macOS; on iPhone Safari, Firefox and Windows desktop
browsers it is absent and the hint is silently skipped (switch off with `faceHint: false`). A third-party detector
(for example MediaPipe Face Detector, Apache-2.0, commercial use allowed) was **not** added: it needs a WebAssembly runtime and a
model file fetched at run time, which breaks this folder's no-dependency rule. The server's photo check stays the real gate
("Photo on the ID is not clear, please retake.").

**What was measured**: the JPEG quality estimate reads Pillow-made invented JPEGs back as q20 -> 20.4, q30 -> 30.1, q40 -> 39.9,
q50 -> 50, q75 -> 74.8, q92 -> 92, progressive q85 -> 85; libjpeg tables read back within 1 point from q24 to q98, and below q24
(the tables saturate at 255) still read under 25. The card finder found 4 of 4 tilted cards (dpi within 5%), 12 of 12 small cards
and 16 of 16 in a crowded picture, on invented pictures. In headless Edge (Windows) the page showed "4 cards found.", "The cards
are too small. Photograph 4 or fewer at a time." and "This picture is too compressed..." for three invented gallery pictures.

**Limits**: cards that touch or overlap merge into one blob and are not counted; a light card on a white table is not found
(the hint then says "No card found" as a soft warning only); an A4 printout (e-Aadhaar) is judged as a passport page, so its dpi
reads high. Bytes per pixel alone is a poor measure (a plain invented picture at q92 was only 0.04 bytes per pixel), which is
why the table decides whenever one exists. Not tried on a real phone or on real ID pictures.

## Version 2 notes

The phone page is **plain JavaScript only**: no OpenCV.js by default (it is about 8 MB), just steady-hand, blur and brightness checks on a canvas (a few KB). The live outline is an optional add-on loaded only if you pass `openCvUrl`. `src/gallery.js` checks files chosen from the gallery by their first bytes: HEIC, JPEG, PNG, WebP and PDF are accepted, with the 25 MB and 20-page caps; camera captures are written as JPEG (`image/jpeg`, quality 0.92). All of it is convenience; the worker checks everything again.

## Fallbacks

* **Camera** (`getUserMedia`, rear camera preferred): if it cannot open, the page says so and the button **Use the camera app**
  (`<input type=file accept=image/* capture=environment>`) takes over; the picture is then straightened with the same code.
  **Choose from gallery** accepts JPEG, PNG, WebP, HEIC and PDF; a PDF, or a HEIC the browser cannot show, is passed on as it
  is for the worker to convert and check.
* **Outline**: the pure JavaScript detector works by default. **OpenCV.js is optional and lazy-loaded** from a URL you host
  (`openCvUrl`; it is about 8-10 MB, so it is never bundled and never blocks the camera). If it fails to load, nothing changes.
  `detectQuadCv` is written for the browser and is **not exercised by the Node tests**.

## Honest limits

* The camera needs **HTTPS** (or `localhost`). iOS Safari only allows the camera in the foreground, on HTTPS, after a user
  gesture, and may re-ask permission; `capture=environment` behaves differently across browsers.
* The pure JavaScript detector assumes a document that differs from its background (a light card on a dark table); a dark card on
  a dark table, glare, and cluttered backgrounds can defeat it, and then the manual **Take photo now** button still works.
* Low-end phones run the 640 px analysis at fewer frames per second; the steady-frame count is configurable (`framesNeeded`).
* The check limits are tuned on synthetic frames and need calibrating on real photos. The server-side checks are the real gate;
  this is a convenience that gives instant feedback.
* Not tested on a real phone here (no device): only the pure functions were run, under Node.

## Possible flow (not built)

The caller uploads `sides[].blob` (JPEG) to a place it chooses. This module does not know where.
