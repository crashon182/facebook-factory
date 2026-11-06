"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FORMAT_LABELS } from "@/lib/constants";
import { createDraftAction, generateContentAction } from "./actions";

export function GenerateDialog({ pages, configured, defaultPageId }: { pages: { id: string; name: string }[]; configured: boolean; defaultPageId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pageId, setPageId] = useState(defaultPageId ?? pages[0]?.id ?? "");
  const [format, setFormat] = useState("TEXT");
  const [topic, setTopic] = useState("");
  const [pending, start] = useTransition();

  function generate() {
    start(async () => {
      const t = toast.loading("Generando contenido con IA…");
      const res = await generateContentAction({ pageId, format, topic: topic || undefined });
      toast.dismiss(t);
      if (res.ok) {
        toast.success("Contenido generado");
        setOpen(false);
        router.push(`/contenidos/${res.data.id}`);
      } else {
        toast.error(res.error);
        router.refresh();
      }
    });
  }
  function blank() {
    start(async () => {
      const res = await createDraftAction(pageId, format);
      if (res.ok) router.push(`/contenidos/${res.data.id}`);
      else toast.error(res.error);
    });
  }

  const trigger = (
    <Button disabled={pages.length === 0}><Sparkles /> Generar contenido</Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {pages.length === 0 ? (
        <Tooltip><TooltipTrigger asChild><span>{trigger}</span></TooltipTrigger><TooltipContent>Primero creá una página.</TooltipContent></Tooltip>
      ) : (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo contenido</DialogTitle>
          <DialogDescription>
            La IA usa la estrategia de la página y evita repetir contenidos anteriores. {!configured && "OpenAI no está configurado: solo podés crear borradores manuales."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Página</Label>
            <Select value={pageId} onValueChange={setPageId}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{pages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Formato</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(FORMAT_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="topic">Tema (opcional)</Label>
            <Input id="topic" value={topic} maxLength={300} onChange={(e) => setTopic(e.target.value)} placeholder="Si lo dejás vacío, la IA elige según la estrategia" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={blank} disabled={pending}><FilePlus2 /> Borrador manual</Button>
          <Button onClick={generate} disabled={pending || !configured || !pageId}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Generar con IA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
