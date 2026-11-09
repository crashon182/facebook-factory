import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ASPECTS, IMAGE_TEMPLATES, renderQuoteImage, type AspectId } from "@/lib/video/image-templates";

// Necesita FFmpeg con drawtext y las fuentes DejaVu (el CI las instala). Sin ellas, se saltea.
const hasDrawtext = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout?.includes(" drawtext ");
const hasFonts = existsSync("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ff-img-"));
process.env.STORAGE_DIR = tmp;
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(!hasDrawtext || !hasFonts)("imágenes con frase (FFmpeg real)", () => {
  const phrase = "La paz de Dios calma lo que el ruido no puede calmar en tu corazón cansado";
  for (const t of IMAGE_TEMPLATES.filter((t) => t.id !== "photo-veil")) {
    it(`genera un PNG con la plantilla ${t.id} (frase de varias líneas)`, async () => {
      const outFile = path.join(tmp, `${t.id}.png`);
      const aspect = Object.keys(ASPECTS)[0] as AspectId;
      await renderQuoteImage({ text: phrase, attribution: "Proverbios 3:5", brandName: "Palabras que dan Vida", template: t.id, aspect, primaryColor: "#6366f1", secondaryColor: "#8b5cf6", outFile });
      expect(readFileSync(outFile).subarray(1, 4).toString()).toBe("PNG");
    });
  }
});
