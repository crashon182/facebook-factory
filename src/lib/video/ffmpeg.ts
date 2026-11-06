import { spawn } from "node:child_process";

const FFMPEG = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH?.trim() || "ffprobe";

export class FfmpegError extends Error {
  constructor(message: string, public stderrTail: string) {
    super(message);
  }
}

type RunOpts = { cwd?: string; timeoutMs?: number; signal?: AbortSignal; onProgressMs?: (outTimeMs: number) => void };

/** Ejecuta un binario sin shell (los argumentos nunca se interpretan). Devuelve stdout. */
function run(bin: string, args: string[], opts: RunOpts = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], signal: opts.signal, cwd: opts.cwd });
    let out = "";
    let err = "";
    let buf = "";
    const timer = opts.timeoutMs ? setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs) : null;
    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      if (opts.onProgressMs) {
        buf += s;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
          if (m) opts.onProgressMs(Number(m[1]) / 1000);
        }
      } else out += s;
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-4000);
    });
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(new FfmpegError(`No se pudo ejecutar ${bin}: ${e.message}`, err));
    });
    child.on("close", (code, sig) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new FfmpegError(sig ? `${bin} terminó por señal ${sig}` : `${bin} salió con código ${code}`, err));
    });
  });
}

export function ffmpeg(args: string[], opts: RunOpts = {}) {
  const full = ["-hide_banner", "-loglevel", "error", "-y", ...(opts.onProgressMs ? ["-progress", "pipe:1", "-nostats"] : []), ...args];
  return run(FFMPEG, full, opts);
}

export type ProbeResult = { durationSec: number; width: number | null; height: number | null; hasVideo: boolean; hasAudio: boolean; formatName: string };

export async function probe(file: string): Promise<ProbeResult> {
  const raw = await run(FFPROBE, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { timeoutMs: 30_000 });
  const j = JSON.parse(raw) as { streams?: { codec_type: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }[]; format?: { duration?: string; format_name?: string } };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const dur = Number(j.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  return { durationSec: Number.isFinite(dur) ? dur : 0, width: v?.width ?? null, height: v?.height ?? null, hasVideo: !!v, hasAudio: !!a, formatName: j.format?.format_name ?? "" };
}
