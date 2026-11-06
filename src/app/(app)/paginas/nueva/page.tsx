import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { getIntegrationStatus } from "@/lib/integrations/status";
import { PageForm } from "../page-form";

export const metadata: Metadata = { title: "Nueva página" };

export default function NewPageRoute() {
  const openai = getIntegrationStatus().find((i) => i.key === "openai")!.configured;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Nueva página" description="Definí la identidad editorial de una nueva página de trabajo." />
      <PageForm openaiConfigured={openai} />
    </div>
  );
}
