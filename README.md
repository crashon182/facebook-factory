# Facebook Factory

Plataforma privada (un único administrador) para gestionar varias páginas de Facebook, generar contenido con IA, programar publicaciones y analizar resultados. **Estado: Fases 1 a 4 completas** (base + IA + multimedia/Reels + Meta y calendario). Ver [TASKS.md](TASKS.md) y [ARCHITECTURE.md](ARCHITECTURE.md).

## Requisitos
- Node.js 24 (LTS activo) y npm
- MySQL 8 y Redis (para desarrollo: `docker compose up -d`)
- FFmpeg con libx264, aac, libass y drawtext (`sudo apt install ffmpeg fonts-dejavu-core`)

## Instalación en desarrollo
```bash
npm install                    # instala y ejecuta `prisma generate`
docker compose up -d           # MySQL 8.4 en 127.0.0.1:3317 y Redis en 127.0.0.1:6381
cp .env.example .env           # y completar los valores (ver abajo)
npx prisma migrate deploy      # aplica las migraciones (en desarrollo: npm run db:migrate)
npm run db:seed                # crea el administrador desde ADMIN_EMAIL / ADMIN_PASSWORD
npm run dev                    # http://localhost:3000
```

> El usuario `ff_user` de `docker-compose.yml` necesita permiso para crear la *shadow database* si usás `prisma migrate dev`:
> `docker exec ff-mysql mysql -uroot -p<root> -e "GRANT ALL ON *.* TO 'ff_user'@'%'; FLUSH PRIVILEGES;"` (solo desarrollo; en producción usá `migrate deploy` con un usuario acotado).

### Variables de entorno (`.env`)
| Variable | Obligatoria | Descripción |
|---|---|---|
| `DATABASE_URL` | sí | Cadena de conexión MySQL |
| `AUTH_SECRET` | sí | `openssl rand -base64 32` |
| `AUTH_URL`, `AUTH_TRUST_HOST` | sí | URL pública de la app |
| `ENCRYPTION_KEY` | sí | 32 bytes en base64 (`openssl rand -base64 32`); cifra los tokens de Meta (AES-256-GCM) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | para el seed | La contraseña debe tener ≥ 12 caracteres |
| `REDIS_URL` | Fase 5 | Colas BullMQ |
| `OPENAI_API_KEY` | Fase 2 | Estrategias y contenido |
| `OPENAI_MODEL` | no | Modelo a usar (por defecto `gpt-5.4-mini`) |
| `OPENAI_PRICE_INPUT_PER_1M`, `OPENAI_PRICE_OUTPUT_PER_1M` | recomendadas | USD por millón de tokens del modelo elegido. **No se asumen precios**: sin ellos solo se cuentan tokens y el costo figura en 0 |
| `OPENAI_DAILY_LIMIT_USD` | no | Tope global diario; el presupuesto por página se configura en su panel de automatización |
| `PEXELS_API_KEY`, `PIXABAY_API_KEY` | Fase 3 | Búsqueda de fotos y videos (cualquiera de las dos; sin ellas se pueden subir archivos propios). Pexels ha pausado la emisión de claves nuevas |
| `TTS_PROVIDER`, `TTS_MODEL`, `TTS_VOICE` | no | Narración. Por defecto `openai` (reutiliza `OPENAI_API_KEY`, modelo `gpt-4o-mini-tts`) |
| `MEDIA_PROVIDER`, `MEDIA_EXTRA_ALLOWED_HOSTS` | no | Proveedor activo y hosts extra permitidos para descargas |
| `STORAGE_DIR`, `FFMPEG_PATH`, `FONT_DIR`, `RENDER_CONCURRENCY` | no | Ver `.env.example` |
| `META_APP_ID`, `META_APP_SECRET` | Fase 4 | OAuth y publicación (ver `docs/META.md`) |
| `META_GRAPH_VERSION`, `META_SCOPES`, `META_WEBHOOK_VERIFY_TOKEN` | no | Versión (por defecto `v27.0`), permisos y verificación del webhook |

Sin las claves de integración, el sistema funciona y muestra esas integraciones como **«No configuradas»** en *Configuración*. Nada se simula.

## Scripts
| Comando | Acción |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run worker:render` | **Worker de renderizado de Reels** (proceso aparte; necesita Redis) |
| `npm run worker:publish` | **Worker de publicación en Facebook** + escáner de vencimientos (proceso aparte; necesita Redis) |
| `npm run typecheck` · `lint` · `test` | Verificaciones |
| `npm run verify` | typecheck + lint + tests + build |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:studio` | Prisma |

Los tests de integración usan la base de datos real de `DATABASE_URL` (solo crean/borran registros con prefijo `TEST_ff_`).

## Producción
`output: "standalone"` está activo (`node .next/standalone/server.js`). Los archivos de PM2, Nginx, backups y scripts de despliegue se entregan junto a los workers (Fase 5); ver TASKS.md. Health check: `GET /api/health`.

## Seguridad (Fase 1)
- Auth.js (credenciales, JWT de 12 h) + `proxy.ts` que protege todas las rutas, y `requireAdmin()` en cada acción de servidor.
- Contraseñas con bcrypt (coste 12); límite de 5 intentos / 15 min por correo; comparación en tiempo constante.
- Validación con Zod en todas las entradas; URLs limitadas a http/https.
- Tokens de Meta: columna `accessTokenEnc`, cifrado AES-256-GCM (`src/lib/crypto.ts`).

## IA (Fase 2)
- Salidas estructuradas con la Responses API de OpenAI + Zod (`src/lib/integrations/openai/client.ts`). Cada llamada (éxito o error) se registra en `APIUsageLog` con tokens y costo estimado; las claves nunca se registran.
- **Control de costos:** antes de cada llamada se comprueba el presupuesto diario de la página (`AutomationRule.dailyBudgetUsd`) y el tope global opcional. Límite de 6 estrategias / 10 contenidos por minuto.
- **Estrategias:** versionadas en `PageStrategy` (generar, editar a mano, restaurar; el historial nunca se reescribe). Al guardar una versión se sincronizan categorías (`ContentPillar`) e ideas (`ContentIdea`).
- **Contenidos:** generar (texto, imagen, imagen con frase, Reel con escenas, reflexión, educativo, inspiracional, historia), editar, duplicar, regenerar, aprobar, cancelar, eliminar. La IA recibe la estrategia, las restricciones editoriales y los últimos 25 contenidos; se detectan duplicados por hash.
- La generación corre dentro de la petición del servidor (decenas de segundos). En la Fase 5 pasa a workers.

## Multimedia y Reels (Fase 3)
- **Proveedor intercambiable:** `MediaProvider` (`src/lib/integrations/media`). Hoy Pexels y Pixabay (selector en Multimedia; `MEDIA_PROVIDER` fija el que usan los Reels); para sumar otro basta implementar la interfaz y registrarlo. Además se pueden **subir archivos propios** (licencia obligatoria; el tipo se valida con ffprobe).
- **Pexels:** API oficial, filtros de orientación y calidad, caché de 10 min (Redis, con respaldo en memoria), manejo de 429/401/errores, autor y licencia guardados en `MediaAsset`, sin descargas duplicadas (por id y por checksum).
- **Descargas seguras (anti-SSRF):** solo https, solo hosts permitidos, IP pública verificada al conectar, redirecciones revalidadas, límite de tamaño/tiempo (`src/lib/net/safe-fetch.ts`).
- **Archivos:** se guardan en `STORAGE_DIR` (fuera de `public/`) y se sirven solo a administradores por `/api/files/...` (con Range para el reproductor).
- **Imágenes con frase:** 4 plantillas (clásico oscuro, claro, degradado de marca, foto con velo) en cuadrado o vertical, generadas con FFmpeg.
- **Reels:** la petición solo encola (BullMQ); el worker hace narración (TTS con caché) → línea de tiempo → clips por escena → subtítulos ASS → composición con transiciones → verificación 1080×1920 H.264/AAC → miniatura. Progreso, logs, 3 reintentos con backoff, cancelación y limpieza de temporales.
- **Música:** nunca se agrega sola; solo si elegís una pista que subiste con licencia registrada.
- **Sin clip de proveedor** (no configurado o sin resultados) la escena usa un fondo generado con los colores de la página, y queda registrado en el log.
- Los subtítulos se sincronizan **por proporción** dentro de la ventana de audio de cada escena (el TTS no entrega marcas por palabra).
- Producción: instalar `ffmpeg` y `fonts-dejavu-core`, y mantener `npm run worker:render` corriendo (PM2 en la Fase 5).
- **Pixabay:** API oficial (`/api/` y `/api/videos/`), consultas cacheadas 24 h (lo exigen sus términos), 100 pedidos/60 s con manejo de 429, atribución visible junto a los resultados, descarga a nuestro almacenamiento (no se enlazan sus URLs de forma permanente). Fotos hasta 1280 px (el original y Full HD requieren acceso ampliado de Pixabay). Los videos no tienen filtro de orientación en su API: se filtra del lado del servidor.

## Meta y calendario (Fase 4)
Guía completa de configuración, permisos, limitaciones y garantías en **[docs/META.md](docs/META.md)**.
- **Conexión:** botón *Conectar con Facebook* en cada página (OAuth con `state` firmado, token de larga duración, selección de la Página, token **cifrado**). Verificar / reconectar / desconectar.
- **Programación:** desde el editor, el calendario (mes, semana, día y lista, con filtros por página, tipo y estado) o *Programar automáticamente* según la estrategia y las reglas de la página. Reprogramar, cancelar, publicar ahora, reintentar y ver el historial de intentos.
- **Publicación:** texto, imágenes y Reels. Idempotencia por reclamo atómico + intento registrado + reconciliación con Meta (nunca se reintenta a ciegas).
- **Zonas horarias:** todo se guarda en UTC; se muestra y se ingresa en la zona de cada página.
- **Webhook** `/api/webhooks/meta` con verificación de firma `X-Hub-Signature-256`.
- **Producción:** mantener corriendo `worker:render` y `worker:publish`. Sin `worker:publish` lo programado queda esperando.
