import type { AutomationRule, SocialPage } from "@/generated/prisma/client";
import type { Strategy } from "@/lib/validation/strategy";
import { bibleVersion } from "@/lib/bible";

const LANG: Record<string, string> = { es: "español", en: "inglés", pt: "portugués", fr: "francés", it: "italiano", de: "alemán" };

const FORMAT_GUIDE: Record<string, string> = {
  TEXT: "Publicación de solo texto, 40–150 palabras, con gancho inicial claro. `scenes` vacío, `script` null, `imageText` null.",
  IMAGE: "Publicación con imagen: `body` es el texto del post; `imageKeywords` (3–6, en inglés) describen la foto ideal. `scenes` vacío, `script` null.",
  QUOTE_IMAGE: "Imagen con frase: `imageText` es la frase corta (máx. 25 palabras) que irá sobre la imagen; `body` el texto del post; `imageKeywords` (en inglés) para el fondo. `scenes` vacío.",
  REEL: "Reel vertical de 15–45 s: `script` es el guion narrado completo; `scenes` lo divide en 4–8 escenas con `narration` (lo que se dice) y `visualKeywords` (2–4 palabras clave en inglés para buscar clips). `body` es un resumen breve.",
  REFLECTION: "Reflexión profunda y personal, 80–200 palabras. `scenes` vacío, `script` null.",
  EDUCATIONAL: "Contenido educativo: dato o enseñanza útil y verificable, claro y estructurado, 80–180 palabras. `scenes` vacío.",
  INSPIRATIONAL: "Contenido inspiracional breve y emotivo, 40–120 palabras. `scenes` vacío.",
  SHORT_STORY: "Historia corta con inicio, giro y cierre, 120–250 palabras. `scenes` vacío.",
};

/** Reglas cuando la página incluye un versículo bíblico en cada contenido. */
function verseRules(format: string): string[] {
  const rules = [
    "Esta página incluye un versículo bíblico en CADA contenido:",
    `- Elegí UN versículo (o un pasaje de hasta 2 versículos seguidos) y hacé que el contenido gire en torno a él.`,
    `- \`verseReference\`: libro capítulo:versículo, p. ej. «Filipenses 4:6-7». \`verseText\`: el texto EXACTO en la versión ${bibleVersion()}, palabra por palabra, sin parafrasear, sin mezclar versiones y sin comillas ni la cita dentro.`,
    "- Si no estás seguro del texto exacto de un versículo, elegí otro que conozcas con certeza. Nunca inventes ni adaptes un versículo.",
    "- `facebookCaption` debe terminar con la referencia del versículo.",
  ];
  if (format === "QUOTE_IMAGE") rules.push("- Para este formato, `imageText` debe ser exactamente `verseText` (sin la referencia). La reflexión va en `body` y `facebookCaption`, no en la imagen.");
  if (format === "REEL") rules.push("- Reel: el sistema agrega al final una escena que lee el versículo y su cita; no la incluyas vos en `scenes` ni repitas el versículo completo en la última escena. El guion debe conducir naturalmente hacia ese versículo.");
  return rules;
}

export function buildContentPrompt(opts: {
  page: SocialPage;
  strategy: Strategy | null;
  format: string;
  topic?: string;
  ideaSummary?: string;
  recent: { internalTitle: string; topic: string | null }[];
  rule: AutomationRule | null;
}) {
  const { page, strategy, format, topic, ideaSummary, recent, rule } = opts;
  const system = [
    "Sos un redactor y guionista experto en contenido para páginas de Facebook.",
    `Escribí en ${LANG[page.language] ?? page.language}, con el tono de la página.`,
    "Reglas estrictas:",
    "- No inventes citas, cifras, estudios ni hechos. Si mencionás una cita o dato, que sea real y verificable; ante la duda, no lo atribuyas.",
    "- No uses engagement bait ni clickbait engañoso. Invitá a interactuar solo con preguntas genuinas y relevantes.",
    "- No uses marcas, personas reales ni material con derechos de autor como parte del mensaje, salvo citas breves atribuidas con verdad.",
    "- Evitá repetir temas, ángulos o frases de los contenidos recientes listados.",
    "- `facebookCaption` es el texto final listo para publicar en Facebook (puede incluir saltos de línea y hasta 2 emojis).",
    "- `hashtags`: 3–6 relevantes, sin el símbolo #.",
    "- `internalTitle`: título interno breve (máx. 80 caracteres). `topic`: tema en pocas palabras.",
    `Formato solicitado (${format}): ${FORMAT_GUIDE[format] ?? ""}`,
    ...(page.bibleVerses ? verseRules(format) : ["- `verseReference` y `verseText` van en null."]),
  ].join("\n");

  const user = [
    `Página: ${page.name} — ${page.topic}`,
    `Descripción: ${page.description}`,
    `Público: ${strategy?.targetAudience ?? page.targetAudience ?? "(no definido)"}`,
    `Tono: ${strategy?.tone ?? page.tone ?? "(no definido)"}`,
    strategy ? `Categorías: ${strategy.categories.map((c) => c.name).join("; ")}` : "",
    strategy ? `Estilo visual: ${strategy.visualStyle}` : "",
    strategy?.repetitionRules.length ? `Reglas anti-repetición:\n- ${strategy.repetitionRules.join("\n- ")}` : "",
    rule?.editorialRestrictions ? `Restricciones editoriales (obligatorias): ${rule.editorialRestrictions}` : "",
    topic ? `Tema pedido: ${topic}` : ideaSummary ? `Idea a desarrollar: ${ideaSummary}` : "Elegí un tema adecuado a la estrategia y distinto de los recientes.",
    recent.length ? `Contenidos recientes (no repetir):\n${recent.map((r) => `- ${r.internalTitle}${r.topic ? ` (${r.topic})` : ""}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  return { system, user };
}

export function buildIdeasPrompt(opts: {
  page: SocialPage;
  strategy: Strategy | null;
  count: number;
  formats: string[];
  recentTitles: string[];
  rule: AutomationRule | null;
}) {
  const { page, strategy, count, formats, recentTitles, rule } = opts;
  const system = [
    "Sos un estratega editorial de redes sociales. Proponés ideas de publicaciones concretas, variadas y originales para una página de Facebook.",
    `Escribí en ${LANG[page.language] ?? page.language}.`,
    `Devolvé exactamente ${count} ideas. Cada una con título corto, resumen de 1–2 frases, formato y categoría.`,
    `Formatos permitidos (usá solo estos): ${formats.join(", ")}.`,
    "Reglas: no inventes datos, citas ni estadísticas; sin engagement bait ni clickbait; variá ángulos y categorías; no repitas ideas ya usadas.",
    "`category` debe ser uno de los nombres de categoría de la estrategia (si hay).",
  ].join("\n");
  const user = [
    `Página: ${page.name} — ${page.topic}`,
    `Descripción: ${page.description}`,
    strategy ? `Categorías: ${strategy.categories.map((c) => c.name).join("; ")}` : "",
    strategy ? `Tono: ${strategy.tone}` : "",
    rule?.editorialRestrictions ? `Restricciones editoriales (obligatorias): ${rule.editorialRestrictions}` : "",
    recentTitles.length ? `Ideas y contenidos ya usados (no repetir):\n${recentTitles.map((t) => `- ${t}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
  return { system, user };
}
