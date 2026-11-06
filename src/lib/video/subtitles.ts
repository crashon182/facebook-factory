import type { SceneTiming } from "./timeline";

/** Quita emojis, símbolos de control y marcas que ASS interpretaría. */
export function cleanSubtitleText(s: string): string {
  return s
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[{}\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Divide un texto en líneas de pocas palabras (cada una será un subtítulo). */
export function chunkText(text: string, maxWords = 5, maxChars = 34): string[] {
  const words = cleanSubtitleText(text).split(" ").filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && (next.length > maxWords || next.join(" ").length > maxChars)) {
      out.push(cur.join(" "));
      cur = [w];
    } else cur = next;
    if (/[.!?…]$/.test(w) && cur.length >= 2) {
      out.push(cur.join(" "));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

export type SubtitleCue = { startSec: number; endSec: number; text: string };

/**
 * Subtítulos sincronizados por proporción: dentro de la ventana de audio de cada escena,
 * el tiempo se reparte según la cantidad de caracteres de cada fragmento (TTS no entrega marcas por palabra).
 */
export function buildCues(scenes: { timing: SceneTiming; text: string }[], leadSec = 0.05): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const { timing, text } of scenes) {
    const chunks = chunkText(text);
    if (!chunks.length) continue;
    const total = chunks.reduce((s, c) => s + c.length, 0);
    let t = timing.startSec + leadSec;
    const window = Math.max(0.2, timing.audioSec - leadSec);
    for (const c of chunks) {
      const d = (c.length / total) * window;
      cues.push({ startSec: t, endSec: t + d, text: c });
      t += d;
    }
  }
  return cues;
}

const ts = (sec: number) => {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

export function buildAss(cues: SubtitleCue[], opts: { width?: number; height?: number; fontName?: string; fontSize?: number } = {}): string {
  const w = opts.width ?? 1080;
  const h = opts.height ?? 1920;
  const font = opts.fontName ?? "DejaVu Sans";
  const size = opts.fontSize ?? 64;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,${Math.round(h * 0.2)},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...cues.map((c) => `Dialogue: 0,${ts(c.startSec)},${ts(c.endSec)},Default,,0,0,0,,${c.text}`),
    "",
  ].join("\n");
}
