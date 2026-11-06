# Integración con Meta (Facebook)

Verificado contra la documentación oficial el 2026-11-06. La versión de Graph API es configurable (`META_GRAPH_VERSION`, por defecto `v27.0`, la más reciente según el *changelog*). Cada versión funciona al menos 2 años; revisá https://developers.facebook.com/docs/graph-api/changelog/ periódicamente.

> **Estado de las pruebas:** el cliente, el flujo OAuth, el publicador y el webhook están cubiertos por pruebas automáticas con Meta **simulado**. No se probaron contra la API real porque requieren una app de Meta y una Página propias. La primera publicación real conviene hacerla con una Página de prueba.

## 1. Crear la app de Meta
1. En https://developers.facebook.com → *Mis apps* → *Crear app* (tipo **Empresa**/Business).
2. Agregá el producto **Inicio de sesión con Facebook para empresas** (Facebook Login).
3. *Facebook Login → Configuración → URI de redirección de OAuth válidos*: agregá exactamente
   `https://TU-DOMINIO/api/meta/oauth/callback` (en desarrollo `http://localhost:3000/api/meta/oauth/callback`; la pantalla *Conectar con Facebook* de cada página te la muestra).
4. *Configuración de la app → Básica*: copiá **ID de la app** y **Clave secreta** a `META_APP_ID` y `META_APP_SECRET`.
5. Reiniciá la aplicación.

## 2. Permisos que solicita el sistema
| Permiso | Para qué |
|---|---|
| `pages_show_list` | Listar las Páginas que administrás |
| `pages_manage_posts` | Publicar texto, fotos y Reels |
| `pages_read_engagement` | Leer publicaciones/estado de la Página (y reconciliar) |
| `read_insights` | Métricas (Fase 6) |

Tu usuario debe tener en la Página la tarea **CREATE_CONTENT** (rol de Editor o superior). El sistema lo verifica al conectar.

### Revisión de la app (App Review)
- Mientras la app esté en **modo Desarrollo**, solo funciona con usuarios que tengan rol en la app (administradores, desarrolladores, testers) y sobre Páginas que ellos administren. Para un único administrador suele alcanzar con esto.
- Para uso con permisos avanzados sobre datos que no gestionás vos, Meta exige *App Review* y, para acceso avanzado, *Business Verification*. Para tu caso (un administrador, sus propias Páginas) normalmente no hace falta; confirmalo en https://developers.facebook.com/docs/permissions.
- Un permiso que la app no usa durante 90 días debe volver a concederse.

## 3. Qué endpoints usa
| Acción | Endpoint |
|---|---|
| OAuth | `https://www.facebook.com/{v}/dialog/oauth` y `GET /oauth/access_token` |
| Token de larga duración | `GET /oauth/access_token?grant_type=fb_exchange_token` |
| Páginas y tokens de Página | `GET /me/accounts?fields=id,name,category,access_token,tasks` |
| Verificar conexión | `GET /{page-id}?fields=id,name` |
| Texto | `POST /{page-id}/feed` |
| Foto | `POST /{page-id}/photos` (archivo subido como `source`) |
| Reel | `POST /{page-id}/video_reels` (`start` → subida a `rupload.facebook.com` → `finish`) y `GET /{video-id}?fields=status` |
| Reconciliación | `GET /{page-id}/feed?fields=id,message,created_time` |

Todas las llamadas llevan `access_token` y `appsecret_proof` (HMAC-SHA256 del token con el *app secret*). Recomendado: activá *Requerir prueba de secreto de la app* en *Configuración → Avanzada*.

**Tokens:** el token de Página obtenido de un token de usuario de larga duración no vence por tiempo, pero se invalida si cambia la contraseña, se revocan permisos o se pierde el rol. El sistema guarda el token **cifrado (AES-256-GCM)**, nunca lo registra y, ante un error 190/102, marca la Página como *Token vencido* y pide reconectar.

## 4. Limitaciones a tener en cuenta
- **Reels:** hasta **30 Reels publicados por API cada 24 h por Página** (el sistema lo valida al programar). Video 9:16, 3–90 s, MP4, mínimo 540×960 (los renders del sistema son 1080×1920, H.264/AAC).
- **Fotos:** la documentación pública de *Pages API → posts* describe `url`; el sistema sube el archivo local con `source` (multipart), que es lo que permite publicar imágenes generadas localmente. Si Meta lo rechazara para tu app, publicá desde una URL pública.
- **Reconciliación:** Meta no ofrece claves de idempotencia. Por eso un resultado ambiguo (timeout/5xx) nunca se reintenta a ciegas: se consulta primero a Meta. La reconciliación de texto/foto compara el texto publicado y la hora de creación contra los últimos 25 posts de la Página.
- **Estadísticas:** se implementan en la Fase 6; los nombres de métricas de Insights deben revisarse contra la documentación vigente (la página de referencia no pudo leerse automáticamente).
- Los Reels quedan como borrador huérfano en Meta si el sistema se cae entre `start` y `finish` (no se reanudan subidas).

## 5. Garantías contra publicaciones duplicadas
1. **Reclamo atómico** en la base de datos (`SCHEDULED → PUBLISHING` con `UPDATE` condicional): aunque haya varios workers o se pulse «Publicar ahora» dos veces, solo uno publica.
2. **Intento registrado antes de llamar a Meta** (`PublicationAttempt`, número de intento único por programación).
3. **Reconciliación obligatoria** de cualquier intento sin cerrar (caída del worker, timeout, 5xx) antes de reintentar.
4. Solo los errores *definitivos* de Meta (respuesta de error 4xx) habilitan un reintento directo; hasta 4 intentos con espera creciente (los errores de límite de uso esperan más).
5. Un `PUBLISHING` colgado más de 15 min se recupera automáticamente y se reconcilia.
6. Si no se puede confirmar en 24 h si algo se publicó, el contenido falla y pide revisión manual en Facebook.

## 6. Webhook (opcional)
- URL de devolución de llamada: `https://TU-DOMINIO/api/webhooks/meta`; token de verificación: el valor de `META_WEBHOOK_VERIFY_TOKEN`.
- Cada evento se valida con la firma `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el *app secret*) antes de procesarse; hoy solo se registra en la actividad. Requiere HTTPS con certificado válido.

## 7. Operación
- Proceso aparte: `npm run worker:publish` (escanea vencimientos cada 30 s con un *job scheduler* de BullMQ —una sola definición aunque haya varias instancias— y publica con concurrencia `PUBLISH_CONCURRENCY`, 2 por defecto).
- La **pausa global** de automatizaciones detiene la publicación (lo programado queda esperando, sin consumir intentos).
- Los horarios se guardan en UTC; el calendario y los formularios usan la zona horaria de cada página.
