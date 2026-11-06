"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LANGUAGES, TIMEZONES } from "@/lib/constants";
import { pageFormSchema, type PageFormInput, type PageFormValues } from "@/lib/validation/page";
import { savePageAction } from "./actions";
import { generateStrategyAction } from "./strategy-actions";

function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function PageForm({ pageId, defaults, openaiConfigured }: { pageId?: string; defaults?: Partial<PageFormInput>; openaiConfigured: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const form = useForm<PageFormInput, unknown, PageFormValues>({
    resolver: zodResolver(pageFormSchema),
    defaultValues: {
      name: "", description: "", topic: "", targetAudience: "", language: "es", targetCountry: "",
      timezone: "America/Argentina/Buenos_Aires", tone: "", growthGoals: "", profileImageUrl: "",
      visualIdentity: "", primaryColor: "#4f46e5", secondaryColor: "#7c3aed", isActive: true, facebookPageId: "",
      ...defaults,
    },
  });
  const { register, control, handleSubmit, formState: { errors }, setError } = form;
  const err = (k: keyof PageFormInput) => errors[k]?.message as string | undefined;

  function submitWith(generate: boolean) {
    return handleSubmit((values) => {
      start(async () => {
        const res = await savePageAction(pageId ?? null, values as PageFormInput);
        if (!res.ok) {
          if (res.fieldErrors) Object.entries(res.fieldErrors).forEach(([k, m]) => setError(k as keyof PageFormInput, { message: m[0] }));
          toast.error(res.error);
          return;
        }
        toast.success(pageId ? "Página actualizada" : "Página creada");
        if (generate) {
          const t = toast.loading("Generando estrategia con IA… puede tardar hasta un minuto");
          const g = await generateStrategyAction(res.data.id);
          toast.dismiss(t);
          if (g.ok) toast.success(`Estrategia v${g.data.version} generada`);
          else toast.error(g.error);
          router.push(`/paginas/${res.data.id}?tab=estrategia`);
        } else router.push(`/paginas/${res.data.id}`);
        router.refresh();
      });
    });
  }
  const onSubmit = submitWith(false);

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Información general</CardTitle>
          <CardDescription>Lo básico para identificar la página y su línea editorial.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Nombre *" error={err("name")} htmlFor="name">
            <Input id="name" placeholder="Citas Bíblicas para el Alma" {...register("name")} />
          </Field>
          <Field label="Temática *" error={err("topic")} htmlFor="topic">
            <Input id="topic" placeholder="Fe, esperanza y reflexión cristiana" {...register("topic")} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Descripción *" error={err("description")} htmlFor="description">
              <Textarea id="description" rows={3} placeholder="De qué trata la página y qué valor aporta a su audiencia." {...register("description")} />
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Objetivos de crecimiento" error={err("growthGoals")} htmlFor="growthGoals" hint="Ej.: llegar a 10.000 seguidores en 6 meses, aumentar compartidos.">
              <Textarea id="growthGoals" rows={2} {...register("growthGoals")} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audiencia y comunicación</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Público objetivo" error={err("targetAudience")} htmlFor="targetAudience">
              <Textarea id="targetAudience" rows={2} placeholder="Edad, intereses, motivaciones…" {...register("targetAudience")} />
            </Field>
          </div>
          <Field label="Tono de comunicación" error={err("tone")} htmlFor="tone">
            <Input id="tone" placeholder="Cálido, esperanzador, cercano" {...register("tone")} />
          </Field>
          <Field label="País objetivo" error={err("targetCountry")} htmlFor="targetCountry">
            <Input id="targetCountry" placeholder="Argentina, México, Latinoamérica…" {...register("targetCountry")} />
          </Field>
          <Field label="Idioma">
            <Controller control={control} name="language" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
          <Field label="Zona horaria" error={err("timezone")} hint="Los horarios se guardan en UTC y se muestran en esta zona.">
            <Controller control={control} name="timezone" render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            )} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identidad visual</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Field label="Descripción de la identidad visual" error={err("visualIdentity")} htmlFor="visualIdentity">
              <Textarea id="visualIdentity" rows={2} placeholder="Estilo fotográfico, tipografía, atmósfera…" {...register("visualIdentity")} />
            </Field>
          </div>
          <Field label="URL de la imagen de perfil" error={err("profileImageUrl")} htmlFor="profileImageUrl">
            <Input id="profileImageUrl" type="url" placeholder="https://…" {...register("profileImageUrl")} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Color principal" error={err("primaryColor")} htmlFor="primaryColor">
              <Controller control={control} name="primaryColor" render={({ field }) => (
                <Input id="primaryColor" type="color" className="h-9 p-1" value={field.value || "#4f46e5"} onChange={(e) => field.onChange(e.target.value)} />
              )} />
            </Field>
            <Field label="Color secundario" error={err("secondaryColor")} htmlFor="secondaryColor">
              <Controller control={control} name="secondaryColor" render={({ field }) => (
                <Input id="secondaryColor" type="color" className="h-9 p-1" value={field.value || "#7c3aed"} onChange={(e) => field.onChange(e.target.value)} />
              )} />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Facebook y estado</CardTitle>
          <CardDescription>La conexión OAuth con Meta se habilita en la Fase 4; mientras tanto podés registrar el Page ID.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Facebook Page ID" error={err("facebookPageId")} htmlFor="facebookPageId">
            <Input id="facebookPageId" inputMode="numeric" placeholder="123456789012345" {...register("facebookPageId")} />
          </Field>
          <Field label="Página activa">
            <Controller control={control} name="isActive" render={({ field }) => (
              <div className="flex h-9 items-center gap-3">
                <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                <span className="text-sm text-muted-foreground">{field.value ? "Activa" : "Inactiva"}</span>
              </div>
            )} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button type="button" variant="outline" disabled={!openaiConfigured || pending} onClick={submitWith(true)}>
                {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} GENERAR ESTRATEGIA CON IA
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {openaiConfigured ? "Guarda la página y genera su estrategia editorial con IA." : "Requiere OPENAI_API_KEY en el entorno."}
          </TooltipContent>
        </Tooltip>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />}
          {pageId ? "Guardar cambios" : "Crear página"}
        </Button>
      </div>
    </form>
  );
}
