"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Music, Trash2, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { deleteAssetAction } from "./actions";

export type AssetRow = {
  id: string; type: string; provider: string; title: string | null; author: string | null; authorUrl: string | null; sourceUrl: string | null;
  license: string | null; localPath: string | null; thumbPath: string | null; width: number | null; height: number | null; durationMs: number | null; sizeBytes: number | null;
};
const TYPE_LABEL: Record<string, string> = { PHOTO: "Foto", VIDEO: "Video", AUDIO: "Audio", RENDERED_IMAGE: "Imagen generada" };

export function LibraryTab({ assets }: { assets: AssetRow[] }) {
  const router = useRouter();
  const [del, setDel] = useState<AssetRow | null>(null);
  const [pending, start] = useTransition();

  if (assets.length === 0) return <EmptyState icon={ImageIcon} title="La biblioteca está vacía" description="Buscá fotos y videos en Pexels o subí tus propios archivos." />;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        {assets.map((a) => (
          <div key={a.id} className="overflow-hidden rounded-xl border bg-card">
            <div className="relative flex aspect-square items-center justify-center bg-muted">
              {a.thumbPath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/files/${a.thumbPath}`} alt={a.title ?? "Recurso"} loading="lazy" className="size-full object-cover" />
              ) : <Music className="size-10 text-muted-foreground" />}
              <Badge variant="secondary" className="absolute left-2 top-2">{TYPE_LABEL[a.type] ?? a.type}</Badge>
            </div>
            <div className="space-y-1 p-3 text-xs">
              <div className="truncate font-medium" title={a.title ?? ""}>{a.title ?? `${a.provider} ${a.id.slice(0, 6)}`}</div>
              <div className="flex justify-between text-muted-foreground">
                <span>{a.provider}{a.width ? ` · ${a.width}×${a.height}` : ""}{a.durationMs ? ` · ${Math.round(a.durationMs / 1000)}s` : ""}</span>
              </div>
              {a.author && <div className="truncate text-muted-foreground">Autor: {a.sourceUrl ? <a href={a.sourceUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">{a.author}</a> : a.author}</div>}
              <div className="line-clamp-2 text-muted-foreground/80" title={a.license ?? ""}>{a.license}</div>
              <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-destructive hover:text-destructive" onClick={() => setDel(a)}><Trash2 /> Eliminar</Button>
            </div>
          </div>
        ))}
      </div>
      <AlertDialog open={!!del} onOpenChange={(o) => !o && setDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este recurso?</AlertDialogTitle>
            <AlertDialogDescription>Se borra el archivo y su registro. Las escenas que lo usaban quedarán sin recurso asignado.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction disabled={pending} className="bg-destructive text-white hover:bg-destructive/90" onClick={() => del && start(async () => {
              const res = await deleteAssetAction(del.id);
              if (res.ok) { toast.success("Recurso eliminado"); router.refresh(); } else toast.error(res.error);
              setDel(null);
            })}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
