"""Key check and SSRF defence for the read-url flow (same rules as the compressor)."""
from __future__ import annotations

import asyncio
import hmac
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from .errors import ReaderError

MAX_REDIRECTS = 3
HTTP_TIMEOUT = httpx.Timeout(30.0, read=120.0)


def key_ok(provided: str | None, expected: str) -> bool:
    return provided is not None and hmac.compare_digest(provided.encode(), expected.encode())


def _refuse(message: str) -> ReaderError:
    return ReaderError("url_not_allowed", message, 400)


async def resolve_host(host: str) -> list[str]:
    """Separate function so tests can replace DNS."""
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise _refuse("The address could not be resolved.")
    return [info[4][0] for info in infos]


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global


async def validate_url(url: str, allowed_hosts: tuple[str, ...]) -> str:
    try:
        parts = urlsplit(url)
        host, port = (parts.hostname or "").lower(), parts.port
    except ValueError:
        raise _refuse("The address is not valid.")
    if parts.scheme != "https":
        raise _refuse("Only https addresses are allowed.")
    if parts.username or parts.password:
        raise _refuse("Addresses with a login are not allowed.")
    if port not in (None, 443):
        raise _refuse("Only the standard https port is allowed.")
    try:
        ipaddress.ip_address(host)
        raise _refuse("Addresses made of numbers are not allowed.")
    except ValueError:
        pass
    if host not in allowed_hosts:
        raise _refuse("This host is not on the allowed list.")
    if not all(_is_public(a) for a in await resolve_host(host)):
        raise _refuse("This host points to a private network.")
    return url


async def fetch(client: httpx.AsyncClient, url: str, allowed: tuple[str, ...], max_bytes: int) -> bytes:
    """GET with a size cap; redirects are followed by hand, each hop re-validated, same host only."""
    origin = (urlsplit(url).hostname or "").lower()
    for _ in range(MAX_REDIRECTS + 1):
        await validate_url(url, allowed)
        try:
            async with client.stream("GET", url) as resp:
                if resp.is_redirect:
                    nxt = urljoin(url, resp.headers.get("location", ""))
                    if (urlsplit(nxt).hostname or "").lower() != origin:
                        raise _refuse("Redirects to another host are not allowed.")
                    url = nxt
                    continue
                if resp.status_code != 200:
                    raise ReaderError("download_failed", "The source file could not be downloaded.", 502)
                declared = resp.headers.get("content-length", "")
                if declared.isdigit() and int(declared) > max_bytes:
                    raise ReaderError("download_too_large", "The source file is too large.", 413)
                body = bytearray()
                async for chunk in resp.aiter_bytes():
                    body += chunk
                    if len(body) > max_bytes:
                        raise ReaderError("download_too_large", "The source file is too large.", 413)
                return bytes(body)
        except httpx.HTTPError:
            raise ReaderError("download_failed", "The source file could not be downloaded.", 502)
    raise _refuse("Too many redirects.")
