// Selección automática de la foto de fondo: consultas de búsqueda y elección del candidato. Funciones puras (testeables sin red).

export const FALLBACK_BACKGROUND_QUERY = "nature landscape sky";

/** Consultas a probar, de más a menos específica: palabras clave del contenido, tema del contenido, tema de la página y un genérico. */
export function backgroundQueries(o: { imageKeywords?: unknown; topic?: string | null; pageTopic?: string | null }): string[] {
  const kws = Array.isArray(o.imageKeywords) ? (o.imageKeywords as unknown[]).filter((k): k is string => typeof k === "string" && !!k.trim()).map((k) => k.trim()) : [];
  const raw = [kws.slice(0, 3).join(" "), kws[0], o.topic?.trim(), o.pageTopic?.trim(), FALLBACK_BACKGROUND_QUERY];
  const seen = new Set<string>();
  return raw
    .map((q) => (q ?? "").slice(0, 100).trim())
    .filter((q) => q.length >= 2 && !seen.has(q.toLowerCase()) && !!seen.add(q.toLowerCase()));
}

/** Elige un candidato al azar entre los de resolución suficiente, prefiriendo los que todavía no están en la biblioteca (más variedad). */
export function chooseCandidate<T extends { externalId: string; width: number }>(items: T[], known: ReadonlySet<string>, rnd: () => number = Math.random, minWidth = 1000): T | null {
  if (!items.length) return null;
  const sharp = items.filter((c) => c.width >= minWidth);
  const pool = sharp.length ? sharp : items;
  const fresh = pool.filter((c) => !known.has(c.externalId));
  const from = fresh.length ? fresh : pool;
  return from[Math.min(from.length - 1, Math.floor(rnd() * from.length))];
}
