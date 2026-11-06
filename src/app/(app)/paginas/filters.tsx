"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PageFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== q) update("q", q.trim());
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, temática o descripción…" className="pl-9" aria-label="Buscar páginas" />
      </div>
      <Select value={params.get("status") ?? "all"} onValueChange={(v) => update("status", v)}>
        <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas</SelectItem>
          <SelectItem value="active">Activas</SelectItem>
          <SelectItem value="inactive">Inactivas</SelectItem>
        </SelectContent>
      </Select>
      <Select value={params.get("connection") ?? "all"} onValueChange={(v) => update("connection", v)}>
        <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Conexión" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toda conexión</SelectItem>
          <SelectItem value="CONNECTED">Conectadas</SelectItem>
          <SelectItem value="NOT_CONNECTED">Sin conectar</SelectItem>
          <SelectItem value="EXPIRED">Token vencido</SelectItem>
          <SelectItem value="ERROR">Con error</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
