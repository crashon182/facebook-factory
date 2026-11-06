"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Eye, Trash2, Power, Bot } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { deletePageAction, setPageActiveAction, setPageAutomationAction } from "./actions";

export function PageRowActions({ id, name, isActive, automationEnabled }: { id: string; name: string; isActive: boolean; automationEnabled: boolean }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(okMsg);
        router.refresh();
      } else toast.error(res.error ?? "Error");
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Acciones de ${name}`} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild><Link href={`/paginas/${id}`}><Eye /> Ver detalle</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link href={`/paginas/${id}/editar`}><Pencil /> Editar</Link></DropdownMenuItem>
          <DropdownMenuItem onClick={() => run(() => setPageActiveAction(id, !isActive), isActive ? "Página desactivada" : "Página activada")}>
            <Power /> {isActive ? "Desactivar" : "Activar"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => run(() => setPageAutomationAction(id, !automationEnabled), automationEnabled ? "Automatización pausada" : "Automatización activada")}>
            <Bot /> {automationEnabled ? "Pausar automatización" : "Activar automatización"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setConfirm(true)}><Trash2 /> Eliminar</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán también sus estrategias, contenidos, programaciones y métricas. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => run(() => deletePageAction(id), "Página eliminada")}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
