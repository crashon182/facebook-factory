import type { Metadata } from "next";
import { Construction } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";

export const metadata: Metadata = { title: "Analíticas" };

export default function Page() {
  return (
    <>
      <PageHeader title="Analíticas" description="Métricas, informes y optimización con IA" />
      <EmptyState icon={Construction} title="Se implementa en la Fase 6" description="Este módulo todavía no existe. El esquema de base de datos ya está preparado para recibirlo." />
    </>
  );
}
