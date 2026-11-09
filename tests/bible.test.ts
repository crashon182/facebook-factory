import { describe, expect, it } from "vitest";
import { bibleVersion, DEFAULT_BIBLE_VERSION, ensureVerseOutro, verseNarration } from "@/lib/bible";
import { buildContentPrompt } from "@/lib/prompts/content";

const REF = "Filipenses 4:6-7";
const TXT = "Por nada estéis afanosos, sino sean conocidas vuestras peticiones delante de Dios.";
const scenes = [{ narration: "Hoy quiero hablarte de la paz.", visualKeywords: ["sunrise"] }, { narration: "Dios cuida de ti.", visualKeywords: ["mountain", "light"] }];

describe("cierre del Reel con el versículo", () => {
  it("agrega una escena final con el versículo y su cita, reutilizando las palabras visuales", () => {
    const out = ensureVerseOutro(scenes, REF, TXT);
    expect(out).toHaveLength(3);
    expect(out[2].narration).toBe(`Por nada estéis afanosos, sino sean conocidas vuestras peticiones delante de Dios. ${REF}.`);
    expect(out[2].visualKeywords).toEqual(["mountain", "light"]);
    expect(out.slice(0, 2)).toEqual(scenes);
  });
  it("no duplica el versículo si la última escena ya lo dice; solo le agrega la cita", () => {
    const said = [...scenes.slice(0, 1), { narration: `«${TXT}»`, visualKeywords: [] }];
    const out = ensureVerseOutro(said, REF, TXT);
    expect(out).toHaveLength(2);
    expect(out[1].narration).toContain(REF);
    expect(ensureVerseOutro(out, REF, TXT)).toEqual(out); // idempotente
  });
  it("sin versículo no toca las escenas, y sin palabras visuales usa unas por defecto", () => {
    expect(ensureVerseOutro(scenes, null, TXT)).toBe(scenes);
    expect(ensureVerseOutro(scenes, REF, "  ")).toBe(scenes);
    expect(ensureVerseOutro([{ narration: "x", visualKeywords: [] }], REF, TXT)[1].visualKeywords.length).toBeGreaterThan(0);
  });
  it("arma la narración sin puntuación doble", () => {
    expect(verseNarration(" Salmos 23:1. ", "«El Señor es mi pastor;  nada me faltará.»")).toBe("El Señor es mi pastor;  nada me faltará. Salmos 23:1.");
  });
});

describe("prompt con versículo", () => {
  const page = { name: "Palabras", topic: "Reflexión cristiana", description: "Reflexiones", language: "es", bibleVerses: true } as never;
  const build = (format: string, bibleVerses = true) => buildContentPrompt({ page: { ...(page as object), bibleVerses } as never, strategy: null, format, recent: [], rule: null }).system;

  it("pide versículo exacto, en la versión configurada, y reglas por formato", () => {
    expect(build("REEL")).toContain("verseReference");
    expect(build("REEL")).toContain(DEFAULT_BIBLE_VERSION);
    expect(build("REEL")).toContain("agrega al final una escena");
    expect(build("QUOTE_IMAGE")).toContain("`imageText` debe ser exactamente `verseText`");
    expect(build("QUOTE_IMAGE")).not.toContain("agrega al final una escena");
  });
  it("si la página no lo usa, los campos del versículo van en null", () => {
    const s = build("REEL", false);
    expect(s).toContain("`verseReference` y `verseText` van en null");
    expect(s).not.toContain("Elegí UN versículo");
  });
  it("la versión se puede cambiar por entorno", () => {
    expect(bibleVersion({ BIBLE_VERSION: " Reina-Valera 1909 " } as never)).toBe("Reina-Valera 1909");
    expect(bibleVersion({} as never)).toBe(DEFAULT_BIBLE_VERSION);
  });
});
