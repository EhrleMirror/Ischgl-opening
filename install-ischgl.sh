#!/usr/bin/env bash
# =====================================================================
#  Ischgl Opening 2026 – Installer
#  Für Debian/Ubuntu, z. B. einen Proxmox-LXC-Container.
#
#  Aufruf (als root im Container):
#      bash install-ischgl.sh
#
#  Optional:
#      EDIT_TOKEN=meinpasswort bash install-ischgl.sh   eigenes Passwort
#      PORT=9000 bash install-ischgl.sh                 anderer Port
#
#  Erneut ausführen = Update. Gespeicherte Daten bleiben erhalten.
# =====================================================================
set -euo pipefail

APP_DIR=/opt/ischgl-opening
DATA_DIR=/var/lib/ischgl-opening
ENV_FILE=/etc/ischgl-opening.env
UNIT=/etc/systemd/system/ischgl-opening.service
SVC_USER=ischgl

set_kv() {  # set_kv DATEI SCHLÜSSEL WERT – sicher auch bei Sonderzeichen
  python3 - "$1" "$2" "$3" <<'PY'
import sys
path, key, val = sys.argv[1:4]
lines = open(path).read().splitlines()
out, done = [], False
for l in lines:
    if l.startswith(key + "="):
        out.append(key + "=" + val); done = True
    else:
        out.append(l)
if not done:
    out.append(key + "=" + val)
open(path, "w").write("\n".join(out) + "\n")
PY
}
say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mFehler:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Bitte als root ausführen."
[ -r "$0" ] || fail "Skript bitte als Datei ausführen: bash install-ischgl.sh"
[ -d /run/systemd/system ] || fail "systemd läuft nicht. Bitte einen normalen Debian/Ubuntu-Container verwenden."

# --- Python ---------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  say "Installiere Python 3 …"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq python3 >/dev/null
fi
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 7) else 1)' \
  || fail "Python 3.7 oder neuer nötig (gefunden: $(python3 -V 2>&1))."

# --- Benutzer und Ordner --------------------------------------------
if ! id "$SVC_USER" >/dev/null 2>&1; then
  say "Lege Systembenutzer '$SVC_USER' an …"
  useradd --system --home-dir "$DATA_DIR" --no-create-home --shell /usr/sbin/nologin "$SVC_USER"
fi
mkdir -p "$APP_DIR" "$DATA_DIR"

# --- Dateien entpacken ----------------------------------------------
say "Kopiere Seitendateien nach $APP_DIR …"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
awk 'f{print} /^__PAYLOAD_BELOW__$/{f=1}' "$0" | base64 -d | tar -xz -C "$TMP"
[ -f "$TMP/server.py" ] || fail "Skript ist beschädigt (Daten fehlen). Bitte neu herunterladen."
rm -rf "$APP_DIR/public"
cp -r "$TMP/server.py" "$TMP/public" "$APP_DIR/"
chown -R root:root "$APP_DIR"
chmod -R u=rwX,go=rX "$APP_DIR"
chown "$SVC_USER:$SVC_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"

# --- Einstellungen --------------------------------------------------
NEW_TOKEN=0
if [ ! -f "$ENV_FILE" ]; then
  TOKEN="${EDIT_TOKEN:-}"
  if [ -z "$TOKEN" ]; then
    TOKEN=$(python3 -c 'import secrets; print(secrets.token_urlsafe(12))')
    NEW_TOKEN=1
  fi
  umask 077
  cat > "$ENV_FILE" <<EOF
# Ischgl Opening – Einstellungen. Nach Änderungen: systemctl restart ischgl-opening
EDIT_TOKEN=$TOKEN
PORT=${PORT:-8080}
DATA_FILE=$DATA_DIR/data.json
EOF
  umask 022
else
  say "Behalte bestehende Einstellungen aus $ENV_FILE"
  if [ -n "${EDIT_TOKEN:-}" ]; then
    set_kv "$ENV_FILE" EDIT_TOKEN "$EDIT_TOKEN"
    say "Passwort geändert."
  fi
  if [ -n "${PORT:-}" ]; then
    set_kv "$ENV_FILE" PORT "$PORT"
  fi
fi
chmod 600 "$ENV_FILE"
PORT_NOW=$(sed -n 's/^PORT=//p' "$ENV_FILE")
TOKEN_NOW=$(sed -n 's/^EDIT_TOKEN=//p' "$ENV_FILE")

# --- Dienst ---------------------------------------------------------
say "Richte Dienst ein …"
cat > "$UNIT" <<EOF
[Unit]
Description=Ischgl Opening 2026 (Trip-Seite)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
Group=$SVC_USER
EnvironmentFile=$ENV_FILE
WorkingDirectory=$APP_DIR
ExecStart=$(command -v python3) -u $APP_DIR/server.py
Restart=on-failure
RestartSec=3
NoNewPrivileges=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ischgl-opening >/dev/null 2>&1
systemctl restart ischgl-opening

# --- Prüfen ---------------------------------------------------------
OK=0
for _ in $(seq 1 20); do
  if python3 - "$PORT_NOW" <<'PY' >/dev/null 2>&1
import sys, urllib.request
urllib.request.urlopen("http://127.0.0.1:%s/api/config" % sys.argv[1], timeout=2).read()
PY
  then OK=1; break; fi
  sleep 0.5
done
[ "$OK" -eq 1 ] || { journalctl -u ischgl-opening -n 30 --no-pager || true; fail "Dienst antwortet nicht. Log steht oben."; }

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
printf '\033[1;32m✔ Ischgl Opening läuft.\033[0m\n'
echo
echo "  Seite:     http://${IP:-<container-ip>}:$PORT_NOW"
if [ "$NEW_TOKEN" -eq 1 ]; then
  echo "  Passwort:  $TOKEN_NOW   (zum Bearbeiten, bitte notieren)"
else
  echo "  Passwort:  steht in $ENV_FILE"
fi
echo
echo "  Status:    systemctl status ischgl-opening"
echo "  Log:       journalctl -u ischgl-opening -f"
echo "  Daten:     $DATA_DIR/data.json"
echo
exit 0
__PAYLOAD_BELOW__
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
