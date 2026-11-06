"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function UploadTab() {
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/media/upload", { method: "POST", body: new FormData(e.currentTarget) });
      const body = (await res.json().catch(() => ({}))) as { error?: string; duplicate?: boolean };
      if (!res.ok) toast.error(body.error ?? "No se pudo subir el archivo");
      else {
        toast.success(body.duplicate ? "Ese archivo ya estaba en la biblioteca" : "Archivo agregado a la biblioteca");
        ref.current?.reset();
        router.refresh();
      }
    } catch {
      toast.error("Falló la subida");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={ref} onSubmit={submit} className="mx-auto max-w-xl space-y-4">
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Imágenes (hasta 25 MB), videos (300 MB) o audio (60 MB). El tipo se verifica por su contenido. La licencia es obligatoria: para música, solo subí pistas sobre las que tengas derechos de uso.
      </p>
      <div className="space-y-1.5"><Label htmlFor="file">Archivo</Label><Input id="file" name="file" type="file" required accept="image/*,video/*,audio/*" /></div>
      <div className="space-y-1.5"><Label htmlFor="title">Título (opcional)</Label><Input id="title" name="title" maxLength={200} /></div>
      <div className="space-y-1.5"><Label htmlFor="keywords">Palabras clave (separadas por coma)</Label><Input id="keywords" name="keywords" placeholder="amanecer, paz, naturaleza" /></div>
      <div className="space-y-1.5"><Label htmlFor="license">Licencia / origen de los derechos *</Label><Textarea id="license" name="license" required rows={3} maxLength={2000} placeholder="Ej.: Material propio · Licencia CC0 (enlace) · Comprado en … con licencia comercial" /></div>
      <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Upload />} Subir a la biblioteca</Button>
    </form>
  );
}
