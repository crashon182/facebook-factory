"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ASPECTS, IMAGE_TEMPLATES } from "@/lib/video/image-templates-meta";
import { generateImageAction, setPostPhotoAction } from "../media-actions";

export type PostImage = { id: string; path: string; title: string | null };

export function ImagePanel({ postId, defaultText, photos, images, editable, format, primaryPhotoId, autoBackground, defaultAttribution }: { postId: string; defaultText: string; defaultAttribution?: string; photos: { id: string; title: string }[]; images: PostImage[]; editable: boolean; format?: string; primaryPhotoId?: string | null; autoBackground?: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(defaultText);
  const [attribution, setAttribution] = useState(defaultAttribution ?? "");
  const [template, setTemplate] = useState("classic-dark");
  const [aspect, setAspect] = useState("square");
  const [bg, setBg] = useState(autoBackground ? "auto" : "");
  const [pending, start] = useTransition();

  function generate() {
    start(async () => {
      const res = await generateImageAction(postId, { text, attribution: attribution || undefined, template, aspect, backgroundAssetId: bg || undefined });
      if (res.ok) { toast.success("Imagen generada"); router.refresh(); } else toast.error(res.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ImageIcon className="size-4" /> Imagen con frase</CardTitle>
        <CardDescription>Plantillas con los colores y el nombre de la página. Se genera localmente con FFmpeg.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {format === "IMAGE" && (
          <div className="space-y-1.5 rounded-lg border p-3">
            <Label>Foto principal (se publica con el texto)</Label>
            <Select value={primaryPhotoId ?? "none"} onValueChange={async (v) => { const r = await setPostPhotoAction(postId, v === "none" ? null : v); if (r.ok) { toast.success("Foto actualizada"); router.refresh(); } else toast.error(r.error); }} disabled={!editable}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">Sin foto</SelectItem>{photos.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">También podés generar una imagen con frase más abajo: si existe, tiene prioridad.</p>
          </div>
        )}
        <div className="space-y-1.5"><Label htmlFor="it">Frase</Label><Textarea id="it" rows={3} value={text} maxLength={600} onChange={(e) => setText(e.target.value)} disabled={!editable} /></div>
        <div className="space-y-1.5"><Label htmlFor="ia">Autor / cita (opcional)</Label><Input id="ia" value={attribution} maxLength={120} onChange={(e) => setAttribution(e.target.value)} placeholder="Proverbios 3:5" disabled={!editable} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label>Plantilla</Label>
            <Select value={template} onValueChange={setTemplate}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{IMAGE_TEMPLATES.map((t) => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Formato</Label>
            <Select value={aspect} onValueChange={setAspect}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(ASPECTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent></Select></div>
        </div>
        {template === "photo-veil" && (
          <div className="space-y-1.5"><Label>Foto de fondo (de la biblioteca)</Label>
            <Select value={bg} onValueChange={setBg}><SelectTrigger className="w-full"><SelectValue placeholder={photos.length ? "Elegí una foto" : "No hay fotos en la biblioteca"} /></SelectTrigger><SelectContent>{autoBackground && <SelectItem value="auto">Automática (de {autoBackground})</SelectItem>}{photos.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}</SelectContent></Select>
            <p className="text-xs text-muted-foreground">{autoBackground ? `Con «Automática» se busca una foto según las palabras clave del contenido y se guarda en la biblioteca.` : "Para traer fotos automáticamente configurá PIXABAY_API_KEY o PEXELS_API_KEY en el entorno."}</p></div>
        )}
        <Button onClick={generate} disabled={!editable || pending || text.trim().length < 3}>{pending ? <Loader2 className="animate-spin" /> : <ImageIcon />} Generar imagen</Button>
        {images.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {images.map((im) => (
              <a key={im.id} href={`/api/files/${im.path}`} target="_blank" rel="noreferrer noopener" className="block overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${im.path}`} alt={im.title ?? "Imagen generada"} className="w-full" loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
