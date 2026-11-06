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
