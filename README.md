# Ischgl Opening 2026

Trip-Seite fürs Ski-Opening in Ischgl im Après-Ski-Look: Countdown zum ersten Lift, Live-Schneelage,
0°-Grenze als Berg-Grafik, Pistenplan mit Ski-Navi, Wetterradar und 16 eingebettete Webcams.

**Automatisch bei jedem Öffnen (und per „Aktualisieren“):**

- Schneehöhen und Neuschnee der Messstationen Idalp, Alp Trida und Samnaun Dorf –
  der Server liest den offiziellen Schneebericht von ischgl.com (20 Minuten Zwischenspeicher).
- Temperaturen, 0°-Grenze und 7-Tage-Schneeprognose von [Open-Meteo](https://open-meteo.com).
- Webcam-Bilder direkt von ischgl.com, alle 5 Minuten neu (Idalp-Cam auch als Hintergrund oben).

**Pistenplan:**

- *Ski-Navi:* alle Pisten und Lifte der Silvretta Arena aus OpenStreetMap (der Server holt sie einmal pro Woche,
  prüft mit Höhendaten von Open-Meteo die Fahrtrichtung und speichert sie in `pistes.json`). Route von A nach B
  über Lifte und Pisten, Filter Blau / bis Rot / Alles, Start per GPS (nur über https), gesperrte Lifte per Antippen.
- *Live-Status offiziell:* der interaktive Pistenplan von Intermaps mit offenen Liften und Pisten, eingebettet.

**Wetterradar:** Regen-/Schneeradar der letzten 2 Stunden von RainViewer (animiert) sowie Windy-Karten für
Neuschnee-Prognose, 0°-Grenze und Wind.

**Von Hand im Browser:** Status des Skigebiets, offene Lifte, Pisten-km und eine Ansage an die Gruppe.

## Installation auf Proxmox

Auf dem Proxmox-Host (Node → **Shell**) einfügen:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/EhrleMirror/ischgl-opening/main/ischgl-lxc.sh)"
```

Das Skript

- fragt, ob die Seite per **Tailscale Funnel** von außen erreichbar sein soll (Auth-Key einfügen, `j` für Login per Link, leer = nur Heimnetz),
- lädt bei Bedarf das Debian-12-Template,
- legt einen unprivilegierten LXC an (nächste freie ID, 1 Kern, 256 MB RAM, 2 GB, DHCP auf `vmbr0`, Autostart),
- installiert die Seite als Dienst auf Port 8080,
- zeigt am Ende Adresse, Passwort zum Bearbeiten und ggf. die öffentliche `https://…ts.net`-Adresse.

Bricht die Shell-Verbindung ab (Handy im Standby), läuft das Skript weiter. Ergebnis: `tail -20 /root/ischgl-lxc.log`

### Update

```bash
UPDATE=120 bash -c "$(curl -fsSL https://raw.githubusercontent.com/EhrleMirror/ischgl-opening/main/ischgl-lxc.sh)"
```

`120` durch die Container-ID ersetzen. Daten und Passwort bleiben erhalten.
Tailscale nachrüsten: zusätzlich `TS_AUTHKEY=tskey-auth-…` davor schreiben.

### Veröffentlichen mit eigener Domain (Cloudflare Tunnel)

1. Cloudflare-Dashboard → **Networking → Tunnels → Create a tunnel**, Namen vergeben, **Create Tunnel**.
2. Bei „Debian“ den angezeigten Befehl kopieren (enthält den Token `eyJ…`).
3. Auf dem Proxmox-Host (`113` = Container-ID, Befehl/Token einfügen):
   ```bash
   CF_TOKEN='eyJ…' UPDATE=113 bash -c "$(curl -fsSL https://raw.githubusercontent.com/EhrleMirror/ischgl-opening/main/ischgl-lxc.sh)"
   ```
4. Zurück im Dashboard **Continue**, dann beim Tunnel **Routes → Add route → Published application**:
   Subdomain (z. B. `ischgl`), Domain wählen, **Service URL** `http://localhost:8080`, **Add route**.

Die Seite läuft dann unter `https://ischgl.deine-domain.de` mit HTTPS (GPS im Ski-Navi funktioniert).
Optional nur für die Kollegen freigeben: Cloudflare **Access** → Application für die Subdomain mit
E-Mail-Liste (Einmal-Code per Mail).

### Optionen

Vor `bash` schreiben, alle optional:

| Variable | Bedeutung |
|---|---|
| `CTID=120` | Container-ID (Standard: nächste freie) |
| `CT_HOSTNAME=ischgl` | Hostname |
| `STORAGE=local-lvm` | Speicher für die Disk |
| `BRIDGE=vmbr0` | Netzwerk-Bridge |
| `IP=192.168.1.50/24 GW=192.168.1.1` | feste IP statt DHCP |
| `DISK=2 RAM=256 CORES=1` | Ressourcen |
| `EDIT_TOKEN=…` | eigenes Passwort zum Bearbeiten |
| `TS_AUTHKEY=tskey-auth-…` | Tailscale Funnel mit Auth-Key |
| `TAILSCALE=1` | Tailscale Funnel mit Login-Link |
| `CF_TOKEN=eyJ…` | Cloudflare Tunnel einrichten |
| `YES=1` | keine Rückfragen |

## Daten aktualisieren

Seite öffnen → **Daten bearbeiten** → Passwort eingeben → Werte ändern → **Speichern**.
Schnee und Wetter kommen automatisch. Die Felder „Schnee von Hand“ braucht es nur,
falls der Schneebericht von ischgl.com nicht geladen werden kann.
Im Container:

```bash
systemctl status ischgl-opening     # Dienst
journalctl -u ischgl-opening -f     # Log
nano /etc/ischgl-opening.env        # Passwort/Port, danach: systemctl restart ischgl-opening
```

Daten liegen in `/var/lib/ischgl-opening/data.json`.

## Ohne Proxmox

- **Docker:** `EDIT_TOKEN` in `docker-compose.yml` setzen, `docker compose up -d --build`.
- **Python:** `EDIT_TOKEN=meinpasswort python3 server.py`
- **Statischer Webspace / Netlify:** Ordner `public/` hochladen. Wetter und Prognose laufen auch dort
  automatisch, Schneebericht und Ski-Navi brauchen den Server. Bearbeiten über `…/#bearbeiten`,
  das Formular erzeugt eine neue `data.json` zum Ersetzen.

## Hinweise

- Ändert ischgl.com den Aufbau des Schneeberichts, zeigt die Seite einen Hinweis und die Werte von Hand.
  Die Ursache steht im Log: `journalctl -u ischgl-opening -n 50`.
- Das Ski-Navi kennt keine Sperrungen, Lawinengefahr oder Pistenzustand. Qualität der Route = Qualität der
  OpenStreetMap-Daten. Pistendaten neu holen: `rm /var/lib/ischgl-opening/pistes.json && systemctl restart ischgl-opening`.
- Webcam-Bilder kommen direkt von ischgl.com. Sperrt die Seite das Einbinden, zeigt die Kachel
  „Bild nicht verfügbar“ und „Live ↗“ führt zur Kamera.
- `install-ischgl.sh` ist der Installer, der im Container läuft. Er wird aus den Dateien
  im Repo gebaut und enthält sie gepackt.
- Die Seite ist per `noindex` von Suchmaschinen ausgeschlossen.
