# Despliegue en Ubuntu (24.04 LTS)

Arquitectura: **Nginx (HTTPS) → Next.js (PM2)** + 4 procesos independientes en PM2 + MySQL 8 + Redis + FFmpeg.

| Proceso PM2 | Rol | Instancias |
|---|---|---|
| `ff-web` | Aplicación Next.js (escucha solo en 127.0.0.1:3000) | 1 |
| `ff-worker-generate` | Automatización por página, ideas, contenidos, preparación de medios, mantenimiento | 1 (escalable con `GENERATE_CONCURRENCY`) |
| `ff-worker-render` | Renderizado de Reels (FFmpeg) | 1 (CPU intensivo) |
| `ff-worker-publish` | Publicación en Facebook + escáner de vencimientos | 1 |
| `ff-scheduler` | Registra las tareas periódicas | **1 (una sola)** |

> Las tareas periódicas son *job schedulers* de BullMQ con id fijo (idempotentes): aunque por error corriera más de un planificador, en Redis existe una sola definición y no se duplican ejecuciones. Los workers pueden escalar; la garantía anti-duplicados está en la base de datos (reclamo atómico) y en el bloqueo por página.

## 1. Paquetes
```bash
sudo apt update && sudo apt install -y git curl build-essential ffmpeg fonts-dejavu-core \
  nginx certbot python3-certbot-nginx ufw redis-server mysql-server
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
ffmpeg -hide_banner -encoders | grep -E "libx264|aac"   # deben aparecer
```

## 2. MySQL (usuario con mínimos privilegios)
```sql
CREATE DATABASE facebook_factory CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'ff_app'@'localhost' IDENTIFIED BY 'CONTRASEÑA-LARGA';
GRANT ALL PRIVILEGES ON facebook_factory.* TO 'ff_app'@'localhost';   -- `migrate deploy` no necesita base "shadow"
```
`DATABASE_URL="mysql://ff_app:CONTRASEÑA@127.0.0.1:3306/facebook_factory"` (codificá en URL los caracteres especiales de la contraseña).

## 3. Redis (BullMQ lo exige así)
En `/etc/redis/redis.conf`:
```
bind 127.0.0.1 ::1
requirepass OTRA-CONTRASEÑA-LARGA
maxmemory-policy noeviction     # OBLIGATORIO: con otra política Redis podría borrar trabajos de la cola
appendonly yes                  # persistencia: las colas sobreviven a reinicios
```
`sudo systemctl restart redis-server` → `REDIS_URL="redis://:OTRA-CONTRASEÑA@127.0.0.1:6379"`.

## 4. Aplicación
```bash
sudo adduser --system --group --home /opt/facebook-factory ff
sudo -u ff git clone https://github.com/crashon182/facebook-factory.git /opt/facebook-factory   # ruta SIN espacios
cd /opt/facebook-factory && sudo -u ff cp .env.example .env && sudo chmod 600 .env && sudo -u ff nano .env
```
Variables imprescindibles en producción (ver `.env.example`): `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET` y `ENCRYPTION_KEY` (`openssl rand -base64 32` cada una), `AUTH_URL=https://TU-DOMINIO.com`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (≥ 12 caracteres), `STORAGE_DIR=/var/lib/facebook-factory/storage` (fuera del repositorio), claves de integraciones y `NODE_ENV=production`.
**Guardá `ENCRYPTION_KEY` en un lugar seguro:** sin ella los tokens de Meta cifrados no se pueden recuperar.
```bash
sudo mkdir -p /var/lib/facebook-factory/storage /var/backups/facebook-factory && sudo chown -R ff:ff /var/lib/facebook-factory /var/backups/facebook-factory
sudo -u ff npm ci
sudo -u ff npx prisma migrate deploy
sudo -u ff npm run db:seed            # crea el administrador desde ADMIN_EMAIL / ADMIN_PASSWORD
sudo -u ff npm run build
sudo -u ff pm2 start ecosystem.config.cjs
sudo -u ff pm2 save && pm2 startup systemd -u ff --hp /opt/facebook-factory   # ejecutá el comando que imprime
sudo -u ff pm2 install pm2-logrotate                                           # rotación de logs de PM2
```
Luego **borrá `ADMIN_PASSWORD` del `.env`** (solo se usa en el seed) e iniciá sesión.

## 5. Nginx + HTTPS
```bash
sudo cp deploy/nginx/facebook-factory.conf /etc/nginx/sites-available/facebook-factory
sudo sed -i 's/TU-DOMINIO.com/tu-dominio.com/g' /etc/nginx/sites-available/facebook-factory
sudo ln -s /etc/nginx/sites-available/facebook-factory /etc/nginx/sites-enabled/
# 1ª vez: emitir el certificado (comentá temporalmente el bloque 443 si nginx -t falla por falta de certificado)
sudo certbot --nginx -d tu-dominio.com
sudo nginx -t && sudo systemctl reload nginx
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```
La renovación de Let's Encrypt queda automática (`systemctl list-timers | grep certbot`). Next.js escucha solo en loopback; MySQL y Redis no deben exponerse.

## 6. Respaldos y monitoreo (cron del usuario `ff`: `sudo -u ff crontab -e`)
```
# Respaldo diario de MySQL a las 03:00 (retención 14 días; ver BACKUP_* en .env)
0 3 * * *  cd /opt/facebook-factory && BACKUP_DIR=/var/backups/facebook-factory ./scripts/backup-mysql.sh >> /var/log/facebook-factory-backup.log 2>&1
# Monitoreo cada 5 minutos (sale con código 1 y avisa por MONITOR_WEBHOOK_URL si algo falla)
*/5 * * * * cd /opt/facebook-factory && ./scripts/monitor.sh >> /var/log/facebook-factory-monitor.log 2>&1
```
- **Copiá los respaldos fuera del servidor** (rsync/rclone a otro equipo o almacenamiento): un respaldo en el mismo disco no protege contra la pérdida del disco.
- Restaurar: `pm2 stop all && ./scripts/restore-mysql.sh /ruta/ff-facebook_factory-AAAAMMDD-HHMMSS.sql.gz && pm2 start ecosystem.config.cjs`. **Probá una restauración** en otra base antes de necesitarla.
- `BACKUP_INCLUDE_MEDIA=1` agrega la biblioteca multimedia (`media`, `images`) al respaldo. Los renders se pueden regenerar.

## 7. Health checks y monitoreo
- `GET /api/health` → `{status, db, redis, workers}`; 200 si MySQL y Redis responden. `GET /api/health?strict=1` → 503 también si falta algún proceso (latido caído). Apto para UptimeRobot/Uptime Kuma.
- Pantalla **Automatización** de la app: procesos, colas, trabajos fallidos (reintentar/eliminar), estado por página, disco y FFmpeg.
- Logs: `pm2 logs`, `pm2 monit`. Los workers también escriben cada corrida en el registro de actividad.

## 8. Actualizar
```bash
cd /opt/facebook-factory && sudo -u ff BACKUP_BEFORE_DEPLOY=1 ./scripts/deploy.sh
```
Hace respaldo, `git pull --ff-only`, `npm ci`, `prisma migrate deploy`, build, `pm2 startOrReload` y verifica el health check.

## 9. Retención de datos (automática, diaria 03:30)
| Dato | Política |
|---|---|
| Temporales de render/subida | > 24 h se borran (y al iniciar el worker de render) |
| Caché de narraciones (TTS) | > `TTS_CACHE_RETENTION_DAYS` (30) |
| Registro de actividad | > `ACTIVITY_RETENTION_DAYS` (90) |
| Videos de contenidos publicados | `RENDER_RETENTION_DAYS` (0 = no se borran) |
| Al eliminar un contenido/página | se borran sus renders e imágenes |

## 10. Seguridad (lista de verificación)
- [ ] `.env` con permisos 600 y fuera de Git; secretos únicos y largos.
- [ ] Redis con contraseña, solo en loopback, `noeviction`. MySQL solo en loopback, usuario sin privilegios globales.
- [ ] HTTPS con HSTS (incluido en la configuración de Nginx); `AUTH_URL` en `https`.
- [ ] Firewall: solo 22, 80 y 443.
- [ ] `ADMIN_PASSWORD` eliminado del `.env` tras el seed.
- [ ] Meta: «Requerir prueba de secreto de la app» activado (ver `docs/META.md`).
- [ ] Respaldos fuera del servidor y restauración probada.
- [ ] `ENCRYPTION_KEY` respaldada por separado.

## 11. Dimensionamiento y problemas frecuentes
- Un Reel de 30 s se renderiza en ~15–60 s según CPU. Para más volumen: más núcleos o `RENDER_CONCURRENCY` (cada render usa varios hilos de FFmpeg). Recomendado ≥ 2 vCPU y 4 GB de RAM.
- **Un proceso aparece caído en «Automatización»**: `pm2 logs <nombre>`; PM2 reinicia solo hasta 20 veces seguidas.
- **«Meta rechazó la solicitud» / token vencido**: reconectá la página desde su detalle.
- **Rutas con espacios** rompen PM2 con scripts absolutos; instalá en una ruta sin espacios (por eso `/opt/facebook-factory`).
- **`next start` y `standalone`**: el proyecto usa `next start` (los workers necesitan el repositorio completo), no `output: standalone`.
