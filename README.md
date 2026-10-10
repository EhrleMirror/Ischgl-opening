# Ischgl Opening 2026

Trip-Seite fürs Ski-Opening in Ischgl: Countdown zum Konzert, Schneestand, Prognose,
16 eingebettete Webcams, Tickets, Anreise, Packliste.

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
| `YES=1` | keine Rückfragen |

## Daten aktualisieren

Seite öffnen → **Daten aktualisieren** → Passwort eingeben → Werte ändern → **Speichern**.
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
- **Statischer Webspace / Netlify:** Ordner `public/` hochladen. Bearbeiten über `…/#bearbeiten`,
  das Formular erzeugt eine neue `data.json` zum Ersetzen.

## Hinweise

- Webcam-Bilder kommen direkt von ischgl.com. Sperrt die Seite das Einbinden, zeigt die Kachel
  „Bild nicht verfügbar“ und „Live ↗“ führt zur Kamera.
- `install-ischgl.sh` ist der Installer, der im Container läuft. Er wird aus den Dateien
  im Repo gebaut und enthält sie gepackt.
- Die Seite ist per `noindex` von Suchmaschinen ausgeschlossen.
