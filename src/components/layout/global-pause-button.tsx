"use client";

import { useState, useTransition } from "react";
import { Pause, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toggleGlobalPauseAction } from "@/app/(app)/actions";

export function GlobalPauseButton({ paused }: { paused: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      try {
        await toggleGlobalPauseAction(!paused);
        toast.success(paused ? "Automatizaciones reanudadas" : "Todas las automatizaciones fueron pausadas");
      } catch {
        toast.error("No se pudo cambiar el estado");
      }
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        variant={paused ? "default" : "outline"}
        size="sm"
        onClick={() => (paused ? run() : setOpen(true))}
        disabled={pending}
        className={paused ? "" : "border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"}
      >
        {pending ? <Loader2 className="animate-spin" /> : paused ? <Play /> : <Pause />}
        <span className="hidden sm:inline">{paused ? "REANUDAR AUTOMATIZACIONES" : "PAUSAR TODAS LAS AUTOMATIZACIONES"}</span>
        <span className="sm:hidden">{paused ? "Reanudar" : "Pausar"}</span>
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Pausar todas las automatizaciones?</AlertDialogTitle>
            <AlertDialogDescription>
              Se detendrá la generación y publicación automática en todas las páginas hasta que las reanudes. Los contenidos ya programados no se publicarán mientras la pausa esté activa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Pausar todo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
