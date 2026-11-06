"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Loader2, Square, ScrollText } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cancelRenderAction, getRenderLogsAction, getRendersAction, requestRenderAction, setSceneMediaAction, type RenderRow } from "../media-actions";

export type LibAsset = { id: string; type: string; title: string; durationMs: number | null };
export type SceneRow = { id: string; sceneOrder: number; narration: string; visualKeywords: string[]; mediaAssetId: string | null };

const STATUS: Record<string, string> = { QUEUED: "En cola", RUNNING: "Renderizando", COMPLETED: "Completado", FAILED: "Falló", CANCELLED: "Cancelado" };

export function ReelPanel({ postId, scenes, library, initial, ready, blockedReason }: { postId: string; scenes: SceneRow[]; library: LibAsset[]; initial: RenderRow[]; ready: boolean; blockedReason: string | null }) {
  const router = useRouter();
  const [renders, setRenders] = useState<RenderRow[]>(initial);
  const [duration, setDuration] = useState("30");
  const [music, setMusic] = useState("none");
  const [logs, setLogs] = useState<{ id: string; text: string } | null>(null);
  const [pending, start] = useTransition();
  const latest = renders[0];
  const active = latest && (latest.status === "QUEUED" || latest.status === "RUNNING");

  const refresh = useCallback(async () => setRenders(await getRendersAction(postId)), [postId]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [active, refresh]);

  function render() {
    start(async () => {
      const res = await requestRenderAction(postId, { durationSec: Number(duration), musicAssetId: music === "none" ? undefined : music });
      if (res.ok) { toast.success("Render en cola; lo procesa el worker"); await refresh(); } else toast.error(res.error);
    });
  }
  function cancel(id: string) {
    start(async () => {
      const res = await cancelRenderAction(id, postId);
      if (res.ok) { toast.success("Render cancelado"); await refresh(); } else toast.error(res.error);
    });
  }
  async function showLogs(id: string) {
    setLogs({ id, text: await getRenderLogsAction(id) });
  }
  async function assign(sceneId: string, value: string) {
    const res = await setSceneMediaAction(sceneId, value === "auto" ? null : value);
    if (res.ok) { toast.success("Recurso de la escena actualizado"); router.refresh(); } else toast.error(res.error);
  }

  const visuals = library.filter((a) => a.type === "VIDEO" || a.type === "PHOTO");
  const musics = library.filter((a) => a.type === "AUDIO");
  const done = renders.find((r) => r.status === "COMPLETED" && r.outputPath);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Clapperboard className="size-4" /> Video del Reel</CardTitle>
        <CardDescription>Vertical 1080×1920, H.264 + AAC. Se renderiza en un worker aparte (no bloquea la aplicación).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {done && (
          <video key={done.id} controls preload="metadata" poster={done.thumbnailPath ? `/api/files/${done.thumbnailPath}` : undefined} className="mx-auto max-h-[560px] rounded-xl bg-black" src={`/api/files/${done.outputPath}`} />
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Duración objetivo</Label>
            <Select value={duration} onValueChange={setDuration}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{[15, 30, 45].map((d) => <SelectItem key={d} value={String(d)}>{d} segundos</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Música (solo pistas con licencia registrada)</Label>
            <Select value={music} onValueChange={setMusic}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Sin música</SelectItem>{musics.map((m) => <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={render} disabled={pending || !ready || !!active}>{pending || active ? <Loader2 className="animate-spin" /> : <Clapperboard />} {done ? "Renderizar de nuevo" : "Renderizar Reel"}</Button>
          {active && <Button variant="outline" onClick={() => cancel(latest.id)} disabled={pending}><Square /> Cancelar</Button>}
          {blockedReason && <span className="text-xs text-muted-foreground">{blockedReason}</span>}
        </div>

        {active && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground"><span>{STATUS[latest.status]} · {latest.stage}</span><span>{latest.progress}%</span></div>
            <Progress value={latest.progress} />
            {latest.status === "QUEUED" && <p className="text-xs text-muted-foreground">Si no avanza, verificá que el worker esté corriendo: <code>npm run worker:render</code>.</p>}
          </div>
        )}
        {latest?.status === "FAILED" && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{latest.error}</p>}

        <div className="space-y-2">
          <Label>Recursos por escena</Label>
          <ul className="space-y-2">
            {scenes.map((s) => (
              <li key={s.id} className="grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[1fr_16rem]">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">Escena {s.sceneOrder}</div>
                  <p>{s.narration}</p>
                  {s.visualKeywords.length > 0 && <p className="text-xs text-muted-foreground">Búsqueda: {s.visualKeywords.join(", ")}</p>}
                </div>
                <Select value={s.mediaAssetId ?? "auto"} onValueChange={(v) => assign(s.id, v)}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Automático (proveedor o fondo)</SelectItem>
                    {visuals.map((a) => <SelectItem key={a.id} value={a.id}>{a.type === "VIDEO" ? "🎬" : "🖼"} {a.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </li>
            ))}
          </ul>
        </div>

        {renders.length > 0 && (
          <div className="space-y-2">
            <Label>Historial de renders</Label>
            <ul className="divide-y rounded-lg border text-sm">
              {renders.map((r) => (
                <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                  <Badge variant={r.status === "COMPLETED" ? "default" : "outline"}>{STATUS[r.status]}</Badge>
                  <span className="flex-1 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })} · objetivo {r.durationSec}s · intentos {r.attempts}</span>
                  <Button variant="ghost" size="sm" onClick={() => showLogs(r.id)}><ScrollText /> Log</Button>
                </li>
              ))}
            </ul>
            {logs && <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs">{logs.text || "Sin registros"}</pre>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
