"""PDF disarm and rebuild: copy only the pages into a brand-new PDF, then strip every active
part from what was copied. Rendering of text, vectors and pictures is unchanged; scripts,
auto-run actions, attachments, forms logic and multimedia are gone."""
from __future__ import annotations

import io

import pikepdf

from .errors import Rejection

# Action types that do something other than move around the document.
ALWAYS_BAD_ACTIONS = {"/JavaScript": "javascript", "/Launch": "launch", "/SubmitForm": "submit_form",
                      "/GoToR": "goto_remote", "/GoToE": "goto_embedded", "/ImportData": "import_data",
                      "/Rendition": "multimedia", "/Movie": "multimedia", "/Sound": "multimedia",
                      "/SetOCGState": "layer_script"}
# Keys removed wherever they appear, with the label reported.
BAD_KEYS = {"/JS": "javascript", "/JavaScript": "javascript", "/AA": "auto_actions",
            "/OpenAction": "open_action", "/XFA": "xfa", "/EF": "embedded_files",
            "/EmbeddedFiles": "embedded_files", "/EmbeddedFile": "embedded_files",
            "/RichMediaContent": "rich_media", "/RichMediaSettings": "rich_media",
            "/RichMediaActivation": "rich_media", "/RichMediaDeactivation": "rich_media",
            "/AcroForm": "forms", "/Names": "name_trees", "/Perms": "permissions",
            "/Collection": "portfolio", "/DPart": "document_parts"}
BAD_ANNOT_SUBTYPES = {"/FileAttachment": "embedded_files", "/Screen": "multimedia", "/Movie": "multimedia",
                      "/Sound": "multimedia", "/RichMedia": "rich_media", "/3D": "rich_media"}
MAX_DEPTH = 40


def _is_dict(obj) -> bool:
    return isinstance(obj, (pikepdf.Dictionary, pikepdf.Stream))


def _action_found(action, strip_uri: bool, depth: int = 0) -> str | None:
    """Return a label if this action (or any action chained after it) is not harmless."""
    if depth > MAX_DEPTH or not _is_dict(action):
        return None
    kind = str(action.get("/S", ""))
    if kind in ALWAYS_BAD_ACTIONS:
        return ALWAYS_BAD_ACTIONS[kind]
    if kind == "/URI" and strip_uri:
        return "uri"
    nxt = action.get("/Next")
    if isinstance(nxt, pikepdf.Array):
        for item in nxt:
            found = _action_found(item, strip_uri, depth + 1)
            if found:
                return found
        return None
    return _action_found(nxt, strip_uri, depth + 1) if nxt is not None else None


def _clean_object(obj, strip_uri: bool, removed: set[str]) -> None:
    for key, label in BAD_KEYS.items():
        if key in obj:
            del obj[key]
            removed.add(label)
    for key in ("/A", "/PA"):
        if key in obj:
            label = _action_found(obj[key], strip_uri)
            if label:
                del obj[key]
                removed.add(label)
    # An action object found directly (for example as a /Next target) is emptied.
    if str(obj.get("/S", "")) in ALWAYS_BAD_ACTIONS and "/Type" not in obj:
        for key in list(obj.keys()):
            del obj[key]


def _clean_annots(page, strip_uri: bool, removed: set[str]) -> None:
    annots = page.obj.get("/Annots")
    if not isinstance(annots, pikepdf.Array):
        return
    keep = pikepdf.Array()
    for annot in annots:
        if _is_dict(annot) and str(annot.get("/Subtype", "")) in BAD_ANNOT_SUBTYPES:
            removed.add(BAD_ANNOT_SUBTYPES[str(annot.Subtype)])
            continue
        keep.append(annot)
    page.obj["/Annots"] = keep


def residual(pdf: pikepdf.Pdf, strip_uri: bool) -> bool:
    """True if any active part is still reachable. Used to verify the rebuild."""
    for obj in pdf.objects:
        if not _is_dict(obj):
            continue
        if any(k in obj for k in BAD_KEYS if k not in ("/AcroForm", "/Names")):
            return True
        for key in ("/A", "/PA"):
            if key in obj and _action_found(obj[key], strip_uri):
                return True
        if str(obj.get("/Subtype", "")) in BAD_ANNOT_SUBTYPES:
            return True
    return False


def disarm_pdf(data: bytes, max_pages: int, strip_uri: bool) -> tuple[bytes, list[str]]:
    removed: set[str] = set()
    try:
        src = pikepdf.open(io.BytesIO(data))
    except pikepdf.PasswordError:
        raise Rejection("pdf_encrypted", "Password-protected PDFs are not accepted.")
    except (pikepdf.PdfError, ValueError, OSError):
        raise Rejection("pdf_corrupt", "The PDF could not be read.")
    try:
        if src.is_encrypted:
            raise Rejection("pdf_encrypted", "Encrypted PDFs are not accepted.")
        if len(src.pages) == 0:
            raise Rejection("pdf_corrupt", "The PDF has no pages.")
        if len(src.pages) > max_pages:
            raise Rejection("too_many_pages", "The PDF has too many pages.")
        # Anything attached at document level is dropped by rebuilding from the pages alone.
        root = src.Root
        for key in ("/OpenAction", "/AA"):
            if key in root:
                removed.add(BAD_KEYS[key])
        names = root.get("/Names")
        if _is_dict(names):
            if "/JavaScript" in names:
                removed.add("javascript")
            if "/EmbeddedFiles" in names:
                removed.add("embedded_files")
        form = root.get("/AcroForm")
        if _is_dict(form) and "/XFA" in form:
            removed.add("xfa")
        for obj in src.objects:
            if _is_dict(obj):
                if "/JS" in obj or "/EF" in obj:
                    removed.add("javascript" if "/JS" in obj else "embedded_files")
        out = pikepdf.new()
        out.pages.extend(src.pages)
        for page in out.pages:
            _clean_annots(page, strip_uri, removed)
        for obj in out.objects:
            if _is_dict(obj):
                _clean_object(obj, strip_uri, removed)
        if residual(out, strip_uri):
            raise Rejection("disarm_failed", "The PDF could not be made safe.")
        buf = io.BytesIO()
        out.save(buf, compress_streams=True)
        return buf.getvalue(), sorted(removed)
    except pikepdf.PdfError:
        raise Rejection("pdf_corrupt", "The PDF could not be rebuilt safely.")
    finally:
        src.close()
