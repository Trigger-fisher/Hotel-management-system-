"""Key check and SSRF defence for the compress-url flow."""
from __future__ import annotations

import asyncio
import hmac
import ipaddress
import socket
from urllib.parse import urljoin, urlsplit

import httpx

from .errors import CompressorError

MAX_REDIRECTS = 3
HTTP_TIMEOUT = httpx.Timeout(30.0, read=120.0)


def key_ok(provided: str | None, expected: str) -> bool:
    # Constant time, so response timing does not leak how much of the key matched.
    return provided is not None and hmac.compare_digest(provided.encode(), expected.encode())


def _refuse(message: str) -> CompressorError:
    return CompressorError("url_not_allowed", message, 400)


async def resolve_host(host: str) -> list[str]:
    """Separate function so tests can replace DNS."""
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise _refuse("The address could not be resolved.")
    return [info[4][0] for info in infos]


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global


async def validate_url(url: str, allowed_hosts: tuple[str, ...]) -> str:
    """Return the URL when it is https, on the allow-list and resolves only to public IPs."""
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
    """GET with a size cap. Redirects are followed by hand and each hop is re-validated."""
    origin = urlsplit(url).hostname
    for _ in range(MAX_REDIRECTS + 1):
        await validate_url(url, allowed)
        try:
            async with client.stream("GET", url) as resp:
                if resp.is_redirect:
                    nxt = urljoin(url, resp.headers.get("location", ""))
                    if (urlsplit(nxt).hostname or "").lower() != (origin or "").lower():
                        raise _refuse("Redirects to another host are not allowed.")
                    url = nxt
                    continue
                if resp.status_code != 200:
                    raise CompressorError("download_failed", "The source file could not be downloaded.", 502)
                declared = resp.headers.get("content-length")
                if declared and declared.isdigit() and int(declared) > max_bytes:
                    raise CompressorError("download_too_large", "The source file is too large.", 413)
                body = bytearray()
                async for chunk in resp.aiter_bytes():
                    body += chunk
                    if len(body) > max_bytes:
                        raise CompressorError("download_too_large", "The source file is too large.", 413)
                return bytes(body)
        except httpx.HTTPError:
            raise CompressorError("download_failed", "The source file could not be downloaded.", 502)
    raise _refuse("Too many redirects.")


async def put(client: httpx.AsyncClient, url: str, allowed: tuple[str, ...], data: bytes, mime: str) -> None:
    """Upload the result. No redirects: a PUT must land on the validated host."""
    await validate_url(url, allowed)
    try:
        resp = await client.put(url, content=data, headers={"Content-Type": mime})
    except httpx.HTTPError:
        raise CompressorError("upload_failed", "The result could not be uploaded.", 502)
    if resp.status_code >= 300:
        raise CompressorError("upload_failed", "The result could not be uploaded.", 502)
