import type { SocialPage } from "@/generated/prisma/client";
import { FORMAT_LABELS } from "@/lib/constants";

const LANG: Record<string, string> = { es: "español", en: "inglés", pt: "portugués", fr: "francés", it: "italiano", de: "alemán" };

export function buildStrategyPrompt(page: SocialPage, previous?: unknown) {
  const system = [
    "Sos un estratega editorial senior de redes sociales especializado en páginas de Facebook.",
    "Devolvés una estrategia editorial estructurada, concreta y accionable.",
    `Escribí todo el contenido en ${LANG[page.language] ?? page.language}.`,
    "Reglas estrictas:",
    "- No prometas ni insinúes viralidad ni crecimiento garantizado. Los horarios y objetivos son HIPÓTESIS a validar con datos; decilo en `caveats` y en los rationale.",
    "- No inventes estadísticas ni fuentes. No atribuyas citas a personas salvo que sean reales y verificables.",
    "- Proponé interacción genuina (preguntas reales, invitaciones a compartir experiencias); nada de engagement bait, ni 'etiquetá a 3 amigos', ni clickbait engañoso.",
    "- Las categorías tienen `weight` entero de 1 a 10 (importancia relativa).",
    "- `timeLocal` en formato HH:MM en la zona horaria de la página. `weekday` y `days` usan MON,TUE,WED,THU,FRI,SAT,SUN.",
    "- Formatos permitidos: " + Object.keys(FORMAT_LABELS).join(", ") + ".",
    "- Entregá 4 a 8 categorías, 10 a 15 ideas iniciales variadas, un calendario semanal de 5 a 7 entradas y 3 a 6 objetivos medibles realistas.",
    "- Las reglas de repetición deben ser verificables (ej. no repetir el mismo versículo/dato en 60 días).",
  ].join("\n");

  const user = [
    "Datos de la página:",
    `Nombre: ${page.name}`,
    `Descripción: ${page.description}`,
    `Temática: ${page.topic}`,
    `Público objetivo declarado: ${page.targetAudience ?? "(no definido)"}`,
    `Tono declarado: ${page.tone ?? "(no definido)"}`,
    `País objetivo: ${page.targetCountry ?? "(no definido)"}`,
    `Zona horaria: ${page.timezone}`,
    `Objetivos de crecimiento: ${page.growthGoals ?? "(no definidos)"}`,
    `Identidad visual: ${page.visualIdentity ?? "(no definida)"}`,
    previous ? `\nEstrategia anterior (mejorala, no la copies):\n${JSON.stringify(previous)}` : "",
  ].join("\n");

  return { system, user };
}
