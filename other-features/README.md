# other-features

For features that belong to none of the other folders. Every folder is a **separate, self-contained** program.

| folder | what it is | port | secret name |
|---|---|---|---|
| [compressor](compressor/README.md) | shrinks PDFs and pictures without visible loss, with a measured quality score | 8080 | `COMPRESSOR_KEY` |
| [antivirus](antivirus/README.md) | browser quick filter, ClamAV scan, then disarm and rebuild of PDFs and pictures | 8081 | `SCANNER_KEY` |
| [pdf-to-image](pdf-to-image/README.md) | only converts a PDF into page images (PDFium) with many validated options | 8082 | `CONVERTER_KEY` |
| [reader](reader/README.md) | reads text in many scripts (OCR), finds and flattens the document, MRZ/QR/ID helpers, front-and-back pairing | 8083 | `READER_KEY` |
| [quality-gate](quality-gate/README.md) | only judges a file (accept / warn / reject: blur, light, glare, size, cut-off), per profile, plus a browser quick check | 8084 | `GATE_KEY` |
| [intake-worker](intake-worker/README.md) | the one VPS program of intake flow v2: pulls jobs from a database table, does scan, pixel re-save, quality check, read, merge, compress, encrypt in memory; no open port | none | INTAKE_MASTER_KEY |
| [id-capture](id-capture/README.md) | guided phone-browser capture of an ID front and back with auto-capture and straightening (no uploads) | 8085 (demo) | none |

## Independence rule

MJ's rule: **nothing is interconnected; everything lives in its own folder.** Each folder has its own `.venv`,
`requirements.txt`, `Dockerfile`, `docker-compose.yml`, `.env.example`, secret name, port and tests. No folder imports from, reads
from, or calls another over HTTP or any other way. When two folders need the same helper (SSRF guard, constant-time key check,
magic-byte sniffing, SSIM, quality metrics, MRZ), each keeps its **own copy**, on purpose. Tests run per folder only. A README may
describe how services could be connected later in a short "Possible flow (not built)" paragraph, but no code, config or variable
implements it. `check-independence.py` enforces this: it fails on a path or import into a sibling folder, a sibling's setting name,
or a shared port or secret name. Run it with `python other-features/check-independence.py`.
