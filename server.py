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
import html as htmllib
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(BASE, "public")
SEED = os.path.join(PUBLIC, "data.json")
DATA_FILE = os.environ.get("DATA_FILE", os.path.join(BASE, "data", "data.json"))
TOKEN = os.environ.get("EDIT_TOKEN", "")
PORT = int(os.environ.get("PORT", "8080"))
MAX_BYTES = 256 * 1024


# --- Offizieller Schneebericht (ischgl.com) ------------------------------
SNOW_URL = os.environ.get("SNOW_URL", "https://www.ischgl.com/de/winter/schneebericht")
SNOW_TTL = 20 * 60       # so lange gilt ein erfolgreicher Abruf
SNOW_MIN_GAP = 60        # "Aktualisieren" fragt höchstens einmal pro Minute neu an
SNOW_ERR_TTL = 2 * 60    # nach einem Fehler erst nach 2 Minuten erneut versuchen
SNOW_STATIONS = [
    ("Idalp", "Ischgl"),
    ("Alp Trida", "Samnaun"),
    ("Samnaun Dorf", "Samnaun"),
]
_snow_cache = {"t": 0.0, "data": None, "err_t": 0.0, "err": None}
_snow_lock = threading.Lock()


def html_to_text(raw):
    raw = re.sub(r"(?is)<(script|style|noscript|svg)\b.*?</\1>", " ", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", htmllib.unescape(raw)).strip()


def parse_snow(raw_html):
    """Liest die Stationstabelle des Schneeberichts aus dem Seitentext."""
    text = html_to_text(raw_html)
    stations = []
    for name, area in SNOW_STATIONS:
        m = re.search(
            re.escape(name)
            + r"\D{0,80}?(\d{1,2}\.?\d{3})\s*m\D{0,80}?(\d{1,3})\s*cm\D{0,80}?(\d{1,3})\s*cm",
            text,
        )
        if m:
            stations.append({
                "name": name,
                "area": area,
                "alt": int(m.group(1).replace(".", "")),
                "depth": int(m.group(2)),
                "fresh": int(m.group(3)),
            })
    if not stations:
        raise ValueError("Schneebericht hat ein unbekanntes Format")
    last = re.search(r"Letzter Schneefall:?\s*(\d{1,2}\.\d{1,2}\.\d{4})", text)
    return {"stations": stations, "lastSnowfall": last.group(1) if last else None}


def get_snow(force=False):
    now = time.time()
    with _snow_lock:
        c = dict(_snow_cache)
    age = now - c["t"]
    if c["data"] and (age < SNOW_MIN_GAP or (age < SNOW_TTL and not force)):
        return c["data"]
    if c["err"] and now - c["err_t"] < SNOW_ERR_TTL and not c["data"]:
        raise RuntimeError(c["err"])
    try:
        req = urllib.request.Request(SNOW_URL, headers={
            "User-Agent": "Mozilla/5.0 (IschglOpening private trip page)",
            "Accept-Language": "de-DE,de;q=0.9",
        })
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read(3_000_000).decode("utf-8", "replace")
        data = parse_snow(raw)
        data.update({"ok": True, "fetchedAt": int(now), "source": SNOW_URL})
        with _snow_lock:
            _snow_cache.update(t=now, data=data, err=None)
        return data
    except Exception as e:  # Netz, Format, Timeout …
        msg = "%s: %s" % (type(e).__name__, e)
        print("Schneebericht nicht abrufbar:", msg, flush=True)
        with _snow_lock:
            _snow_cache.update(err=msg, err_t=now)
        if c["data"]:            # alten Stand weitergeben, als veraltet markiert
            stale = dict(c["data"], stale=True)
            return stale
        raise RuntimeError(msg)


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
        if p in ("/data.json", "/", "/index.html", "/app.js") or p.startswith("/api/"):
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
            self._json(200, {"editable": bool(TOKEN), "snow": True})
            return
        if p == "/api/snow":
            force = "force=1" in (self.path.split("?", 1)[1] if "?" in self.path else "")
            try:
                self._json(200, get_snow(force))
            except Exception as e:
                self._json(502, {"ok": False, "error": str(e)})
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
