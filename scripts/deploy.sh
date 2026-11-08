#!/usr/bin/env bash
# Despliegue en el servidor: actualizar código, dependencias, migraciones, build y recarga de PM2.
# Uso: ./scripts/deploy.sh            (opcional: BACKUP_BEFORE_DEPLOY=1 para respaldar la base antes de migrar)
set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ -f .env ] || { echo "Falta el archivo .env (copiá .env.example y completalo)." >&2; exit 1; }
command -v pm2 >/dev/null || { echo "PM2 no está instalado (npm i -g pm2)." >&2; exit 1; }

if [ "${BACKUP_BEFORE_DEPLOY:-0}" = "1" ]; then log "Respaldo de la base antes de migrar"; ./scripts/backup-mysql.sh; fi

log "Actualizando código"
git pull --ff-only

log "Instalando dependencias (npm ci)"
npm ci

log "Aplicando migraciones"
npx prisma migrate deploy

log "Compilando"
npm run build

log "Recargando procesos (PM2)"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

PORT="${PORT:-$(grep -E '^[[:space:]]*PORT=' .env | tail -1 | cut -d= -f2- | tr -d '" ' || true)}"
PORT="${PORT:-3000}"

log "Verificando salud"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health"; echo
    echo "Despliegue completado."; exit 0
  fi
  sleep 2
done
echo "La aplicación no respondió al health check. Revisá: pm2 logs ff-web" >&2
exit 1
