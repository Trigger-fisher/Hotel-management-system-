"""Signed-link IO. The links come from the job row and work for one object each; the worker has no storage keys.
Only https links to the configured storage host are used. Everything stays in memory."""
from __future__ import annotations

from urllib.parse import urlsplit

import httpx

from .config import MAX_BYTES
from .errors import StepError

TIMEOUT = httpx.Timeout(30.0)


def check_link(url: str, allowed_hosts: tuple[str, ...], step: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https" or (parts.hostname or "").lower() not in allowed_hosts:
        raise StepError("link_not_allowed", "A storage link is not on the allowed list.", 500, False, step)


def download(url: str, allowed_hosts: tuple[str, ...], client: httpx.Client | None = None) -> bytes:
    check_link(url, allowed_hosts, "download")
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT, follow_redirects=False)
    try:
        with client.stream("GET", url) as resp:
            if resp.status_code != 200:
                raise StepError("download_failed", "The uploaded file could not be fetched.", 502, False, "download")
            declared = resp.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > MAX_BYTES:
                from .errors import reject
                raise reject("file_too_large", "The file is larger than 25 MB.", "download")
            body = bytearray()
            for chunk in resp.iter_bytes():
                body += chunk
                if len(body) > MAX_BYTES:
                    from .errors import reject
                    raise reject("file_too_large", "The file is larger than 25 MB.", "download")
            return bytes(body)
    except httpx.HTTPError:
        raise StepError("download_failed", "The uploaded file could not be fetched.", 502, False, "download")
    finally:
        if owns:
            client.close()


def upload(url: str, data: bytes, allowed_hosts: tuple[str, ...], client: httpx.Client | None = None) -> None:
    check_link(url, allowed_hosts, "upload")
    owns = client is None
    client = client or httpx.Client(timeout=TIMEOUT, follow_redirects=False)
    try:
        resp = client.put(url, content=data, headers={"Content-Type": "application/octet-stream"})
        if resp.status_code >= 300:
            raise StepError("upload_failed", "The result could not be saved.", 502, False, "upload")
    except httpx.HTTPError:
        raise StepError("upload_failed", "The result could not be saved.", 502, False, "upload")
    finally:
        if owns:
            client.close()
