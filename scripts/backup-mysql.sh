#!/usr/bin/env bash
# Respaldo de MySQL (mysqldump consistente, comprimido) con retención.
# La contraseña NO se pasa por línea de comandos: se escribe un archivo temporal con permisos 600.
# Uso: ./scripts/backup-mysql.sh      Variables: BACKUP_DIR (./backups), BACKUP_RETENTION_DAYS (14), BACKUP_INCLUDE_MEDIA=1
set -euo pipefail
cd "$(dirname "$0")/.."

_PRE_DB_URL="${DATABASE_URL:-}"; set -a; [ -f .env ] && . ./.env; set +a; DATABASE_URL="${_PRE_DB_URL:-${DATABASE_URL:-}}"  # una DATABASE_URL ya exportada tiene prioridad sobre .env
: "${DATABASE_URL:?DATABASE_URL no está definida}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"

CNF="$(mktemp)"; trap 'rm -f "$CNF"' EXIT; chmod 600 "$CNF"
DB="$(DATABASE_URL="$DATABASE_URL" CNF="$CNF" node -e '
  const u = new URL(process.env.DATABASE_URL);
  const q = (s) => decodeURIComponent(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  require("fs").writeFileSync(process.env.CNF, `[client]\nuser="${q(u.username)}"\npassword="${q(u.password)}"\nhost="${u.hostname}"\nport=${u.port || 3306}\n`);
  process.stdout.write(u.pathname.slice(1));
')"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/ff-$DB-$STAMP.sql.gz"
echo "[backup] volcando $DB → $OUT"
mysqldump --defaults-extra-file="$CNF" --single-transaction --quick --routines --triggers --no-tablespaces --set-gtid-purged=OFF "$DB" | gzip -9 > "$OUT"
gzip -t "$OUT"                       # verifica que el archivo comprimido sea válido
[ "$(stat -c %s "$OUT")" -gt 1024 ] || { echo "[backup] ERROR: el respaldo es sospechosamente pequeño" >&2; rm -f "$OUT"; exit 1; }
chmod 600 "$OUT"

if [ "${BACKUP_INCLUDE_MEDIA:-0}" = "1" ] && [ -d "${STORAGE_DIR:-./storage}/media" ]; then
  tar -czf "$BACKUP_DIR/ff-media-$STAMP.tar.gz" -C "${STORAGE_DIR:-./storage}" media images 2>/dev/null || true
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'ff-*.sql.gz' -o -name 'ff-media-*.tar.gz' \) -mtime "+$RETENTION" -print -delete | sed 's/^/[backup] eliminado por retención: /'
echo "[backup] OK ($(du -h "$OUT" | cut -f1))"
