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

## Fase 4 — Meta y calendario ✅ (probado con Meta simulado)
- [x] Cliente Graph API (OAuth, tokens de larga duración, Páginas, texto/foto/Reels, estado, reconciliación), `appsecret_proof`, errores clasificados
- [x] Conexión de páginas, tokens cifrados, verificar/reconectar/desconectar
- [x] Programación (validaciones, reprogramar, cancelar, publicar ahora, reintentar, programación automática) y calendario mes/semana/día/lista con filtros
- [x] Worker de publicación con escáner BullMQ, reclamo atómico, reconciliación, reintentos con espera, recuperación de procesos caídos
- [x] Webhook con verificación de firma; documentación `docs/META.md`
- [x] Tests (136 en total) y E2E en navegador con worker real y Graph API simulado

### Pendiente / limitaciones de Fase 4
- [ ] **Nada se probó contra Meta real** (falta una app y una Página de prueba). Hacer una primera publicación de texto, luego foto y Reel; verificar `source` en fotos (ver docs/META.md §4)
- [ ] Panel de la cola/planificador y monitoreo (Fase 5); hoy se ve el historial por contenido
- [ ] Webhook: solo registra eventos; falta suscripción desde el panel de Meta
- [ ] Reanudar subidas de Reels interrumpidas (hoy queda un borrador huérfano en Meta)
- [ ] Vista del calendario con arrastrar y soltar

## Fase 5 — Automatización e infraestructura ✅
- [x] Motor de automatización por página (stock, frecuencia, formatos, días, presupuesto, aprobación, publicación automática) con bloqueo entre instancias
- [x] Workers independientes: generación, render, publicación y planificador (tareas periódicas idempotentes); latidos
- [x] Generación de ideas, preparación de medios (imagen con frase, foto, render del Reel), mantenimiento y retención
- [x] Pantalla de monitoreo (procesos, colas, fallidos con reintento, estado por página) y `/api/health` (`?strict=1`)
- [x] Rate limit en Redis; pausa global y por página respetadas por el motor y los workers
- [x] PM2 (`ecosystem.config.cjs`), Nginx (validado con `nginx -t`), `deploy.sh`, respaldo/restauración (probados), `monitor.sh`, `docs/DEPLOY.md`
- [x] Tests (161 en total) y E2E real: OpenAI + 5 procesos PM2 + navegador; caída de un worker (kill -9) recuperada por PM2

### Pendiente / limitaciones de Fase 5
- [ ] **El despliegue en un servidor real no se probó** (Nginx/certbot/UFW/systemd se validaron solo por sintaxis y en local). Seguir `docs/DEPLOY.md` en un servidor de prueba.
- [ ] La optimización automática de horarios (`autoOptimizeTimes`) se implementa con las analíticas (Fase 6)
- [ ] «Recopilar estadísticas» y «Analizar resultados» (colas) → Fase 6
- [ ] La generación manual con IA sigue ejecutándose dentro de la petición web (la automática ya corre en worker)
- [ ] Alertas: `monitor.sh` + webhook; falta integración con un sistema de métricas (Prometheus/Grafana) si se necesita

## Fase 6 — Analíticas y optimización ✅
- [x] Recopilación de métricas de Meta (Insights + reacciones/comentarios/compartidos) con snapshots históricos: cada 6 h, cadencia por antigüedad de la publicación (3 h / 12 h / 24 h), idempotente, tolerante a métricas retiradas (cada una se pide por separado; las no disponibles se registran)
- [x] Panel `/analiticas`: consolidado y por página (7/30/90 días), comparación con el período anterior, evolución, rendimiento por hora y por formato, publicaciones del período
- [x] Indicadores normalizados: índice = tasa de interacción / mediana de la página (comparable entre páginas y formatos); no se calcula con menos de 3 muestras
- [x] Informe semanal con IA (lunes 08:00 UTC o a demanda): usa solo los datos medidos, respeta el presupuesto diario de la página; las sugerencias de la IA quedan como propuestas
- [x] Experimentos reversibles de horario: mueve la franja ≤ 1 h por vez, conserva su ancho, dentro de 06:00–23:00, sin tocar máximo diario ni presupuesto; un solo experimento activo y enfriamiento de 7 días; con `autoOptimizeTimes` se aplica solo, si no requiere aprobación; a los 7 días se evalúa y se revierte si la interacción cae ≥ 15 % (o si faltan datos tras una prórroga)
- [x] Tests (185 en total)

### Pendiente / limitaciones de Fase 6
- [ ] **Nada se probó contra Meta real.** Los nombres de métricas (`page_media_view`, `page_total_media_view_unique`, `page_post_engagements`, `post_media_view`, `post_total_media_view_unique`) siguen la documentación vigente, pero Meta los viene cambiando; son configurables con `META_*_METRIC`. Al conectar una Página real, correr «Recopilar ahora» y revisar en el registro de actividad cuáles figuran como «no disponibles». Para Reels, verificar si hay que usar una métrica específica de reproducciones.
- [ ] Retención en el watch time y retención de video no se miden (columnas `watchTimeSec`/`retention` sin usar)
- [ ] El tamaño de muestra por hora es chico al principio: hasta tener ≥ 8 publicaciones medidas no se recomienda ningún horario
- [ ] La optimización solo actúa sobre la franja horaria; las demás sugerencias de la IA son manuales
- [ ] Los snapshots de métricas no tienen política de retención (crecen ~4 filas por publicación en sus primeros días)
- [ ] Informes por correo/mensajería

## Integraciones que requerirán credenciales
OpenAI (F2) · Pexels (F3) · TTS (F3) · Meta App con permisos y revisión de la app (F4).
