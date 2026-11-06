export type SceneTiming = { index: number; startSec: number; durationSec: number; audioSec: number };
export type Timeline = { scenes: SceneTiming[]; totalSec: number; tempo: number; overTarget: boolean };

export const FADE_SEC = 0.4;

/**
 * Calcula la línea de tiempo a partir de la duración real de cada narración.
 * - Cada escena dura su audio + una pausa. 
 * - Si el total supera en >10% la duración objetivo, se acelera la narración (máx. 1.3x).
 * - `overTarget` avisa si aun así se pasa más de 15% del objetivo.
 */
export function computeTimeline(audioSecs: number[], opts: { targetSec: number; padSec?: number; maxTempo?: number }): Timeline {
  const pad = opts.padSec ?? 0.35;
  const maxTempo = opts.maxTempo ?? 1.3;
  const raw = audioSecs.reduce((s, a) => s + a + pad, 0);
  let tempo = 1;
  if (raw > opts.targetSec * 1.1) tempo = Math.min(maxTempo, raw / opts.targetSec);
  let t = 0;
  const scenes = audioSecs.map((a, index) => {
    const audioSec = a / tempo;
    const durationSec = audioSec + pad;
    const s = { index, startSec: round(t), durationSec: round(durationSec), audioSec: round(audioSec) };
    t += durationSec;
    return s;
  });
  const totalSec = round(t);
  return { scenes, totalSec, tempo: round(tempo), overTarget: totalSec > opts.targetSec * 1.15 };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
