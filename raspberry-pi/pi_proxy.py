#!/usr/bin/env python3
"""Minimal localhost reverse proxy for a Raspberry Pi maintenance display.

Environment variables:
  MM_SITE_URL=https://maintenance.project-sly.uk
  CF_ACCESS_CLIENT_ID=...
  CF_ACCESS_CLIENT_SECRET=...

The browser opens http://127.0.0.1:8787/pi.html. Secrets stay in this
server-side process and are injected into outbound Cloudflare Access requests.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urljoin
import os

BASE = os.environ.get("MM_SITE_URL", "").rstrip("/") + "/"
CLIENT_ID = os.environ.get("CF_ACCESS_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("CF_ACCESS_CLIENT_SECRET", "")
HOST, PORT = "127.0.0.1", 8787

if not BASE.startswith("https://") or not CLIENT_ID or not CLIENT_SECRET:
    raise SystemExit("Set MM_SITE_URL, CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET")

SKIP_HEADERS = {"connection", "transfer-encoding", "content-length", "content-security-policy"}

class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self): self._proxy(head=True)
    def do_GET(self): self._proxy(head=False)

    def _proxy(self, head=False):
        target = urljoin(BASE, self.path.lstrip("/"))
        req = Request(target, method="HEAD" if head else "GET", headers={
            "CF-Access-Client-Id": CLIENT_ID,
            "CF-Access-Client-Secret": CLIENT_SECRET,
            "User-Agent": "MaintenanceDisplayPi/5.0",
            "Accept": self.headers.get("Accept", "*/*"),
        })
        try:
            with urlopen(req, timeout=20) as resp:
                body = b"" if head else resp.read()
                self.send_response(resp.status)
                for key, value in resp.headers.items():
                    if key.lower() not in SKIP_HEADERS:
                        self.send_header(key, value)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if body: self.wfile.write(body)
        except HTTPError as exc:
            body = exc.read()
            self.send_response(exc.code)
            self.send_header("Content-Type", exc.headers.get("Content-Type", "text/plain"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body and not head: self.wfile.write(body)
        except Exception as exc:
            body = f"Display proxy error: {exc}".encode()
            self.send_response(502)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head: self.wfile.write(body)

    def log_message(self, fmt, *args):
        print("maintenance-display:", fmt % args)

ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
