"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, CalendarClock, ExternalLink, Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PostStatusBadge } from "@/components/shared/content-badges";
import { FORMAT_LABELS } from "@/lib/constants";
import { toLocalInput } from "@/lib/time/tz";
import { getPublicationDetailsAction, publishNowAction, retryAction, scheduleAction, unscheduleAction, type PublicationDetails } from "./actions";

export function PostDialog({ postId, open, onOpenChange }: { postId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [d, setD] = useState<PublicationDetails | null>(null);
  const [when, setWhen] = useState("");
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getPublicationDetailsAction(postId).then((x) => {
      if (cancelled) return;
      setD(x);
      if (x?.scheduledAtIso) setWhen(toLocalInput(new Date(x.scheduledAtIso), x.tz));
    });
    return () => { cancelled = true; };
  }, [open, postId]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); onOpenChange(false); router.refresh(); } else toast.error(r.error ?? "Error");
    });
  }

  const canEditSchedule = d && (d.status === "SCHEDULED" || d.status === "READY") && d.scheduleStatus !== "PUBLISHING";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        {!d ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{d.title}</DialogTitle>
              <DialogDescription>{d.pageName} · {FORMAT_LABELS[d.format]} · horario en {d.tz}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <PostStatusBadge status={d.status} />
              {d.approved && <Badge variant="outline" className="border-success/30 text-success">Aprobado</Badge>}
              {d.facebookPostId && (
                <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" target="_blank" rel="noreferrer noopener" href={`https://www.facebook.com/${d.facebookPostId}`}>
                  Ver en Facebook <ExternalLink className="size-3" />
                </a>
              )}
            </div>

            {d.videoPath && <video controls preload="metadata" poster={d.thumbPath ? `/api/files/${d.thumbPath}` : undefined} src={`/api/files/${d.videoPath}`} className="mx-auto max-h-80 rounded-lg bg-black" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {d.imagePath && <img src={`/api/files/${d.imagePath}`} alt="Vista previa" className="mx-auto max-h-80 rounded-lg" />}
            <div className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-sm">{d.caption || "Sin texto"}{d.hashtags.length > 0 && <span className="mt-2 block text-muted-foreground">{d.hashtags.map((h) => `#${h}`).join(" ")}</span>}</div>

            {d.failureReason && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{d.failureReason}</p>}

            {canEditSchedule && (
              <div className="space-y-3 rounded-lg border p-3">
                <Label htmlFor="when">{d.status === "SCHEDULED" ? "Reprogramar" : "Programar"} ({d.tz})</Label>
                <Input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={over} onCheckedChange={(v) => setOver(v === true)} /> Permitir superar el máximo diario de la página</label>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={pending || !when} onClick={() => run(() => scheduleAction(d.id, when, over), "Programado")}>{pending ? <Loader2 className="animate-spin" /> : <CalendarClock />} {d.status === "SCHEDULED" ? "Reprogramar" : "Programar"}</Button>
                  {d.status === "SCHEDULED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => unscheduleAction(d.id), "Programación cancelada")}><Ban /> Cancelar programación</Button>}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(d.status === "READY" || d.status === "SCHEDULED") && d.approved && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => publishNowAction(d.id), "Publicación en curso")}><Send /> Publicar ahora</Button>}
              {d.status === "FAILED" && d.scheduleStatus === "FAILED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryAction(d.id), "Reintento programado")}><RotateCcw /> Reintentar</Button>}
              <Button size="sm" variant="ghost" asChild><Link href={`/contenidos/${d.id}`}>Abrir editor</Link></Button>
            </div>

            {d.attempts.length > 0 && (
              <div className="space-y-1.5">
                <Label>Intentos de publicación</Label>
                <ul className="divide-y rounded-lg border text-xs">
                  {d.attempts.map((a) => (
                    <li key={a.no} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                      <Badge variant={a.status === "SUCCEEDED" ? "default" : "outline"}>#{a.no} {a.status}</Badge>
                      <span className="text-muted-foreground">{new Date(a.startedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "medium" })}</span>
                      {a.objectId && <span className="font-mono">{a.objectId}</span>}
                      {a.error && <span className="basis-full text-destructive">{a.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
