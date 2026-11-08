"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--popover-foreground)", fontSize: 12 };
const axis = { fontSize: 12, fill: "var(--muted-foreground)" };

export function DailyChart({ data }: { data: { day: string; Vistas: number | null; Alcance: number | null }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ left: -8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="day" tick={axis} tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} minTickGap={24} />
        <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="Vistas" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} connectNulls />
        <Area type="monotone" dataKey="Alcance" stroke="var(--chart-3)" fill="var(--chart-3)" fillOpacity={0.15} connectNulls />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Índice de rendimiento (1 = mediana de la página). */
export function IndexBars({ data, xLabel }: { data: { name: string; Índice: number; Publicaciones: number }[]; xLabel?: string }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={axis} tickLine={false} axisLine={false} label={xLabel ? { value: xLabel, position: "insideBottom", offset: -2, fontSize: 11, fill: "var(--muted-foreground)" } : undefined} />
        <YAxis tick={axis} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <ReferenceLine y={1} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
        <Bar dataKey="Índice" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
