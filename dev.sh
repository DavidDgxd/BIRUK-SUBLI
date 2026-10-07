#!/usr/bin/env bash
#
# dev.sh — run the Biruk Subli AI service (FastAPI) and web frontend (Vite)
# together for local and LAN (Wi-Fi) testing.
#
# Both servers bind to 0.0.0.0 so phones and other machines on the same
# network can reach them. Ctrl+C stops both; no zombies left on 8000/5173.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AI_DIR="$ROOT/ai-service"
WEB_DIR="$ROOT/web"
AI_PORT="${AI_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"

# --- output helpers ----------------------------------------------------------
if [[ -t 1 ]]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; D=''; N=''
fi
info() { printf '%s %s\n' "${B}${G}==>${N}" "${B}$*${N}"; }
warn() { printf '%s %s\n' "${B}${Y}==>${N}" "${B}$*${N}"; }
die()  { printf '%s %s\n' "${B}${R}==>${N}" "${B}$*${N}" >&2; exit 1; }

# --- helpers -----------------------------------------------------------------
port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :$port" 2>/dev/null | grep -q . && return 0
  fi
  (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && { exec 3>&-; return 0; }
  return 1
}

lan_ip() {
  local ip=''
  if command -v ip >/dev/null 2>&1; then
    ip=$(ip route get 1.1.1.1 2>/dev/null \
      | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')
  fi
  [[ -n "$ip" ]] || ip=$(hostname -I 2>/dev/null | awk '{ print $1 }')
  printf '%s' "${ip:-127.0.0.1}"
}

# --- pre-flight checks -------------------------------------------------------
[[ -f "$AI_DIR/main.py" ]] || die "ai-service/main.py not found (looked in $AI_DIR)"
[[ -f "$WEB_DIR/package.json" ]] || die "web/package.json not found (looked in $WEB_DIR)"
command -v npm >/dev/null 2>&1 || die "npm not found — install Node.js to run the Vite frontend."

# Prefer the project's venv (repo has requirements.txt, no pyproject.toml, so
# \`uv run\` would build a fresh env and re-download torch), fall back to uv.
UVICORN="$AI_DIR/venv/bin/uvicorn"
if [[ -x "$UVICORN" ]]; then
  AI_CMD=("$UVICORN")
  "$UVICORN" --version >/dev/null 2>&1 \
    || die "ai-service/venv exists but uvicorn won't run. Reinstall: python3 -m venv ai-service/venv && ai-service/venv/bin/pip install -r ai-service/requirements.txt"
elif command -v uv >/dev/null 2>&1; then
  AI_CMD=(uv run --with-requirements requirements.txt uvicorn)
  warn "No ai-service/venv — falling back to 'uv run' (may re-resolve/download dependencies)."
else
  die "No ai-service/venv and no 'uv'. Create the env:
    python3 -m venv ai-service/venv
    ai-service/venv/bin/pip install -r ai-service/requirements.txt"
fi

[[ -d "$WEB_DIR/node_modules" ]] \
  || die "web/node_modules missing — run: cd web && npm install"

# --- port checks -------------------------------------------------------------
for p in "$AI_PORT" "$WEB_PORT"; do
  port_in_use "$p" && die "Port $p is already in use. Stop the process using it, or override with AI_PORT=/WEB_PORT=."
done

# --- teardown ----------------------------------------------------------------
# Kids share this process group, so killing group 0 takes down uvicorn (and its
# --reload worker), Vite, and the log prefixers all at once.
trap 'kill 0' EXIT SIGINT SIGTERM

# --- launch ------------------------------------------------------------------
info "Starting AI service  -> http://0.0.0.0:$AI_PORT (loading CLIP model on first run)"
( cd "$AI_DIR" && exec "${AI_CMD[@]}" main:app --host 0.0.0.0 --port "$AI_PORT" --reload ) \
  2>&1 | sed -u "s/^/${D}[ai]${N}  /" &

info "Starting web frontend -> http://0.0.0.0:$WEB_PORT"
( cd "$WEB_DIR" && exec npm run dev -- --host 0.0.0.0 --port "$WEB_PORT" ) \
  2>&1 | sed -u "s/^/${D}[web]${N} /" &

IP="$(lan_ip)"
cat <<EOF

${B}  Biruk Subli — dev servers running${N}

${B}  Local:${N}   http://localhost:$WEB_PORT
${B}  Network:${N} http://$IP:$WEB_PORT          ${D}(open this on your phone)${N}
${B}  API:${N}     http://$IP:$AI_PORT/health     ${D}(LAN)${N}

${D}  Both bind to 0.0.0.0. If $IP does not load on another device,
  check your firewall allows $WEB_PORT/tcp and $AI_PORT/tcp on this network.${N}
${D}  Press Ctrl+C to stop both servers.${N}

EOF

# Exit (and tear everything down) as soon as either server stops.
set +e
wait -n
status=$?
set -e
warn "A server exited (status $status) — shutting down the other."
exit "$status"
