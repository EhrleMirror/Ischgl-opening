#!/usr/bin/env bash
# =====================================================================
#  Ischgl Opening 2026 – Proxmox-Helper
#  Legt einen Debian-LXC an und installiert die Trip-Seite darin.
#
#  Auf dem Proxmox-Host (Node → Shell) als root:
#      bash -c "$(curl -fsSL https://raw.githubusercontent.com/EhrleMirror/ischgl-opening/main/ischgl-lxc.sh)"
#
#  Update eines bestehenden Containers (z. B. 120):
#      UPDATE=120 bash -c "$(curl -fsSL https://raw.githubusercontent.com/EhrleMirror/ischgl-opening/main/ischgl-lxc.sh)"
#
#  Geht auch als Datei:  bash ischgl-lxc.sh   bzw.   bash ischgl-lxc.sh update 120
#
#  Einstellungen per Umgebungsvariable (alle optional):
#      CTID=120            Container-ID          (Standard: nächste freie)
#      CT_HOSTNAME=ischgl  Hostname
#      STORAGE=local-lvm   Speicher für die Disk (Standard: local-lvm bzw. erster passender)
#      TEMPLATE_STORAGE=local
#      BRIDGE=vmbr0
#      IP=dhcp             oder z. B. IP=192.168.1.50/24 GW=192.168.1.1
#      DISK=2 RAM=256 CORES=1
#      TAILSCALE=1         Tailscale installieren und Funnel auf Port 8080 einschalten
#      TS_AUTHKEY=tskey-…  Tailscale-Schlüssel, dann ohne Login-Link (gut fürs Handy)
#      CF_TOKEN=eyJ…       Cloudflare-Tunnel-Token: veröffentlicht die Seite über deine Domain
#      UPDATE=120          bestehenden Container aktualisieren statt neu anlegen
#      YES=1               keine Rückfragen
#
#  Die Ausgabe landet zusätzlich in /root/ischgl-lxc.log. Bricht die Verbindung
#  zur Web-Shell ab, läuft das Skript trotzdem zu Ende.
# =====================================================================
set -euo pipefail

CT_HOSTNAME="${CT_HOSTNAME:-ischgl}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
BRIDGE="${BRIDGE:-vmbr0}"
IP="${IP:-dhcp}"
GW="${GW:-}"
DISK="${DISK:-2}"
RAM="${RAM:-256}"
CORES="${CORES:-1}"
TAILSCALE="${TAILSCALE:-0}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
CF_TOKEN="${CF_TOKEN:-}"
CF_TOKEN="${CF_TOKEN##* }"   # falls der ganze Befehl aus dem Dashboard eingefügt wurde
[ -n "$TS_AUTHKEY" ] && TAILSCALE=1
YES="${YES:-0}"
REPO_RAW="${REPO_RAW:-https://raw.githubusercontent.com/EhrleMirror/ischgl-opening/main}"
LOGFILE=/root/ischgl-lxc.log

# Weiterlaufen, auch wenn die Web-Shell (Handy, Tab im Hintergrund) die Verbindung verliert,
# und alles zusätzlich ins Log schreiben.
trap '' HUP
exec > >(tee --output-error=warn -a "$LOGFILE") 2>&1
echo "----- $(date '+%F %T') ischgl-lxc.sh $* -----" >> "$LOGFILE"

BL='\033[1;34m'; GN='\033[1;32m'; RD='\033[1;31m'; YW='\033[1;33m'; CL='\033[0m'
msg()  { printf "${BL} ›${CL} %s\n" "$*"; }
ok()   { printf "${GN} ✔${CL} %s\n" "$*"; }
warn() { printf "${YW} !${CL} %s\n" "$*"; }
fail() { printf "${RD} ✘ %s${CL}\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Bitte als root auf dem Proxmox-Host ausführen."
for c in pct pveam pvesh pvesm; do
  command -v "$c" >/dev/null 2>&1 || fail "'$c' fehlt – läuft das wirklich auf einem Proxmox-Host?"
done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# Installer für den Container: aus dieser Datei (falls angehängt), sonst aus dem Repo laden
if [ -f "$0" ] && grep -q '^__INSTALLER_BELOW__$' "$0" 2>/dev/null; then
  awk 'f{print} /^__INSTALLER_BELOW__$/{f=1}' "$0" | base64 -d > "$TMP/install-ischgl.sh"
  RUN_CMD="bash $(readlink -f "$0")"
else
  INST_URL="$REPO_RAW/install-ischgl.sh?nocache=$(date +%s)"
  # Neuesten Commit nachschlagen und genau diese Version laden (umgeht den GitHub-Cache sicher)
  case "$REPO_RAW" in https://raw.githubusercontent.com/*/main)
    REPO_PATH="${REPO_RAW#https://raw.githubusercontent.com/}"; REPO_PATH="${REPO_PATH%/main}"
    SHA=$(curl -fsSL -m 15 -H "Accept: application/vnd.github.sha" "https://api.github.com/repos/$REPO_PATH/commits/main" 2>/dev/null || true)
    case "$SHA" in [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) INST_URL="https://raw.githubusercontent.com/$REPO_PATH/$SHA/install-ischgl.sh"; msg "Lade Version ${SHA:0:7} …";; esac
  ;; esac
  curl -fsSL -H "Cache-Control: no-cache" "$INST_URL" -o "$TMP/install-ischgl.sh" \
    || fail "Installer konnte nicht geladen werden: $REPO_RAW/install-ischgl.sh"
  RUN_CMD="bash -c \"\$(curl -fsSL $REPO_RAW/ischgl-lxc.sh)\""
fi
grep -q 'Ischgl Opening 2026 – Installer' "$TMP/install-ischgl.sh" \
  || fail "Installer ist beschädigt oder unvollständig."
FUNNEL_URL=""
ct_exec() { pct exec "$CTID" -- "$@"; }

wait_for_network() {
  msg "Warte auf Netzwerk im Container …"
  local i
  for i in $(seq 1 60); do
    if ct_exec sh -c 'hostname -I 2>/dev/null | grep -q "[0-9]"' >/dev/null 2>&1; then break; fi
    sleep 1
  done
  ct_exec sh -c 'hostname -I 2>/dev/null | grep -q "[0-9]"' >/dev/null 2>&1 \
    || fail "Container hat keine IP bekommen. DHCP und Bridge ($BRIDGE) prüfen."
  for i in $(seq 1 30); do
    if ct_exec getent hosts deb.debian.org >/dev/null 2>&1; then ok "Netzwerk bereit"; return 0; fi
    sleep 1
  done
  warn "DNS im Container funktioniert noch nicht. Installation wird trotzdem versucht."
}

run_installer() {
  msg "Installiere die Seite im Container $CTID …"
  pct push "$CTID" "$TMP/install-ischgl.sh" /root/install-ischgl.sh --perms 0700
  if [ -n "${EDIT_TOKEN:-}" ]; then
    ct_exec env EDIT_TOKEN="$EDIT_TOKEN" bash /root/install-ischgl.sh
  else
    ct_exec bash /root/install-ischgl.sh
  fi
}

setup_tailscale() {
  msg "Installiere Tailscale im Container …"
  ct_exec bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null'
  ct_exec bash -c 'curl -fsSL https://tailscale.com/install.sh | sh'
  echo
  if [ -n "$TS_AUTHKEY" ]; then
    msg "Melde bei Tailscale an (mit Schlüssel) …"
    ct_exec tailscale up --hostname "$CT_HOSTNAME" --authkey "$TS_AUTHKEY" \
      || { warn "Anmeldung fehlgeschlagen. Schlüssel prüfen, dann: TS_AUTHKEY=… UPDATE=$CTID $RUN_CMD"; return 0; }
  else
    warn "Jetzt einmal bei Tailscale anmelden: den Link unten im Browser öffnen."
    warn "Das Skript wartet bis zu 15 Minuten."
    timeout 900 pct exec "$CTID" -- tailscale up --hostname "$CT_HOSTNAME" \
      || { warn "Keine Anmeldung. Später nachholen: TAILSCALE=1 UPDATE=$CTID $RUN_CMD"; return 0; }
  fi
  ok "Bei Tailscale angemeldet"
  echo
  msg "Schalte Funnel für Port 8080 ein …"
  warn "Falls ein Link zum Freischalten von HTTPS/Funnel erscheint: öffnen und bestätigen, das Skript wartet."
  if timeout 900 pct exec "$CTID" -- tailscale funnel --bg 8080; then
    echo
    ct_exec tailscale funnel status || true
    FUNNEL_URL=$(ct_exec tailscale funnel status 2>/dev/null | grep -o 'https://[^ ]*' | head -n1 || true)
  else
    warn "Funnel ist noch nicht aktiv. Später nachholen: TAILSCALE=1 UPDATE=$CTID $RUN_CMD"
  fi
}

setup_cloudflared() {
  case "$CF_TOKEN" in eyJ*) ;; *) warn "CF_TOKEN sieht nicht wie ein Tunnel-Token aus (beginnt mit eyJ…). Übersprungen."; return 0;; esac
  msg "Installiere Cloudflare Tunnel (cloudflared) im Container …"
  ct_exec bash -c 'set -e; export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null
    mkdir -p --mode=0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" > /etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq && apt-get install -y -qq cloudflared >/dev/null' \
    || { warn "cloudflared konnte nicht installiert werden."; return 0; }
  if ct_exec test -f /etc/systemd/system/cloudflared.service; then
    msg "Ersetze bestehende Tunnel-Verbindung …"
    ct_exec cloudflared service uninstall >/dev/null 2>&1 || true
  fi
  ct_exec cloudflared service install "$CF_TOKEN" >/dev/null 2>&1 \
    || { warn "Tunnel-Dienst konnte nicht eingerichtet werden. Token prüfen."; return 0; }
  sleep 4
  if ct_exec systemctl is-active --quiet cloudflared; then
    ok "Cloudflare Tunnel läuft"
    CF_OK=1
  else
    warn "Tunnel-Dienst läuft nicht. Log: pct exec $CTID -- journalctl -u cloudflared -n 30"
  fi
}
CF_OK=0

# ---------------------------------------------------------------------
#  Update eines bestehenden Containers
# ---------------------------------------------------------------------
[ "${1:-}" = "update" ] && UPDATE="${2:-${UPDATE:-}}"
if [ -n "${UPDATE:-}" ]; then
  CTID="$UPDATE"
  pct status "$CTID" >/dev/null 2>&1 || fail "Container $CTID gibt es nicht."
  if [ "$TAILSCALE" = 1 ] && ! grep -q '/dev/net/tun' "/etc/pve/lxc/$CTID.conf"; then
    msg "Gebe TUN-Gerät für Tailscale frei (Container startet neu) …"
    {
      echo "lxc.cgroup2.devices.allow: c 10:200 rwm"
      echo "lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file"
    } >> "/etc/pve/lxc/$CTID.conf"
    if pct status "$CTID" | grep -q running; then pct shutdown "$CTID" --timeout 60 || pct stop "$CTID"; fi
  fi
  if ! pct status "$CTID" | grep -q running; then msg "Starte Container $CTID …"; pct start "$CTID"; fi
  wait_for_network
  run_installer
  if [ "$TAILSCALE" = 1 ]; then setup_tailscale; fi
  if [ -n "$CF_TOKEN" ]; then setup_cloudflared; fi
  ok "Update fertig."
  if [ "$CF_OK" = 1 ]; then
    echo
    echo "  Jetzt im Cloudflare-Dashboard beim Tunnel: Routes → Add route → Published application"
    echo "  Subdomain + Domain wählen, Service URL: http://localhost:8080"
  fi
  exit 0
fi

# ---------------------------------------------------------------------
#  Neuer Container
# ---------------------------------------------------------------------
CTID="${CTID:-$(pvesh get /cluster/nextid)}"
if pct status "$CTID" >/dev/null 2>&1; then fail "Container-ID $CTID ist schon belegt. Andere wählen: CTID=… $RUN_CMD"; fi

if [ -z "${STORAGE:-}" ]; then
  ROOTDIR_STORES=$(pvesm status -content rootdir 2>/dev/null | awk 'NR>1 && $3=="active" {print $1}')
  if echo "$ROOTDIR_STORES" | grep -qx 'local-lvm'; then STORAGE=local-lvm
  else STORAGE=$(echo "$ROOTDIR_STORES" | head -n1); fi
fi
[ -n "$STORAGE" ] || fail "Kein Speicher für Container gefunden. Mit STORAGE=… angeben."

ip link show "$BRIDGE" >/dev/null 2>&1 || fail "Bridge $BRIDGE gibt es nicht. Mit BRIDGE=… angeben."

if [ "$IP" = "dhcp" ]; then NET="name=eth0,bridge=$BRIDGE,ip=dhcp"
else
  [ -n "$GW" ] || fail "Bei fester IP bitte auch GW=… angeben."
  NET="name=eth0,bridge=$BRIDGE,ip=$IP,gw=$GW"
fi

if [ "$YES" != 1 ] && [ -t 0 ] && [ "$TAILSCALE" != 1 ]; then
  echo
  printf "${GN}  Ischgl Opening 2026${CL}\n\n"
  echo "  Soll die Seite für die Kollegen auch von außen erreichbar sein (Tailscale Funnel, kostenlos)?"
  echo "  Dann hier deinen Tailscale-Auth-Key einfügen (login.tailscale.com → Settings → Keys)."
  echo "  'j' = ohne Schlüssel, Anmeldung per Link. Leer lassen = nur im Heimnetz."
  read -r -p "  Auth-Key / j / leer: " ans
  case "$ans" in
    tskey-*) TS_AUTHKEY="$ans"; TAILSCALE=1 ;;
    j|J|ja|Ja|y|Y) TAILSCALE=1 ;;
  esac
fi

echo
printf "${GN}  Ischgl Opening 2026 – neuer Container${CL}\n\n"
printf "  %-12s %s\n" "Container" "$CTID ($CT_HOSTNAME)" \
                      "Ressourcen" "$CORES Kern, ${RAM} MB RAM, ${DISK} GB auf $STORAGE" \
                      "Netzwerk" "$BRIDGE, $IP" \
                      "Tailscale" "$([ "$TAILSCALE" = 1 ] && { [ -n "$TS_AUTHKEY" ] && echo "ja, mit Funnel (Auth-Key)" || echo "ja, mit Funnel (Login per Link)"; } || echo "nein, nur Heimnetz")"
echo
if [ "$YES" != 1 ] && [ -t 0 ]; then
  read -r -p "  Anlegen? [J/n] " a
  case "${a:-j}" in j|J|y|Y|ja|Ja) ;; *) echo "  Abgebrochen."; exit 0;; esac
fi

# --- Template --------------------------------------------------------
msg "Suche Debian-Template …"
# Debian 12 bevorzugt (läuft auf Proxmox 7, 8 und 9), Debian 13 nur als Ausweich
pick_tpl() { local l; l=$(cat); for v in 12 13; do
  echo "$l" | grep -E "^debian-$v-standard_" | sort -V | tail -n1 | grep . && return 0; done; return 0; }
TPL=$(pveam list "$TEMPLATE_STORAGE" 2>/dev/null | awk '{print $1}' | sed 's|.*vztmpl/||' \
      | grep -E '\.tar\.(zst|gz|xz)$' | pick_tpl || true)
if [ -z "$TPL" ]; then
  msg "Lade Template-Liste …"
  pveam update >/dev/null || fail "Template-Liste konnte nicht geladen werden (Internet am Host?)."
  TPL=$(pveam available --section system | awk '{print $2}' | pick_tpl || true)
  [ -n "$TPL" ] || fail "Kein Debian-Template gefunden."
  msg "Lade $TPL herunter …"
  pveam download "$TEMPLATE_STORAGE" "$TPL" >/dev/null || fail "Download fehlgeschlagen."
fi
ok "Template: $TPL"

# --- Container -------------------------------------------------------
msg "Lege Container $CTID an …"
pct create "$CTID" "$TEMPLATE_STORAGE:vztmpl/$TPL" \
  --hostname "$CT_HOSTNAME" \
  --cores "$CORES" --memory "$RAM" --swap 256 \
  --rootfs "$STORAGE:$DISK" \
  --net0 "$NET" \
  --unprivileged 1 --features nesting=1 \
  --onboot 1 \
  --description "Ischgl Opening 2026 – Trip-Seite (Port 8080)" >/dev/null
ok "Container $CTID angelegt"

if [ "$TAILSCALE" = 1 ]; then
  CONF="/etc/pve/lxc/$CTID.conf"
  if ! grep -q '/dev/net/tun' "$CONF"; then
    {
      echo "lxc.cgroup2.devices.allow: c 10:200 rwm"
      echo "lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file"
    } >> "$CONF"
  fi
  ok "TUN-Gerät für Tailscale freigegeben"
fi

msg "Starte Container …"
pct start "$CTID"
wait_for_network

run_installer

if [ "$TAILSCALE" = 1 ]; then
  setup_tailscale
fi
if [ -n "$CF_TOKEN" ]; then
  setup_cloudflared
fi

IPADDR=$(ct_exec sh -c "hostname -I | awk '{print \$1}'" 2>/dev/null || true)
TOKEN=$(ct_exec sed -n 's/^EDIT_TOKEN=//p' /etc/ischgl-opening.env 2>/dev/null || true)
echo
printf "${GN}══════════════════════════════════════════════════════${CL}\n"
printf "${GN}  Fertig!${CL}\n\n"
printf "  %-11s %s\n" "Container" "$CTID ($CT_HOSTNAME)"
printf "  %-11s %s\n" "Heimnetz" "http://${IPADDR:-<container-ip>}:8080"
if [ -n "$FUNNEL_URL" ]; then
  printf "  %-12s %s\n" "Öffentlich" "$FUNNEL_URL"
fi
echo
printf "  Update später:  UPDATE=%s %s\n" "$CTID" "$RUN_CMD"
printf "  Log:            %s\n" "$LOGFILE"
printf "${GN}══════════════════════════════════════════════════════${CL}\n"
exit 0
