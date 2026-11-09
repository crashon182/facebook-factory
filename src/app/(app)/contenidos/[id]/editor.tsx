"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CheckCheck, Copy, Loader2, RefreshCw, Save, Trash2, Ban, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isCancellable, isDeletable, isEditable, type PostStatus } from "@/lib/services/content-status";
import {
  approveContentAction, cancelContentAction, deleteContentAction, duplicateContentAction, markReadyAction, regenerateContentAction, saveContentAction,
} from "../actions";

export type EditorPost = {
  id: string; status: PostStatus; approved: boolean; format: string; internalTitle: string; topic: string; body: string;
  facebookCaption: string; script: string; verseReference: string; verseText: string; hashtags: string[]; failureReason: string | null;
  scenes: { id: string; sceneOrder: number; narration: string; visualKeywords: string[] }[];
};

export function ContentEditor({ post }: { post: EditorPost }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState<null | "delete" | "cancel" | "regen">(null);
  const [f, setF] = useState({ internalTitle: post.internalTitle, topic: post.topic, body: post.body, facebookCaption: post.facebookCaption, script: post.script, verseReference: post.verseReference, verseText: post.verseText, hashtags: post.hashtags.join(", ") });
  const dirty = JSON.stringify(f) !== JSON.stringify({ internalTitle: post.internalTitle, topic: post.topic, body: post.body, facebookCaption: post.facebookCaption, script: post.script, verseReference: post.verseReference, verseText: post.verseText, hashtags: post.hashtags.join(", ") });
  const editable = isEditable(post.status);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(okMsg); if (after) after(); else router.refresh(); } else toast.error(res.error ?? "Error");
      setConfirm(null);
    });
  }
  const payload = () => ({ ...f, hashtags: f.hashtags.split(/[,\n]/).map((h) => h.trim()).filter(Boolean) });
  const save = () => run(() => saveContentAction(post.id, payload()), "Cambios guardados");

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader><CardTitle>Contenido</CardTitle><CardDescription>{editable ? "Editá libremente; al guardar se retira la aprobación." : "Este contenido no se puede editar en su estado actual."}</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            {post.failureReason && <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{post.failureReason}</p>}
            <div className="space-y-1.5"><Label htmlFor="t">Título interno</Label><Input id="t" value={f.internalTitle} onChange={set("internalTitle")} disabled={!editable} maxLength={200} /></div>
            <div className="space-y-1.5"><Label htmlFor="tp">Tema</Label><Input id="tp" value={f.topic} onChange={set("topic")} disabled={!editable} maxLength={300} /></div>
            <div className="space-y-1.5">
              <Label htmlFor="c">Texto para Facebook</Label>
              <Textarea id="c" rows={8} value={f.facebookCaption} onChange={set("facebookCaption")} disabled={!editable} maxLength={5000} />
              <p className="text-right text-xs text-muted-foreground">{f.facebookCaption.length} / 5000</p>
            </div>
            <div className="space-y-1.5"><Label htmlFor="b">Texto principal</Label><Textarea id="b" rows={5} value={f.body} onChange={set("body")} disabled={!editable} /></div>
            {(post.format === "REEL" || f.script) && (
              <div className="space-y-1.5"><Label htmlFor="s">Guion</Label><Textarea id="s" rows={6} value={f.script} onChange={set("script")} disabled={!editable} /></div>
            )}
            {(post.verseReference || post.verseText || post.format === "REEL" || post.format === "QUOTE_IMAGE") && (
              <div className="space-y-3 rounded-lg border p-3">
                <p className="text-sm font-medium">Versículo bíblico</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5"><Label htmlFor="vr">Referencia</Label><Input id="vr" value={f.verseReference} onChange={set("verseReference")} disabled={!editable} maxLength={160} placeholder="Filipenses 4:6-7" /></div>
                  <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="vt">Texto del versículo</Label><Textarea id="vt" rows={3} value={f.verseText} onChange={set("verseText")} disabled={!editable} maxLength={2000} /></div>
                </div>
                <p className="text-xs text-muted-foreground">Verificá la cita y el texto contra tu Biblia antes de aprobar: la IA puede equivocarse. En los Reels la última escena lee este versículo; si lo corregís acá, corregí también esa escena.</p>
              </div>
            )}
            <div className="space-y-1.5"><Label htmlFor="h">Hashtags (separados por coma, sin #)</Label><Input id="h" value={f.hashtags} onChange={set("hashtags")} disabled={!editable} /></div>
          </CardContent>
        </Card>

      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Acciones</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            {editable && <Button onClick={save} disabled={pending || !dirty}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Guardar cambios</Button>}
            {(post.status === "DRAFT" || post.status === "FAILED") && (
              <Button variant="outline" disabled={pending || dirty} onClick={() => run(() => markReadyAction(post.id), "Marcado como listo")}><Check /> Marcar como listo</Button>
            )}
            {post.status === "READY" && (
              post.approved
                ? <Button variant="outline" disabled={pending || dirty} onClick={() => run(() => approveContentAction(post.id, false), "Aprobación retirada")}><Undo2 /> Quitar aprobación</Button>
                : <Button disabled={pending || dirty} onClick={() => run(() => approveContentAction(post.id, true), "Contenido aprobado")}><CheckCheck /> Aprobar</Button>
            )}
            {editable && <Button variant="outline" disabled={pending} onClick={() => setConfirm("regen")}><RefreshCw /> Regenerar con IA</Button>}
            <Button variant="outline" disabled={pending} onClick={() => run(async () => { const r = await duplicateContentAction(post.id); if (r.ok) router.push(`/contenidos/${r.data.id}`); return r; }, "Contenido duplicado", () => {})}><Copy /> Duplicar</Button>
            {isCancellable(post.status) && <Button variant="outline" disabled={pending} onClick={() => setConfirm("cancel")}><Ban /> Cancelar contenido</Button>}
            {isDeletable(post.status) && <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => setConfirm("delete")}><Trash2 /> Eliminar</Button>}
            {dirty && <p className="text-xs text-muted-foreground">Guardá los cambios para habilitar las demás acciones.</p>}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? "¿Eliminar este contenido?" : confirm === "cancel" ? "¿Cancelar este contenido?" : "¿Regenerar con IA?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete" ? "Se elimina de forma permanente." : confirm === "cancel" ? "Quedará en estado Cancelado y no se publicará." : "Se reemplazará el texto actual por una nueva versión y se retirará la aprobación. Consume créditos de OpenAI."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                confirm === "delete" ? run(() => deleteContentAction(post.id), "Contenido eliminado", () => router.push("/contenidos"))
                : confirm === "cancel" ? run(() => cancelContentAction(post.id), "Contenido cancelado")
                : run(() => regenerateContentAction(post.id), "Contenido regenerado")
              }
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
