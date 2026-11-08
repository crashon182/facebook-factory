# Despliegue en un servidor con CloudPanel (sitio Node.js) + GitHub Actions

Esta guía reemplaza a `docs/DEPLOY.md` cuando el servidor se administra con **CloudPanel**: el panel ya gestiona Nginx, HTTPS y las bases de datos, así que **no** se usa `deploy/nginx/` ni el usuario `ff`. Los scripts (`scripts/deploy.sh`, respaldo, monitoreo) son los mismos.

> Los pasos 1–7 se hacen **una sola vez, a mano**. Recién cuando la app funciona se activa el despliegue automático (paso 8).
> Nada de esto se probó todavía en un servidor real: ante cualquier diferencia con tu CloudPanel, manda la salida del comando que falle.

Notación: `SITIO` = usuario del sitio en CloudPanel, `DOMINIO` = el dominio del sitio, `RUTA` = `/home/SITIO/htdocs/DOMINIO`.

## 1. Sitio y base de datos en CloudPanel
1. **Sitio Node.js** (ya creado): anotá el **App Port** que le diste (usá `3000`; si usás otro, poné el mismo en `PORT` del `.env`). Node.js: versión **22**.
2. **Bases de datos → Add Database**: nombre `facebook_factory`, usuario y contraseña propios. Con eso armás `DATABASE_URL="mysql://USUARIO:CONTRASEÑA@127.0.0.1:3306/facebook_factory"`.
   - Si la contraseña tiene caracteres especiales (`@ : / # ?`), codificalos en la URL (`@` → `%40`).
   - Comprobá el motor: `mysqldump --version`. Con **MariaDB**, `scripts/backup-mysql.sh` falla por la opción `--set-gtid-purged` (propia de MySQL): avisame y lo adapto antes de activar el despliegue automático, porque el despliegue hace un respaldo previo.

## 2. Paquetes del sistema (como `root`, una vez)
```bash
apt-get update
apt-get install -y redis-server ffmpeg fonts-dejavu-core
ffmpeg -hide_banner -filters | grep drawtext      # debe listar drawtext
```
- **Redis** (BullMQ lo exige con política `noeviction`): editá `/etc/redis/redis.conf` → `maxmemory-policy noeviction`, `bind 127.0.0.1 ::1`, y `requirepass UNA-CONTRASEÑA-LARGA`; luego `systemctl restart redis-server`. En el `.env`: `REDIS_URL="redis://:UNA-CONTRASEÑA-LARGA@127.0.0.1:6379"`.
- **PM2** (si no está): `npm install -g pm2`. Verificá con el usuario del sitio: `sudo -iu SITIO bash -lc 'which node pm2 git; node -v'` (Node ≥ 22).

## 3. Código (como el usuario del sitio)
Entrá por SSH con `SITIO` y cloná el repositorio dentro de la carpeta del sitio:
```bash
cd /home/SITIO/htdocs/DOMINIO
ls -A                      # CloudPanel puede dejar archivos de ejemplo: si no los necesitás, borralos
git clone https://github.com/crashon182/facebook-factory.git .
```
- Si el repositorio es **privado**, el servidor necesita leerlo: generá una *deploy key* **de solo lectura** (`ssh-keygen -t ed25519 -f ~/.ssh/gh_read -N ""`), agregala en GitHub → repositorio → Settings → Deploy keys, y cloná por `git@github.com:crashon182/facebook-factory.git` (configurando `~/.ssh/config` para usar esa clave).
- La ruta **no debe tener espacios**.

## 4. Configuración (`.env`)
```bash
cp .env.example .env && chmod 600 .env && nano .env
```
Imprescindibles en producción: `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` y `ENCRYPTION_KEY` (`openssl rand -base64 32` para cada una), `AUTH_URL=https://DOMINIO`, `AUTH_TRUST_HOST=true`, `ADMIN_EMAIL` / `ADMIN_PASSWORD` (≥ 12 caracteres), `PORT` (= App Port), `NODE_ENV=production`, `STORAGE_DIR=/home/SITIO/ff-storage` (**fuera** de `htdocs`, para que un `git pull` o una limpieza no lo toquen), `BACKUP_DIR=/home/SITIO/ff-backups`, y las claves de OpenAI / Pexels / Meta que uses.

**Guardá `ENCRYPTION_KEY` en un lugar seguro**: sin ella los tokens de Meta cifrados no se recuperan.
```bash
mkdir -p /home/SITIO/ff-storage /home/SITIO/ff-backups
```

## 5. Primera instalación
```bash
npm ci
npx prisma migrate deploy
npm run db:seed          # crea el administrador desde ADMIN_EMAIL / ADMIN_PASSWORD
npm run build
pm2 start ecosystem.config.cjs
pm2 save
curl -fsS http://127.0.0.1:3000/api/health ; echo
```
Después **borrá `ADMIN_PASSWORD` del `.env`** (solo se usa en el seed).

Arranque automático tras reiniciar el servidor (una vez, como `root`): `pm2 startup systemd -u SITIO --hp /home/SITIO` y ejecutar el comando que imprime; luego, como `SITIO`, `pm2 save`.

## 6. HTTPS y proxy (en CloudPanel)
- El sitio Node.js ya hace de proxy inverso hacia el App Port. Emití el certificado en **SSL/TLS → Actions → New Let's Encrypt Certificate**.
- **Subida de archivos**: la biblioteca multimedia sube hasta ~330 MB. En **Vhost** del sitio agregá, dentro del `server { … }`, lo equivalente a lo de `deploy/nginx/facebook-factory.conf`:
  ```nginx
  location = /api/media/upload {
      client_max_body_size 330m;
      client_body_timeout 300s;
      proxy_request_buffering off;
      proxy_read_timeout 300s;
      proxy_pass http://127.0.0.1:3000;   # mismo puerto que PORT
  }
  ```
  (Si CloudPanel ya define su propio `location /`, dejalo; este bloque más específico tiene prioridad.) Sin esto, Nginx corta las subidas grandes con error 413.
- **Webhook de Meta**: la URL pública `https://DOMINIO/api/webhooks/meta` debe llegar a la app sin autenticación básica ni restricciones de IP del panel.
- Probá: `https://DOMINIO/login` carga y `https://DOMINIO/api/health` responde.

## 7. Respaldos y monitoreo (`crontab -e` del usuario `SITIO`)
```
0 3 * * *   cd /home/SITIO/htdocs/DOMINIO && ./scripts/backup-mysql.sh >> /home/SITIO/ff-backups/backup.log 2>&1
*/5 * * * * cd /home/SITIO/htdocs/DOMINIO && ./scripts/monitor.sh >> /home/SITIO/ff-backups/monitor.log 2>&1
```
Copiá los respaldos **fuera del servidor** (CloudPanel también puede hacer backups del sitio a S3/SFTP). Probá una restauración (`scripts/restore-mysql.sh`) en otra base antes de necesitarla.

## 8. Despliegue automático con GitHub Actions
El workflow `.github/workflows/ci.yml` hace, en cada push a `main`: typecheck, lint, pruebas (con MySQL, Redis y FFmpeg reales) y build; **si todo pasa**, entra por SSH y ejecuta `BACKUP_BEFORE_DEPLOY=1 ./scripts/deploy.sh` (respaldo, `git pull --ff-only`, `npm ci`, migraciones, build, recarga de PM2 y chequeo de salud). Si un paso falla, el despliegue se corta y el workflow queda en rojo. Ojo: `next build` reescribe la carpeta `.next` mientras la app sigue corriendo, así que un build fallido a mitad de camino puede dejar la web con errores hasta el próximo despliegue correcto (o hasta reconstruir a mano). Las pruebas y el build previos en GitHub existen justamente para que eso sea raro.

1. **Clave SSH de despliegue** (en tu equipo, no en el servidor):
   ```bash
   ssh-keygen -t ed25519 -f ff_deploy -N "" -C "github-actions-deploy"
   ```
   Agregá `ff_deploy.pub` al `~/.ssh/authorized_keys` del usuario `SITIO` en el servidor (o en CloudPanel → Admin Area / SSH Keys del sitio). Después de cargar la privada en GitHub, **borrá `ff_deploy` de tu equipo**.
2. **Huella del servidor** (para no confiar en el primer contacto): `ssh-keyscan -p 22 -t ed25519 IP-O-HOST` → copiá la línea. Verificá que coincida con la huella real del servidor (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` en el servidor).
3. En GitHub → repositorio → **Settings → Secrets and variables → Actions**:

   | Tipo | Nombre | Valor |
   |---|---|---|
   | Secret | `DEPLOY_HOST` | IP o hostname del servidor |
   | Secret | `DEPLOY_USER` | `SITIO` (usuario del sitio) |
   | Secret | `DEPLOY_PORT` | puerto SSH (22 si no lo cambiaste) |
   | Secret | `DEPLOY_SSH_KEY` | contenido completo de `ff_deploy` (la privada) |
   | Secret | `DEPLOY_KNOWN_HOSTS` | la línea de `ssh-keyscan` |
   | Secret | `DEPLOY_PATH` | `/home/SITIO/htdocs/DOMINIO` |
   | Variable | `DEPLOY_ENABLED` | `true` (hasta entonces el despliegue se omite) |

4. (Recomendado) **Settings → Environments → production**: agregá *Required reviewers* si querés aprobar a mano cada despliegue, y limitá el environment a la rama `main`.
5. Probá con un commit pequeño a `main` y mirá la pestaña **Actions**. En el servidor: `pm2 status` y `pm2 logs`.

**Seguridad**: la clave solo sirve para entrar como `SITIO`; los secretos de la aplicación (`.env`) **nunca** pasan por GitHub. Si sospechás que se filtró, borrá la línea de `authorized_keys` y generá otra.

**Revertir un despliegue malo**: lo más limpio es un `git revert <commit-malo>` en `main` y push: el mismo workflow despliega la reversión. Evitá `git checkout` de commits viejos en el servidor: deja el repositorio desacoplado y el próximo `git pull --ff-only` falla. Las migraciones **no** se deshacen solas: si una fue destructiva, restaurá el respaldo previo con `scripts/restore-mysql.sh`.
