#!/usr/bin/env bash
# Monitoreo básico para cron (cada 5 min). Sale con código 1 y avisa (opcional) si algo falla:
#   - /api/health?strict=1  (base de datos, Redis y los 4 procesos con latido)
#   - espacio libre en el almacenamiento
# Variables: HEALTH_URL (http://127.0.0.1:3000/api/health?strict=1), MONITOR_WEBHOOK_URL (POST JSON {"text": "..."}), MIN_FREE_PCT (10)
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && { set -a; . ./.env; set +a; }

URL="${HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/health?strict=1}"
MIN_FREE="${MIN_FREE_PCT:-10}"
problems=()

body="$(curl -sS --max-time 10 "$URL" 2>&1)" || true
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL" 2>/dev/null || echo 000)"
[ "$code" = "200" ] || problems+=("health check $code: ${body:0:300}")

dir="${STORAGE_DIR:-./storage}"; [ -d "$dir" ] || dir="."
used="$(df -P "$dir" | awk 'NR==2 {gsub("%","",$5); print $5}')"
free=$((100 - used))
[ "$free" -ge "$MIN_FREE" ] || problems+=("poco espacio libre en disco: ${free}% (mínimo ${MIN_FREE}%)")

if [ "${#problems[@]}" -eq 0 ]; then echo "OK $(date -Is)"; exit 0; fi
msg="Facebook Factory — $(hostname): $(printf '%s; ' "${problems[@]}")"
echo "ALERTA $(date -Is) $msg" >&2
if [ -n "${MONITOR_WEBHOOK_URL:-}" ]; then
  curl -sS --max-time 10 -H 'Content-Type: application/json' -d "$(node -e 'console.log(JSON.stringify({text: process.argv[1]}))' "$msg")" "$MONITOR_WEBHOOK_URL" >/dev/null || true
fi
exit 1
