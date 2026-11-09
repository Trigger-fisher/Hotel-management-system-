# HMS PDF to image converter

A small standalone service (FastAPI, for the Linux VPS in Docker) that turns a PDF into pictures.
**That is all it does:** no compression, no quality search, no virus scan, no OCR, and it calls no other
service. How it connects to the compressor, the scanner and the reader is **deliberately not decided yet**.
A link-based twin (`/v1/convert-url`, source and target links) will be added when MJ decides the flow.

Free and open-source only. The renderer is **PDFium** through `pypdfium2` (BSD/Apache licence; PyMuPDF is
not used because it is AGPL).

## Engines

* **PDFium** is the primary engine for everything.
* **Poppler** (`pdftoppm`/`pdfinfo`) and **Ghostscript** (`gs`) are fallbacks, used **only when PDFium cannot
  open the file** and only when installed. They are skipped for password PDFs (a password on a command line
  would be visible to other processes). `GET /health` lists which engines are present, and every
  response says which one was used (`X-Engine`).
* Nothing inside a PDF is ever executed (JavaScript, launch and open actions are ignored): this is a
  rendering engine only.

## API

All calls except `/health` need the header `X-Converter-Key: <CONVERTER_KEY>` (constant-time compare; the
service refuses to start without a 32+ character key). The key is checked before the upload is read.

`GET /health` -> `{status, version, engines: {pdfium, poppler, ghostscript}}`. No secrets.

`POST /v1/convert` multipart: `file` (the PDF) plus the option fields below.
* Default answer: a **ZIP streamed page by page** (page images wait on disk, one at a time is in memory; no
  total size is announced). Entries are `page-001.png`, `page-002.png`, ... (the number keeps the PDF's own
  page number and is widened to 4+ digits for long documents), plus `manifest.json` last (switch off with `manifest=false`).
* `?page=N` returns **one image** instead (with `X-Page`, `X-Width`, `X-Height`).
* Headers: `X-Pages` (pages in the PDF), `X-Rendered-Pages`, `X-Dpi-Used` (or `mixed` when some pages were
  clamped), `X-Engine`.
* `manifest.json`: `{pageCount, renderedPages, engine, format, pages:[{page, file, width, height, dpiUsed, clamped, bytes}], errors:[{page, code, message}]}`.

### Options (form fields, all validated with bounds)

| field | values | default | notes |
|---|---|---|---|
| `dpi` | 36-600 | 150 | alternative: `maxSide` |
| `maxSide` | 64-20000 px | none | longest side of every page; cannot be combined with `dpi` |
| `pages` | `1-3,5,8-` | all | 1-based; pages beyond the end are ignored; nothing left gives `page_range_empty` |
| `format` | png, jpeg (jpg), webp, avif, tiff, bmp | png | |
| `jpegQuality` | 1-100 | 90 | plain encoder setting (4:4:4); not a search |
| `webpQuality` / `webpLossless` | 1-100 / true,false | 90 / false | |
| `avifQuality` | 1-100 | 80 | |
| `pngCompress` | 0-9 | 6 | |
| `colorMode` | rgb, gray, bw | rgb | `bw` uses a clean threshold (automatic Otsu, or `bwThreshold` 1-254); PNG/TIFF store real 1-bit |
| `background` | white, transparent, `#rrggbb` | white | transparent only for png, webp, avif, tiff |
| `rotation` | auto, 0, 90, 180, 270 | auto | auto honours the page's own `/Rotate`; a number forces the final orientation |
| `box` | crop, media | crop | which page box defines the page |
| `renderAnnotations` / `renderForms` | true,false | true / true | |
| `lcdText` / `antiAlias` | true,false | false / true | `antiAlias=false` gives hard-edged text |
| `password` | text | none | only used to open the PDF; never logged or stored |
| `strictPages` | true,false | false | true: the first failing page fails the job (`page_failed`) |
| `manifest` | true,false | true | |

A very large page size is **clamped**: the DPI is reduced so one page never exceeds
`CONVERTER_MAX_MEGAPIXELS_PER_PAGE` (default 100 MP); `dpiUsed` and `clamped` in the manifest say so.

### Robustness

Encrypted-without-password, wrong password, corrupt, truncated, missing cross-reference table (PDFium
rebuilds it), zero pages, huge page sizes, malformed fonts, scripts: each ends in a result or a stable code.
**A page that fails never kills the job**: it appears in `errors` and the others continue (unless
`strictPages=true`; if every page fails: `all_pages_failed`). Limits: upload size, pages in the PDF, pixels per
page, pixels for the whole job, and a time limit.

Codes (`{"error": {"code", "message"}}`): `unauthorized` 401; `bad_option`, `no_file` 400; `unsupported_type`
415 (the type comes from the bytes: `%PDF-` within the first 1024 bytes); `file_too_large` 413; `pdf_corrupt`,
`pdf_password_required`, `pdf_bad_password`, `no_pages`, `too_many_pages`, `page_range_empty`, `page_failed`,
`all_pages_failed`, `output_too_large`, `encode_failed` 422; `busy` 429; `timeout` 504.

A bounded process pool (`CONVERTER_MAX_CONCURRENCY` workers plus `CONVERTER_QUEUE_SIZE` waiting) keeps rendering
off the event loop; when full the answer is `429 busy` with `Retry-After`. Every job has its own temp
directory that is removed after the response (or on any error). File names, contents and passwords are never logged.

## Environment

See `.env.example`. Required: `CONVERTER_KEY`. Others: `CONVERTER_MAX_CONCURRENCY` (2), `CONVERTER_QUEUE_SIZE`
(4), `CONVERTER_MAX_UPLOAD_MB` (100), `CONVERTER_MAX_PAGES` (500), `CONVERTER_MAX_MEGAPIXELS_PER_PAGE` (100),
`CONVERTER_MAX_TOTAL_MEGAPIXELS` (2000), `CONVERTER_JOB_TIMEOUT_S` (300).

## Run and test locally (Windows PowerShell)

```
cd other-features\pdf-to-image
& "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe" -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:CONVERTER_KEY = "<a random string of 32+ characters>"
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --port 8082
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe scripts\measure.py      # seconds per page at 150 and 300 dpi
```

Example: `curl -H "X-Converter-Key: $KEY" -F file=@doc.pdf -F dpi=200 -F format=jpeg -o pages.zip http://127.0.0.1:8082/v1/convert`

## Deploy on the VPS

1. Copy this folder to the server; `cp .env.example .env` and set a random `CONVERTER_KEY`.
2. `docker compose up -d --build` (binds 127.0.0.1:8082 only; the image also installs poppler and Ghostscript as fallbacks).
3. Put Nginx with HTTPS in front using `nginx.conf` (note `proxy_buffering off` so the ZIP streams).
4. Check `GET /health`. Give the container about 3 GB and a roomy `/tmp` (page images wait there until streamed).

The Docker files and the Nginx snippet were written without Docker and are untested.

## Honest notes

* **Text is no longer selectable or searchable** once a page is a picture. A text PDF often becomes **bigger**
  as pictures than the PDF was (the invented text page below is a few KB as PDF text but hundreds of KB as an image). Use this for scans, previews, thumbnails or
  when an image is required, not as a way to make PDFs smaller.
* Very large page sizes are clamped (reported, never silent).
* Fonts that a PDF does not embed are replaced by PDFium's built-in substitutes, so the look can differ slightly from Acrobat.
* Real timings on this Windows PC with an invented text page (A4, 55 lines), PDFium, per page:
  150 dpi: PNG 67 ms, JPEG 26 ms (about 470 KB / 360 KB per page); 300 dpi: PNG 229 ms, JPEG 77 ms (about 1.1 MB / 1.0 MB). Photos and scans
  cost more; measure on your own files with `scripts/measure.py`.
