# Arquitectura y decisiones

## Stack real instalado (verificado el 2026-11-06)
Next.js 16.4.5 (App Router, Turbopack) · React 19.3 · TypeScript strict · Tailwind 4 · shadcn/ui (new-york) · Prisma **7.10.1** + `@prisma/adapter-mariadb` · MySQL 8 · Auth.js `next-auth@5.0.0-beta.32` · Zod 4 · React Hook Form · Recharts 3 · Vitest 5.

## Decisiones
1. **Prisma 7.10.1 (estable), no 8.0.0-rc.** El tag `latest` de npm apunta a un release candidate; se fijó la última 7.x estable. Prisma 7 exige *driver adapter* (`PrismaMariaDb`) y `prisma.config.ts`; el cliente se genera en `src/generated/prisma` (ignorado por git, se regenera en `postinstall`).
2. **Auth.js v5 sigue en beta**; es la única línea que soporta App Router. Configuración dividida: `auth.config.ts` (sin Prisma/bcrypt, usada por el proxy) y `auth.ts` (Credentials + bcrypt).
3. **`proxy.ts`** reemplaza a `middleware.ts` en Next 16. Además de proteger rutas, cada acción/página vuelve a verificar con `requireAdmin()` (el proxy no es la única barrera).
4. **`cacheComponents` desactivado.** La app es privada y 100 % dinámica por sesión; activarlo obligaría a envolver cada lectura de sesión en Suspense sin beneficio. Se puede reactivar por ruta más adelante.
5. **Esquema completo desde la Fase 1** (19 modelos pedidos) en una única migración `init`, para no reescribir en fases posteriores. Fechas en UTC; zona horaria por página en `SocialPage.timezone`.
6. **Tokens cifrados** con AES-256-GCM (`v1:iv:tag:data`) y clave en `ENCRYPTION_KEY`. Nunca se guardan ni se registran en claro.
7. **Idempotencia de publicación (diseño ya reflejado en el esquema):** `PublicationSchedule.idempotencyKey` único + `PublicationAttempt(scheduleId, attemptNo)` único.
8. **Pausa global** = `SystemSetting["automations.paused"]`; los workers (Fase 5) deberán consultarla antes de cada tarea. En Fase 1 solo se persiste y se muestra.
9. **Rate limit** del login en memoria (válido para una instancia); pasa a Redis en la Fase 5.
10. **Sin datos simulados:** el dashboard lee MySQL; los estados vacíos lo indican. Los módulos de fases futuras muestran «Se implementa en la Fase N».

## Estructura
```
src/app/(auth)/login        Login
src/app/(app)/…             Rutas protegidas (layout con sidebar + requireAdmin)
src/components/ui           shadcn/ui
src/components/{layout,dashboard,shared}
src/lib/auth                Auth.js, requireAdmin
src/lib/services            Lógica de negocio (pages, dashboard, settings, activity)
src/lib/integrations        Estado de integraciones (aquí irán los proveedores: OpenAI, MediaProvider, Meta, TTS)
src/lib/validation          Esquemas Zod
prisma/                     schema, migraciones, seed
tests/                      Vitest (unitarios + integración con MySQL)
```
Regla: las rutas/acciones solo validan y delegan en `lib/services`; los servicios acceden a datos vía Prisma.

## Decisiones de la Fase 2
11. **Responses API + `zodTextFormat`** (SDK `openai` 7.53). Los esquemas enviados a la IA son *strict-compatibles* (todos los campos obligatorios, sin refinamientos); las reglas de negocio extra se validan después (`checkStrategy`) y nada se guarda si fallan.
12. **Sin precios inventados:** los precios por modelo se configuran por entorno; sin ellos el costo es 0 y la pantalla Configuración lo indica.
13. **Versionado inmutable de estrategias:** editar o restaurar crea una versión nueva; solo una está ACTIVE.
14. **Máquina de estados de contenido** en `content-status.ts` (pura y testeada). Solo se edita/regenera/borra en DRAFT, READY, FAILED o CANCELLED. Programar y publicar quedan para la Fase 4.
15. **Anti-repetición:** hash normalizado del texto + hasta 2 intentos; si la IA repite dos veces el contenido queda FAILED con el motivo.
16. **Errores de IA** se traducen a mensajes claros (401 clave, 404 modelo, 429 cuota) y quedan en `ContentPost.failureReason`.

## Decisiones de la Fase 3
17. **Cola BullMQ desde ya para los renders** (Redis ya es parte del stack). `jobId` determinista = encolar dos veces no duplica; el estado visible vive en `VideoRenderJob` (progreso, etapa, logs), no solo en Redis.
18. **Worker = proceso Node aparte** (`tsx --conditions=react-server`, para que `server-only` no falle fuera de Next). Comparte servicios con la app.
19. **FFmpeg sin shell** (`spawn` con argumentos) y textos por archivo (`textfile`), nunca interpolados en filtros.
20. **Transiciones:** segmentos de escena con solape `FADE_SEC` y `xfade`; el audio se alinea con `apad`/`concat` para que video y voz duren lo mismo.
21. **Duración objetivo:** si la narración excede >10%, se acelera hasta 1.3x; si aun así excede, se avisa en el log (no se recorta el guion en silencio).
22. **Sin proveedor de música:** solo pistas subidas con licencia; el sistema no incluye ni descarga música.
23. **Limpieza:** temporales >24 h se borran al iniciar el worker y cada hora; al eliminar un contenido o página se borran sus renders e imágenes.
24. **Constantes puras separadas** (`image-templates-meta.ts`) para poder importarlas desde componentes de cliente sin arrastrar `node:fs`.

## Decisiones de la Fase 4
25. **Idempotencia sin soporte de Meta:** reclamo atómico en BD (`SCHEDULED→PUBLISHING`), intento registrado *antes* de llamar, reconciliación obligatoria de intentos sin cerrar, y reintentos directos solo ante errores definitivos (4xx). Un 5xx/timeout es ambiguo → `RECONCILING`.
26. **Planificador sin duplicación:** el escáner de vencimientos es un *job scheduler* de BullMQ (`upsertJobScheduler` con id fijo): una sola definición aunque haya varias instancias. La garantía real sigue siendo el reclamo atómico.
27. **Clasificación de errores de Meta** (`errors.ts`) según la documentación: 190/102 → token (página *Token vencido*, sin reintento); 4/17/32/341/613/368 → límite (espera larga); 1/2 → temporal; 506 → duplicado; 10/200–299 → permisos; 1363xxx/100 → inválido.
28. **Tokens:** OAuth con `state` aleatorio + cookie firmada (HMAC) y vencimiento de 10 min; las Páginas obtenidas se guardan cifradas en `SystemSetting` hasta 15 min; el token elegido se guarda cifrado en `SocialPage`. `appsecret_proof` en todas las llamadas.
29. **Zonas horarias sin dependencias** (`src/lib/time/tz.ts`, `Intl`): hora local↔UTC con DST, claves de día, rangos de calendario. El calendario se muestra en la zona de la página filtrada (o de la primera página).
30. **Planificador automático puro** (`scheduling/plan.ts`): usa las hipótesis de horario de la estrategia dentro de la franja de la página, respeta días permitidos y máximo diario. Todo lo que la IA propone pasa por las mismas validaciones que una programación manual.
31. **Límites propios antes de llamar a Meta:** máx. diario por página (superable solo con confirmación), 30 Reels/24 h, aprobación obligatoria según la regla de la página, medios presentes.
32. **Bases de API sobrescribibles solo fuera de producción** (`META_GRAPH_BASE_URL`) para probar el worker contra un Graph simulado.
