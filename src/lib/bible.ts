// Versículos bíblicos en los contenidos: versión usada, narración de cierre de los Reels y escena final.
// Sin dependencias de servidor (se usa en el prompt, en la generación y en los tests).

export const DEFAULT_BIBLE_VERSION = "Reina-Valera 1960";

/** Versión bíblica que debe citar la IA (BIBLE_VERSION). Ojo: varias versiones modernas tienen derechos de autor. */
export function bibleVersion(env: NodeJS.ProcessEnv = process.env): string {
  return env.BIBLE_VERSION?.trim() || DEFAULT_BIBLE_VERSION;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");
const stripEnd = (s: string) => s.trim().replace(/[\s.,;:!?¡¿"'«»”“]+$/u, "").replace(/^[\s"'«»”“]+/u, "");

/** Texto que se narra (y se subtitula) en la escena final: el versículo y su cita. */
export function verseNarration(reference: string, text: string): string {
  return `${stripEnd(text)}. ${stripEnd(reference)}.`;
}

export type SceneDraft = { narration: string; visualKeywords: string[] };

/**
 * Garantiza que el Reel termine con el versículo: si la última escena ya lo dice, solo se asegura de que lleve la cita;
 * si no, se agrega una escena final con el versículo y su cita (reutiliza las palabras clave visuales de la anterior).
 */
export function ensureVerseOutro(scenes: SceneDraft[], reference: string | null | undefined, text: string | null | undefined): SceneDraft[] {
  const ref = reference?.trim();
  const verse = text?.trim();
  if (!ref || !verse || !scenes.length) return scenes;
  const last = scenes[scenes.length - 1];
  const lastNorm = norm(last.narration);
  const said = lastNorm.includes(norm(stripEnd(verse)).slice(0, 40));
  if (said) {
    if (lastNorm.includes(norm(ref))) return scenes;
    return [...scenes.slice(0, -1), { ...last, narration: `${stripEnd(last.narration)}. ${stripEnd(ref)}.` }];
  }
  return [...scenes, { narration: verseNarration(ref, verse), visualKeywords: last.visualKeywords.length ? last.visualKeywords : ["sunrise", "sky", "light"] }];
}
