#!/usr/bin/env bash
# Restaura un respaldo sobre la base indicada en DATABASE_URL. DESTRUCTIVO: reemplaza los datos actuales.
# Uso: ./scripts/restore-mysql.sh backups/ff-facebook_factory-YYYYMMDD-HHMMSS.sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?Indicá el archivo .sql.gz a restaurar}"
[ -f "$FILE" ] || { echo "No existe $FILE" >&2; exit 1; }
gzip -t "$FILE"
_PRE_DB_URL="${DATABASE_URL:-}"; set -a; . ./.env; set +a; DATABASE_URL="${_PRE_DB_URL:-$DATABASE_URL}"  # una DATABASE_URL ya exportada tiene prioridad sobre .env
CNF="$(mktemp)"; trap 'rm -f "$CNF"' EXIT; chmod 600 "$CNF"
DB="$(DATABASE_URL="$DATABASE_URL" CNF="$CNF" node -e '
  const u = new URL(process.env.DATABASE_URL);
  const q = (s) => decodeURIComponent(s).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  require("fs").writeFileSync(process.env.CNF, `[client]\nuser="${q(u.username)}"\npassword="${q(u.password)}"\nhost="${u.hostname}"\nport=${u.port || 3306}\n`);
  process.stdout.write(u.pathname.slice(1));
')"
echo "Se va a REEMPLAZAR la base «$DB» con el contenido de $FILE."
read -r -p "Escribí el nombre de la base para confirmar: " ANS
[ "$ANS" = "$DB" ] || { echo "Cancelado."; exit 1; }
echo "Detené antes los procesos:  pm2 stop all"
gunzip -c "$FILE" | mysql --defaults-extra-file="$CNF" "$DB"
echo "Restauración completada. Reiniciá con: pm2 start ecosystem.config.cjs"
