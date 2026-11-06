"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FORMAT_LABELS, POST_STATUS_LABELS } from "@/lib/constants";

export function ContentFilters({ pages }: { pages: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    next.delete("page");
    router.replace(`${pathname}?${next.toString()}`);
  }
  useEffect(() => {
    const t = setTimeout(() => { if ((params.get("q") ?? "") !== q) update("q", q.trim()); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sel = (key: string, placeholder: string, options: [string, string][], width = "sm:w-44") => (
    <Select value={params.get(key) ?? "all"} onValueChange={(v) => update(key, v)}>
      <SelectTrigger className={`w-full ${width}`}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{placeholder}</SelectItem>
        {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, tema o texto…" className="pl-9" aria-label="Buscar contenidos" />
      </div>
      {sel("pageId", "Todas las páginas", pages.map((p) => [p.id, p.name]), "sm:w-52")}
      {sel("status", "Todos los estados", Object.entries(POST_STATUS_LABELS))}
      {sel("format", "Todos los formatos", Object.entries(FORMAT_LABELS))}
    </div>
  );
}
