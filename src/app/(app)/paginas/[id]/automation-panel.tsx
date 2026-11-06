"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { automationSchema, type AutomationValues } from "@/lib/validation/page";
import { saveAutomationAction } from "../actions";

type ToggleName = "enabled" | "requireApproval" | "autoPublish" | "autoOptimizeTimes";

function Toggle({ control, name, label, hint }: { control: Control<AutomationValues>; name: ToggleName; label: string; hint: string }) {
  return (
    <Controller control={control} name={name} render={({ field }) => (
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-0.5">
          <Label>{label}</Label>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Switch checked={field.value} onCheckedChange={field.onChange} />
      </div>
    )} />
  );
}

export function AutomationPanel({ pageId, defaults, paused }: { pageId: string; defaults: AutomationValues; paused: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { register, control, handleSubmit, formState: { errors } } = useForm<AutomationValues>({
    resolver: zodResolver(automationSchema),
    defaultValues: defaults,
  });

  const onSubmit = handleSubmit((v) =>
    start(async () => {
      const res = await saveAutomationAction(pageId, v);
      if (res.ok) {
        toast.success("Configuración de automatización guardada");
        router.refresh();
      } else toast.error(res.error);
    }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {paused && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          La pausa global está activa: ninguna automatización se ejecutará aunque esté habilitada aquí.
        </p>
      )}
      <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
        Estas reglas se guardan ahora; los workers que las ejecutan (generación, renderizado, publicación) se implementan en las Fases 2 a 5.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle control={control} name="enabled" label="Automatización activada" hint="Permite que el sistema prepare contenido para esta página." />
        <Toggle control={control} name="requireApproval" label="Aprobación manual obligatoria" hint="Nada se programa sin tu aprobación." />
        <Toggle control={control} name="autoPublish" label="Publicación automática" hint="Publica los contenidos aprobados en su horario." />
        <Toggle control={control} name="autoOptimizeTimes" label="Optimización automática de horarios" hint="Ajustes graduales y reversibles propuestos por la IA." />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="maxPostsPerDay">Máx. publicaciones por día</Label>
          <Input id="maxPostsPerDay" type="number" min={1} max={20} {...register("maxPostsPerDay", { valueAsNumber: true })} />
          {errors.maxPostsPerDay && <p className="text-xs text-destructive">Entre 1 y 20</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="daysAhead">Días de contenido anticipado</Label>
          <Input id="daysAhead" type="number" min={1} max={30} {...register("daysAhead", { valueAsNumber: true })} />
          {errors.daysAhead && <p className="text-xs text-destructive">Entre 1 y 30</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dailyBudgetUsd">Presupuesto diario IA (USD)</Label>
          <Input id="dailyBudgetUsd" type="number" step="0.01" min={0} {...register("dailyBudgetUsd", { valueAsNumber: true })} />
          {errors.dailyBudgetUsd && <p className="text-xs text-destructive">Valor inválido</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="windowStart">Franja desde</Label>
          <Input id="windowStart" type="time" {...register("windowStart")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="windowEnd">Franja hasta</Label>
          <Input id="windowEnd" type="time" {...register("windowEnd")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="editorialRestrictions">Restricciones editoriales</Label>
        <Textarea id="editorialRestrictions" rows={2} placeholder="Temas o expresiones a evitar…" {...register("editorialRestrictions")} />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Guardar</Button>
      </div>
    </form>
  );
}
