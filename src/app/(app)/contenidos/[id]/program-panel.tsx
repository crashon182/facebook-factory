"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Ban, CalendarClock, ExternalLink, Loader2, RotateCcw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatInTz } from "@/lib/time/tz";
import { publishNowAction, retryAction, scheduleAction, unscheduleAction } from "../../calendario/actions";

export type ProgramInfo = {
  postId: string; pageId: string; tz: string; status: string; approved: boolean; requireApproval: boolean; connection: string;
  scheduledAtIso: string | null; publishedAtIso: string | null; facebookPostId: string | null; scheduleStatus: string | null;
  failureReason: string | null; defaultLocal: string; dirty?: boolean;
};

export function ProgramPanel({ info }: { info: ProgramInfo }) {
  const router = useRouter();
  const [when, setWhen] = useState(info.defaultLocal);
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  const connected = info.connection === "CONNECTED";
  const blockedApproval = info.requireApproval && !info.approved;
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "Error");
    });

  const published = info.status === "PUBLISHED";
  const canSchedule = info.status === "READY" || (info.status === "SCHEDULED" && info.scheduleStatus === "SCHEDULED");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4" /> Programación</CardTitle>
        <CardDescription>Horarios en {info.tz} (zona de la página). Se publican en Facebook mediante el worker de publicación.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!connected && <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs">La página no está conectada a Facebook. <Link href={`/paginas/${info.pageId}/conectar`} className="font-medium underline">Conectar</Link></p>}
        {blockedApproval && info.status === "READY" && <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Aprobá el contenido para poder programarlo.</p>}

        {published && (
          <div className="space-y-1 text-sm">
            <p>Publicado {info.publishedAtIso && formatInTz(new Date(info.publishedAtIso), info.tz, { dateStyle: "medium", timeStyle: "short" })}</p>
            {info.facebookPostId && <a href={`https://www.facebook.com/${info.facebookPostId}`} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-primary hover:underline">Ver en Facebook <ExternalLink className="size-3" /></a>}
          </div>
        )}
        {info.status === "SCHEDULED" && info.scheduledAtIso && <p className="text-sm">Programado para <span className="font-medium">{formatInTz(new Date(info.scheduledAtIso), info.tz, { dateStyle: "medium", timeStyle: "short" })}</span></p>}
        {info.status === "PUBLISHING" && <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Publicando en Facebook…</p>}
        {info.status === "FAILED" && info.failureReason && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{info.failureReason}</p>}

        {canSchedule && (
          <>
            <div className="space-y-1.5"><Label htmlFor="pw">{info.status === "SCHEDULED" ? "Reprogramar" : "Fecha y hora"}</Label><Input id="pw" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} disabled={info.dirty} /></div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={over} onCheckedChange={(v) => setOver(v === true)} /> Permitir superar el máximo diario</label>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={pending || !when || info.dirty || !connected || blockedApproval} onClick={() => run(() => scheduleAction(info.postId, when, over), "Programado")}>{pending ? <Loader2 className="animate-spin" /> : <CalendarClock />} {info.status === "SCHEDULED" ? "Reprogramar" : "Programar"}</Button>
              <Button size="sm" variant="outline" disabled={pending || info.dirty || !connected || blockedApproval} onClick={() => run(() => publishNowAction(info.postId), "Publicación en curso")}><Send /> Publicar ahora</Button>
              {info.status === "SCHEDULED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => unscheduleAction(info.postId), "Programación cancelada")}><Ban /> Cancelar</Button>}
            </div>
          </>
        )}
        {info.status === "FAILED" && info.scheduleStatus === "FAILED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retryAction(info.postId), "Reintento programado")}><RotateCcw /> Reintentar publicación</Button>}
        {info.dirty && <p className="text-xs text-muted-foreground">Guardá los cambios antes de programar.</p>}
      </CardContent>
    </Card>
  );
}
