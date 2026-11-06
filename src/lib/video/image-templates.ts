import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureDir, removeQuiet, storageRoot } from "@/lib/storage";
import { cleanSubtitleText } from "./subtitles";
import { ffmpeg } from "./ffmpeg";
import { randomUUID } from "node:crypto";

import { ASPECTS, IMAGE_TEMPLATES, type AspectId, type TemplateId } from "./image-templates-meta";
export { ASPECTS, IMAGE_TEMPLATES };
export type { AspectId, TemplateId };

export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + " " + w).length > maxChars) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

export function pickFontSize(len: number) {
  return len <= 60 ? 78 : len <= 110 ? 66 : len <= 180 ? 56 : len <= 260 ? 48 : 40;
}

const FONT_BOLD = () => process.env.FONT_BOLD?.trim() || "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const FONT_SERIF = () => process.env.FONT_SERIF?.trim() || "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf";
const safeColor = (c: string | null | undefined, d: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? "0x" + c.slice(1) : d);

export type QuoteImageOptions = {
  text: string;
  attribution?: string | null;
  brandName?: string | null;
  template: TemplateId;
  aspect: AspectId;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  /** Ruta absoluta de la foto de fondo (solo plantilla photo-veil). */
  backgroundFile?: string | null;
  outFile: string;
};

/** Genera la imagen con FFmpeg (sin dependencias nativas extra). Los textos se pasan por archivos, nunca por la línea de filtros. */
export async function renderQuoteImage(opts: QuoteImageOptions): Promise<void> {
  // El cwd de FFmpeg es la carpeta de trabajo: las rutas de entrada/salida deben ser absolutas.
  const o = { ...opts, outFile: path.resolve(opts.outFile), backgroundFile: opts.backgroundFile ? path.resolve(opts.backgroundFile) : null };
  const { w, h } = ASPECTS[o.aspect];
  const text = cleanSubtitleText(o.text);
  if (!text) throw new Error("El texto de la imagen está vacío");
  const size = pickFontSize(text.length);
  const lines = wrapText(text, Math.max(10, Math.floor((w * 0.78) / (size * 0.6))));
  const work = path.join(storageRoot(), "tmp", `img-${randomUUID()}`);
  await ensureDir(work);
  try {
    await writeFile(path.join(work, "q.txt"), lines.join("\n"));
    await writeFile(path.join(work, "a.txt"), o.attribution ? "— " + cleanSubtitleText(o.attribution) : " ");
    await writeFile(path.join(work, "b.txt"), cleanSubtitleText(o.brandName ?? "") || " ");

    const dark = o.template !== "light-minimal";
    const fg = dark ? "white" : "0x1e293b";
    const accent = safeColor(o.primaryColor, "0x6366f1");
    const second = safeColor(o.secondaryColor, "0x8b5cf6");
    const lineH = Math.round(size * 1.3);
    const textBlockH = lines.length * lineH;
    const y = Math.round((h - textBlockH) / 2);

    let inputs: string[];
    let bg: string;
    if (o.template === "photo-veil" && o.backgroundFile) {
      inputs = ["-i", o.backgroundFile];
      bg = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1,drawbox=x=0:y=0:w=iw:h=ih:color=black@0.58:t=fill[bg]`;
    } else if (o.template === "brand-gradient") {
      inputs = ["-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${accent}:c1=${second}:x0=0:y0=0:x1=${w}:y1=${h}:d=1:n=2`];
      bg = `[0:v]setsar=1[bg]`;
    } else {
      inputs = ["-f", "lavfi", "-i", `color=c=${dark ? "0x0f172a" : "0xf8fafc"}:s=${w}x${h}:d=1`];
      bg = `[0:v]setsar=1[bg]`;
    }
    const font = o.template === "classic-dark" || o.template === "light-minimal" ? FONT_SERIF() : FONT_BOLD();
    const barColor = o.template === "light-minimal" ? accent : o.template === "classic-dark" ? accent : "white@0.9";
    const filter = [
      bg,
      `[bg]drawbox=x=${Math.round(w / 2 - 50)}:y=${Math.max(40, y - 80)}:w=100:h=6:color=${barColor}:t=fill,` +
        `drawtext=fontfile=${font}:textfile=q.txt:fontsize=${size}:fontcolor=${fg}:line_spacing=${Math.round(size * 0.14)}:x=(w-text_w)/2:y=${y}:text_align=center:borderw=${o.template === "photo-veil" || o.template === "brand-gradient" ? 2 : 0}:bordercolor=black@0.35,` +
        `drawtext=fontfile=${FONT_BOLD()}:textfile=a.txt:fontsize=${Math.round(size * 0.5)}:fontcolor=${fg}@0.8:x=(w-text_w)/2:y=${y + textBlockH + 30},` +
        `drawtext=fontfile=${FONT_BOLD()}:textfile=b.txt:fontsize=30:fontcolor=${fg}@0.6:x=(w-text_w)/2:y=h-90[out]`,
    ].join(";");
    await ensureDir(path.dirname(o.outFile));
    await ffmpeg([...inputs, "-filter_complex", filter, "-map", "[out]", "-frames:v", "1", "-update", "1", o.outFile], { cwd: work, timeoutMs: 60_000 });
  } finally {
    await removeQuiet(work);
  }
}
