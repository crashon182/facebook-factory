# Tareas

## Fase 1 — Base del sistema ✅
- [x] Next.js 16 + TS strict + Tailwind + shadcn/ui
- [x] Prisma 7 + MySQL, esquema completo y migración `init`
- [x] Seed del administrador desde variables de entorno
- [x] Login privado (Auth.js), protección por proxy y `requireAdmin`
- [x] Layout premium: sidebar, responsive, tema claro/oscuro, toasts, skeletons, estados vacíos
- [x] Dashboard con datos reales de MySQL y gráficos
- [x] CRUD de páginas (lista con búsqueda/filtros/paginación, crear, editar, detalle, activar/desactivar, eliminar con confirmación)
- [x] Panel de automatización por página (reglas persistidas) + pausa global
- [x] Pantalla de estado de integraciones, health check `/api/health`
- [x] Tests: cifrado, validaciones, servicios contra MySQL (17)

### Pendiente menor de Fase 1
- [ ] Subida de imagen de perfil (hoy es una URL; requiere almacenamiento seguro de archivos, Fase 3)
- [ ] Pruebas E2E automatizadas dentro del repo (se hicieron manualmente con Playwright, fuera del proyecto)
- [ ] Reemplazar el rate limit en memoria por Redis (Fase 5)

## Fase 2 — IA ✅
- [x] Cliente OpenAI (salidas estructuradas + Zod), registro en `APIUsageLog`, presupuesto diario por página y tope global
- [x] «GENERAR ESTRATEGIA CON IA» (en el formulario y en el detalle), versiones, edición manual, restauración
- [x] Generador y editor de contenidos: estados, duplicar, regenerar, aprobar, cancelar, eliminar; escenas de Reels
- [x] Pantalla de uso y costos; tests (47 en total) y prueba E2E real con OpenAI

### Pendiente menor de Fase 2
- [ ] Mover la generación a workers/BullMQ (Fase 5); hoy se ejecuta dentro de la petición
- [ ] «Programar» contenidos (Fase 4); hoy se llega hasta «Aprobado»
- [ ] Editor visual de las listas complejas de la estrategia (hoy JSON validado)
- [ ] Uso de `ContentIdea` desde la UI (el generador ya lo soporta vía `ideaId`)

## Fase 3 — Multimedia y Reels ✅
- [x] `MediaProvider` + Pexels (filtros, caché, límites, autor/licencia, sin duplicados) y subida de archivos propios
- [x] Biblioteca multimedia, descargas anti-SSRF, servicio de archivos autenticado
- [x] Plantillas de imagen con frase (4) y panel en el editor
- [x] Motor de Reels FFmpeg + TTS + subtítulos + transiciones + miniatura, en worker BullMQ con progreso, logs, reintentos y cancelación
- [x] Tests (76 en total) y prueba E2E real (OpenAI + worker + FFmpeg)

### Pendiente / limitaciones de Fase 3
- [x] Proveedor Pixabay agregado (Pexels tiene la emisión de claves pausada)
- [ ] **Pexels y Pixabay no se probaron contra su API real hasta cargar la clave** (cubiertos con `fetch` simulado). Al cargarla, probar una búsqueda y una descarga; si algún dominio de descarga difiere, agregarlo en `MEDIA_EXTRA_ALLOWED_HOSTS`.
- [ ] Subtítulos por proporción (no por palabra); evaluar transcripción con marcas de tiempo si se necesita más precisión
- [ ] Voz y estilo de narración configurables desde la UI (hoy por entorno)
- [ ] Proveedores adicionales de TTS y de multimedia
- [ ] Gestión del worker con PM2 y monitoreo de la cola (Fase 5)

## Fase 4 — Meta y calendario (siguiente) · Fase 5 — Automatización · Fase 6 — Analíticas
- [ ] OAuth Meta, publicación con idempotencia/reconciliación, calendario (mes/semana/día/lista), programación
- [ ] Workers restantes + planificador sin duplicación, PM2, Nginx, backups MySQL, retención de temporales
- [ ] Métricas, informes semanales, optimización con experimentos reversibles

## Integraciones que requerirán credenciales
OpenAI (F2) · Pexels (F3) · TTS (F3) · Meta App con permisos y revisión de la app (F4).
