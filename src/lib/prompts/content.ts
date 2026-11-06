import type { AutomationRule, SocialPage } from "@/generated/prisma/client";
import type { Strategy } from "@/lib/validation/strategy";

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
