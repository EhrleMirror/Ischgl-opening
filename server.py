#!/usr/bin/env python3
"""Ischgl Opening 2026 – kleiner Webserver ohne Abhängigkeiten.

Liefert den Ordner ./public aus und speichert Änderungen aus dem
Bearbeiten-Dialog in data.json.

Umgebungsvariablen:
  EDIT_TOKEN  Passwort zum Bearbeiten. Leer = Bearbeiten im Browser aus.
  PORT        Port (Standard 8080)
  DATA_FILE   Pfad zur data.json (Standard ./data/data.json)
"""
import gzip
import hmac
import html as htmllib
import json
import os
import re
import shutil
import tempfile
import threading
import time
import urllib.parse
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


# --- Pisten & Lifte aus OpenStreetMap (für Pistenplan und Ski-Navi) ------
PISTE_BBOX = os.environ.get("PISTE_BBOX", "46.895,10.225,46.995,10.43")  # S,W,N,O
OVERPASS_URLS = [u for u in os.environ.get(
    "OVERPASS_URLS",
    "https://overpass-api.de/api/interpreter,"
    "https://overpass.private.coffee/api/interpreter,"
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
).split(",") if u]
CONTACT = os.environ.get("CONTACT_URL", "https://github.com/EhrleMirror/ischgl-opening")
ELEVATION_URL = os.environ.get("ELEVATION_URL", "https://api.open-meteo.com/v1/elevation")
PISTE_TTL = 7 * 86400
PISTE_ERR_TTL = 10 * 60
LIFT_TYPES = {"cable_car", "gondola", "mixed_lift", "chair_lift", "drag_lift",
              "t-bar", "j-bar", "platter", "rope_tow", "magic_carpet"}
_piste_lock = threading.Lock()
_piste_state = {"err": None, "err_t": 0.0}


def piste_file():
    return os.path.join(os.path.dirname(DATA_FILE), "pistes.json")


def _http_json(url, data=None, timeout=120):
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": "IschglOpening/1.1 (private ski trip page; +%s)" % CONTACT,
        "Referer": CONTACT,
        "Accept": "*/*",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read(60_000_000).decode("utf-8"))


def _fetch_overpass():
    # Wege mit Geometrie, Relationen nur mit Mitgliederliste (spart Last)
    q = (
        "[out:json][timeout:90];"
        "("
        'way["piste:type"="downhill"](%(b)s);'
        'way["aerialway"](%(b)s);'
        ");out geom;"
        'relation["piste:type"="downhill"](%(b)s);out body;' % {"b": PISTE_BBOX}
    )
    body = urllib.parse.urlencode({"data": q}).encode()
    errors = []
    for url in OVERPASS_URLS:
        host = urllib.parse.urlparse(url).netloc
        try:
            data = _http_json(url, data=body, timeout=120)
            if not data.get("elements"):
                raise ValueError("leere Antwort" + (": " + data["remark"] if data.get("remark") else ""))
            print("Pistendaten von %s geladen" % host, flush=True)
            return data
        except Exception as e:
            msg = getattr(e, "reason", None) or str(e)
            if hasattr(e, "code"):
                msg = "HTTP %s" % e.code
            errors.append("%s: %s" % (host, msg))
            print("Overpass %s: %s" % (host, e), flush=True)
    raise RuntimeError("OpenStreetMap-Daten nicht abrufbar – " + "; ".join(errors))


def _elevations(points):
    """Höhe für [(lat, lon), …] über Open-Meteo, in Paketen zu 100."""
    out = {}
    pts = list(points)
    for i in range(0, len(pts), 100):
        chunk = pts[i:i + 100]
        url = "%s?latitude=%s&longitude=%s" % (
            ELEVATION_URL,
            ",".join("%.5f" % p[0] for p in chunk),
            ",".join("%.5f" % p[1] for p in chunk),
        )
        try:
            res = _http_json(url, timeout=30).get("elevation") or []
        except Exception as e:
            print("Höhendaten nicht abrufbar:", e, flush=True)
            return out
        for p, e in zip(chunk, res):
            if isinstance(e, (int, float)):
                out[p] = e
        time.sleep(0.2)
    return out


def _num(v):
    try:
        return float(str(v).replace(",", ".").split()[0])
    except Exception:
        return None


def build_pistes(raw):
    """Rohdaten von Overpass → kompaktes Format für die Karte."""
    rel_info = {}
    for el in raw.get("elements", []):
        if el.get("type") != "relation":
            continue
        t = el.get("tags", {})
        info = {
            "n": t.get("piste:name") or t.get("name"),
            "r": t.get("piste:ref") or t.get("ref"),
            "d": t.get("piste:difficulty"),
        }
        for m in el.get("members", []):
            if m.get("type") == "way":
                cur = rel_info.setdefault(m["ref"], {})
                for k, v in info.items():
                    if v and not cur.get(k):
                        cur[k] = v

    ways = []
    for el in raw.get("elements", []):
        if el.get("type") != "way" or not el.get("geometry"):
            continue
        t = el.get("tags", {})
        geom = [(round(p["lat"], 6), round(p["lon"], 6)) for p in el["geometry"] if p]
        nodes = el.get("nodes") or []
        if len(geom) < 2:
            continue
        if any(t.get(k) for k in ("disused", "abandoned", "razed")):
            continue
        if t.get("aerialway") in LIFT_TYPES:
            dur = _num(t.get("aerialway:duration"))
            ways.append({"i": el["id"], "k": "l", "t": t["aerialway"],
                         "n": t.get("name"), "r": t.get("ref"),
                         "dur": dur, "g": geom, "nd": nodes})
        elif t.get("piste:type") == "downhill":
            if t.get("area") == "yes" or (geom[0] == geom[-1] and len(geom) > 3):
                continue
            ri = rel_info.get(el["id"], {})
            ways.append({"i": el["id"], "k": "p",
                         "d": t.get("piste:difficulty") or ri.get("d"),
                         "n": t.get("piste:name") or t.get("name") or ri.get("n"),
                         "r": t.get("piste:ref") or t.get("ref") or ri.get("r"),
                         "gr": t.get("piste:grooming"),
                         "g": geom, "nd": nodes})
    if not ways:
        raise RuntimeError("Keine Pisten oder Lifte im Gebiet gefunden")
    ends = set()
    for w in ways:
        ends.add(w["g"][0])
        ends.add(w["g"][-1])
    ele = _elevations(sorted(ends))
    for w in ways:
        w["e0"] = ele.get(w["g"][0])
        w["e1"] = ele.get(w["g"][-1])
        w["g"] = [[p[0], p[1]] for p in w["g"]]
    return {"ok": True, "fetchedAt": int(time.time()), "bbox": PISTE_BBOX,
            "elevation": bool(ele), "ways": ways,
            "attribution": "© OpenStreetMap-Mitwirkende (ODbL)"}


def get_pistes(force=False):
    path = piste_file()
    cached = None
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                cached = json.load(f)
        except Exception:
            cached = None
    fresh = cached and time.time() - cached.get("fetchedAt", 0) < PISTE_TTL
    if fresh and not force:
        return cached
    now = time.time()
    # "Nochmal" (force) darf frühestens nach 60 s neu anfragen, sonst gilt die Fehlerpause
    pause = 60 if force else PISTE_ERR_TTL
    if _piste_state["err"] and now - _piste_state["err_t"] < pause:
        if cached:
            return dict(cached, stale=True)
        wait = int(pause - (now - _piste_state["err_t"]))
        raise RuntimeError("%s (neuer Versuch in %d s möglich)" % (_piste_state["err"], wait))
    with _piste_lock:  # nur ein Abruf gleichzeitig
        if os.path.exists(path) and cached is None:
            with open(path, encoding="utf-8") as f:
                cached = json.load(f)
        try:
            data = build_pistes(_fetch_overpass())
            fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, separators=(",", ":"))
            os.replace(tmp, path)
            _piste_state["err"] = None
            return data
        except Exception as e:
            msg = "%s: %s" % (type(e).__name__, e)
            print("Pistendaten:", msg, flush=True)
            _piste_state.update(err=msg, err_t=time.time())
            if cached:
                return dict(cached, stale=True)
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
        body = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        gz = len(body) > 20000 and "gzip" in self.headers.get("Accept-Encoding", "")
        if gz:
            body = gzip.compress(body, 6)
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        if gz:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Vary", "Accept-Encoding")
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
            self._json(200, {"editable": bool(TOKEN), "snow": True, "pistes": True})
            return
        if p == "/api/pistes":
            force = "force=1" in (self.path.split("?", 1)[1] if "?" in self.path else "")
            try:
                self._json(200, get_pistes(force and not os.path.exists(piste_file())))
            except Exception as e:
                self._json(502, {"ok": False, "error": str(e)})
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
    if os.environ.get("PISTES_PREFETCH", "1") == "1":
        def _prefetch():
            try:
                get_pistes()
            except Exception as e:
                print("Pistendaten beim Start nicht geladen:", e, flush=True)
        threading.Thread(target=_prefetch, daemon=True).start()
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), partial(Handler, directory=PUBLIC))
    print(f"Ischgl Opening läuft auf http://0.0.0.0:{PORT}  (Bearbeiten {'an' if TOKEN else 'aus'})", flush=True)
    httpd.serve_forever()
