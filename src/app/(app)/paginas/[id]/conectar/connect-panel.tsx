"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PlugZap, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { connectFacebookPageAction, disconnectFacebookPageAction, verifyFacebookConnectionAction } from "../../meta-actions";

export type PendingPage = { id: string; name: string; category: string | null; canPublish: boolean };

export function ChoosePages({ pageId, pages }: { pageId: string; pages: PendingPage[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  async function connect(fbId: string) {
    setBusy(fbId);
    const res = await connectFacebookPageAction(pageId, fbId);
    setBusy(null);
    if (res.ok) { toast.success(`Conectada: ${res.data.name ?? "Página de Facebook"}`); router.replace(`/paginas/${pageId}/conectar`); router.refresh(); }
    else toast.error(res.error);
  }
  return (
    <ul className="divide-y rounded-lg border">
      {pages.map((p) => (
        <li key={p.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{p.name}</div>
            <div className="text-xs text-muted-foreground">ID {p.id}{p.category ? ` · ${p.category}` : ""}</div>
          </div>
          {!p.canPublish && <Badge variant="outline" className="border-warning/40 text-warning">Sin permiso para publicar</Badge>}
          <Button size="sm" disabled={!p.canPublish || busy !== null} onClick={() => connect(p.id)}>
            {busy === p.id ? <Loader2 className="animate-spin" /> : <PlugZap />} Conectar
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function ConnectionActions({ pageId }: { pageId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(okMsg); router.refresh(); } else toast.error(r.error ?? "Error");
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={pending} onClick={() => run(() => verifyFacebookConnectionAction(pageId), "Conexión verificada")}>
        {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verificar conexión
      </Button>
      <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => run(() => disconnectFacebookPageAction(pageId), "Página desconectada")}>
        <Unplug /> Desconectar
      </Button>
    </div>
  );
}
