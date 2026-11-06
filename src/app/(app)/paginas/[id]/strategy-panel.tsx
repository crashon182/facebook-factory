"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2, Pencil, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FORMAT_LABELS } from "@/lib/constants";
import type { Strategy } from "@/lib/validation/strategy";
import { generateStrategyAction, restoreStrategyAction, saveStrategyAction } from "../strategy-actions";

export type VersionRow = { id: string; version: number; status: string; source: string; model: string | null; notes: string | null; createdAt: string };

const WEEKDAY: Record<string, string> = { MON: "Lun", TUE: "Mar", WED: "Mié", THU: "Jue", FRI: "Vie", SAT: "Sáb", SUN: "Dom" };

export function GenerateStrategyButton({ pageId, configured, hasStrategy, size }: { pageId: string; configured: boolean; hasStrategy: boolean; size?: "sm" | "default" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const t = toast.loading("Generando estrategia con IA… puede tardar hasta un minuto");
      const res = await generateStrategyAction(pageId);
      toast.dismiss(t);
      if (res.ok) {
        toast.success(`Estrategia v${res.data.version} generada`);
        router.refresh();
      } else toast.error(res.error);
    });
  const btn = (
    <Button type="button" size={size} onClick={run} disabled={!configured || pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
      {hasStrategy ? "REGENERAR ESTRATEGIA CON IA" : "GENERAR ESTRATEGIA CON IA"}
    </Button>
  );
  if (configured) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild><span>{btn}</span></TooltipTrigger>
      <TooltipContent>Requiere OPENAI_API_KEY en el entorno.</TooltipContent>
    </Tooltip>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{title}</h4>
      <div className="text-sm text-muted-foreground">{children}</div>
    </div>
  );
}
const Chips = ({ items }: { items: string[] }) => (
  <div className="flex flex-wrap gap-1.5">{items.map((k, i) => <Badge key={i} variant="secondary" className="font-normal">{k}</Badge>)}</div>
);
const Bullets = ({ items }: { items: string[] }) => <ul className="list-disc space-y-1 pl-5">{items.map((k, i) => <li key={i}>{k}</li>)}</ul>;

function StrategyView({ s }: { s: Strategy }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Descripción editorial">{s.editorialDescription}</Section>
      <Section title="Público objetivo">{s.targetAudience}</Section>
      <Section title="Tono de comunicación">{s.tone}</Section>
      <Section title="Estilo visual recomendado">{s.visualStyle}</Section>
      <Section title="Categorías de contenido">
        <ul className="space-y-2">
          {s.categories.map((c, i) => (
            <li key={i}><span className="font-medium text-foreground">{c.name}</span> <Badge variant="outline" className="ml-1">peso {c.weight}</Badge><br />{c.description}</li>
          ))}
        </ul>
      </Section>
      <Section title="Temáticas principales"><Chips items={s.mainThemes} /></Section>
      <Section title="Palabras clave"><Chips items={s.keywords} /></Section>
      <Section title="Formatos recomendados">
        <ul className="space-y-1.5">
          {s.recommendedFormats.map((f, i) => (
            <li key={i}><span className="font-medium text-foreground">{FORMAT_LABELS[f.format]}</span> · {f.weeklyFrequency}/semana — {f.rationale}</li>
          ))}
        </ul>
      </Section>
      <Section title="Ideas iniciales de publicaciones">
        <ul className="space-y-1.5">
          {s.initialIdeas.map((i, k) => (
            <li key={k}><span className="font-medium text-foreground">{i.title}</span> <Badge variant="outline">{FORMAT_LABELS[i.format]}</Badge> — {i.summary}</li>
          ))}
        </ul>
      </Section>
      <Section title="Calendario editorial sugerido">
        <ul className="space-y-1">
          {s.editorialCalendar.map((c, i) => (
            <li key={i}><span className="font-medium text-foreground">{WEEKDAY[c.weekday]}</span> · {FORMAT_LABELS[c.format]} · {c.category}{c.note ? ` — ${c.note}` : ""}</li>
          ))}
        </ul>
      </Section>
      <Section title="Hipótesis de horarios (a validar con datos)">
        <ul className="space-y-1.5">
          {s.postingTimeHypotheses.map((h, i) => (
            <li key={i}><span className="font-medium text-foreground">{h.days.map((d) => WEEKDAY[d]).join(", ")} {h.timeLocal}</span> — {h.rationale}</li>
          ))}
        </ul>
      </Section>
      <Section title="Objetivos medibles">
        <ul className="space-y-1">
          {s.measurableGoals.map((g, i) => <li key={i}><span className="font-medium text-foreground">{g.metric}:</span> {g.target} <span className="text-xs">({g.horizonDays} días)</span></li>)}
        </ul>
      </Section>
      <Section title="Reglas para evitar contenido repetido"><Bullets items={s.repetitionRules} /></Section>
      <Section title="Recomendaciones para interacciones genuinas"><Bullets items={s.engagementRecommendations} /></Section>
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm lg:col-span-2">
        <span className="font-medium text-foreground">Importante: </span>{s.caveats}
      </div>
    </div>
  );
}

const LIST_FIELDS = [
  ["mainThemes", "Temáticas principales"], ["keywords", "Palabras clave"], ["repetitionRules", "Reglas anti-repetición"], ["engagementRecommendations", "Recomendaciones de interacción"],
] as const;
const TEXT_FIELDS = [
  ["editorialDescription", "Descripción editorial"], ["targetAudience", "Público objetivo"], ["tone", "Tono"], ["visualStyle", "Estilo visual"], ["caveats", "Advertencias / hipótesis"],
] as const;
const JSON_FIELDS = [
  ["categories", "Categorías (JSON)"], ["recommendedFormats", "Formatos recomendados (JSON)"], ["initialIdeas", "Ideas iniciales (JSON)"],
  ["editorialCalendar", "Calendario editorial (JSON)"], ["postingTimeHypotheses", "Hipótesis de horarios (JSON)"], ["measurableGoals", "Objetivos medibles (JSON)"],
] as const;

function StrategyEditor({ pageId, s, onClose }: { pageId: string; s: Strategy; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const [k] of TEXT_FIELDS) v[k] = s[k];
    for (const [k] of LIST_FIELDS) v[k] = s[k].join("\n");
    for (const [k] of JSON_FIELDS) v[k] = JSON.stringify(s[k], null, 2);
    return v;
  });
  const set = (k: string, val: string) => setValues((p) => ({ ...p, [k]: val }));

  function save() {
    const obj: Record<string, unknown> = {};
    for (const [k] of TEXT_FIELDS) obj[k] = values[k];
    for (const [k] of LIST_FIELDS) obj[k] = values[k].split("\n").map((x) => x.trim()).filter(Boolean);
    for (const [k, label] of JSON_FIELDS) {
      try { obj[k] = JSON.parse(values[k]); } catch { toast.error(`JSON inválido en «${label}»`); return; }
    }
    start(async () => {
      const res = await saveStrategyAction(pageId, obj);
      if (res.ok) { toast.success(`Guardada como v${res.data.version}`); onClose(); router.refresh(); }
      else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">Al guardar se crea una nueva versión; la anterior queda en el historial y podés restaurarla.</p>
      {TEXT_FIELDS.map(([k, label]) => (
        <div key={k} className="space-y-1.5"><Label>{label}</Label><Textarea rows={3} value={values[k]} onChange={(e) => set(k, e.target.value)} /></div>
      ))}
      {LIST_FIELDS.map(([k, label]) => (
        <div key={k} className="space-y-1.5"><Label>{label} (una por línea)</Label><Textarea rows={5} value={values[k]} onChange={(e) => set(k, e.target.value)} /></div>
      ))}
      {JSON_FIELDS.map(([k, label]) => (
        <div key={k} className="space-y-1.5"><Label>{label}</Label><Textarea rows={8} className="font-mono text-xs" value={values[k]} onChange={(e) => set(k, e.target.value)} /></div>
      ))}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={pending}><X /> Cancelar</Button>
        <Button onClick={save} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Guardar nueva versión</Button>
      </div>
    </div>
  );
}

export function StrategyPanel({ pageId, strategy, activeVersion, versions, configured }: { pageId: string; strategy: Strategy | null; activeVersion: number | null; versions: VersionRow[]; configured: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  function restore(id: string) {
    start(async () => {
      const res = await restoreStrategyAction(pageId, id);
      if (res.ok) { toast.success(`Restaurada como v${res.data.version}`); router.refresh(); } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Estrategia editorial {activeVersion && <Badge variant="outline" className="ml-2">v{activeVersion}</Badge>}</CardTitle>
            <CardDescription>Generada con IA y editable. Los horarios y objetivos son hipótesis, no garantías de resultados.</CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {strategy && !editing && <Button variant="outline" onClick={() => setEditing(true)}><Pencil /> Editar</Button>}
            <GenerateStrategyButton pageId={pageId} configured={configured} hasStrategy={!!strategy} />
          </div>
        </CardHeader>
        <CardContent>
          {!strategy ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {configured ? "Esta página todavía no tiene estrategia. Generala con IA a partir de sus datos." : "Esta página todavía no tiene estrategia y OpenAI no está configurado (falta OPENAI_API_KEY)."}
            </p>
          ) : editing ? (
            <StrategyEditor pageId={pageId} s={strategy} onClose={() => setEditing(false)} />
          ) : (
            <StrategyView s={strategy} />
          )}
        </CardContent>
      </Card>

      {versions.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><History className="size-4" /> Historial de versiones</CardTitle></CardHeader>
          <CardContent>
            <ul className="divide-y">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <Badge variant={v.status === "ACTIVE" ? "default" : "outline"}>v{v.version}</Badge>
                  <span className="flex-1 text-muted-foreground">
                    {v.source === "AI" ? "IA" : "Manual"}{v.model ? ` · ${v.model}` : ""}{v.notes ? ` · ${v.notes}` : ""} · {new Date(v.createdAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  {v.status !== "ACTIVE" && (
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => restore(v.id)}><RotateCcw /> Restaurar</Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
