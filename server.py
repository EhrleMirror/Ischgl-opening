#!/usr/bin/env python3
"""Ischgl Opening 2026 – kleiner Webserver ohne Abhängigkeiten.

Liefert den Ordner ./public aus und speichert Änderungen aus dem
Bearbeiten-Dialog in data.json.

Umgebungsvariablen:
  EDIT_TOKEN  Passwort zum Bearbeiten. Leer = Bearbeiten im Browser aus.
  PORT        Port (Standard 8080)
  DATA_FILE   Pfad zur data.json (Standard ./data/data.json)
"""
import hmac
import json
import os
import shutil
import tempfile
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(BASE, "public")
SEED = os.path.join(PUBLIC, "data.json")
DATA_FILE = os.environ.get("DATA_FILE", os.path.join(BASE, "data", "data.json"))
TOKEN = os.environ.get("EDIT_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = 256 * 1024


def ensure_data():
    os.makedirs(os.path.dirname(DATA_FILE), exist_ok=True)
    if not os.path.exists(DATA_FILE):
        shutil.copyfile(SEED, DATA_FILE)


class Handler(SimpleHTTPRequestHandler):
    server_version = "IschglOpening/1.0"

    def _path(self):
        return self.path.split("?", 1)[0]

    def end_headers(self):
        p = self._path()
        if p in ("/data.json",) or p.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        p = self._path()
        if p == "/data.json":
            with open(DATA_FILE, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if p == "/api/config":
            self._json(200, {"editable": bool(TOKEN)})
            return
        super().do_GET()

    def do_POST(self):
        if self._path() != "/api/data":
            self._json(404, {"error": "Nicht gefunden"})
            return
        if not TOKEN:
            self._json(403, {"error": "Bearbeiten ist auf diesem Server ausgeschaltet (EDIT_TOKEN fehlt)."})
            return
        if not hmac.compare_digest(self.headers.get("X-Edit-Token", ""), TOKEN):
            time.sleep(1)  # bremst Raten
            self._json(401, {"error": "Passwort falsch."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BYTES:
            self._json(413, {"error": "Daten fehlen oder sind zu groß."})
            return
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(data, dict):
                raise ValueError("kein Objekt")
        except (ValueError, UnicodeDecodeError):
            self._json(400, {"error": "Ungültige Daten."})
            return
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(DATA_FILE), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, DATA_FILE)
        self._json(200, {"ok": True})

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)


if __name__ == "__main__":
    ensure_data()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), partial(Handler, directory=PUBLIC))
    print(f"Ischgl Opening läuft auf http://0.0.0.0:{PORT}  (Bearbeiten {'an' if TOKEN else 'aus'})", flush=True)
    httpd.serve_forever()
