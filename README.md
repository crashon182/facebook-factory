# Facebook Factory

Plataforma privada (un único administrador) para gestionar varias páginas de Facebook, generar contenido con IA, programar publicaciones y analizar resultados. **Estado: Fases 1 y 2 completas** (base del sistema + IA). Ver [TASKS.md](TASKS.md) y [ARCHITECTURE.md](ARCHITECTURE.md).

## Requisitos
- Node.js 24 (LTS activo) y npm
- MySQL 8 y Redis (para desarrollo: `docker compose up -d`)
- FFmpeg (se usa desde la Fase 3)

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
| `PEXELS_API_KEY` | Fase 3 | Imágenes y video |
| `TTS_PROVIDER`, `TTS_API_KEY` | Fase 3 | Narración de Reels |
| `META_APP_ID`, `META_APP_SECRET`, `META_GRAPH_VERSION` | Fase 4 | OAuth y publicación |

Sin las claves de integración, el sistema funciona y muestra esas integraciones como **«No configuradas»** en *Configuración*. Nada se simula.

## Scripts
| Comando | Acción |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
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
