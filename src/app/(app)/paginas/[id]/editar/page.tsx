import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { getPage } from "@/lib/services/pages";
import { getIntegrationStatus } from "@/lib/integrations/status";
import { PageForm } from "../../page-form";

export const metadata: Metadata = { title: "Editar página" };

export default async function EditPageRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = await getPage(id);
  if (!page) notFound();
  const openai = getIntegrationStatus().find((i) => i.key === "openai")!.configured;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={`Editar ${page.name}`} />
      <PageForm
        pageId={page.id}
        openaiConfigured={openai}
        defaults={{
          name: page.name, description: page.description, topic: page.topic,
          targetAudience: page.targetAudience ?? "", language: page.language, targetCountry: page.targetCountry ?? "",
          timezone: page.timezone, tone: page.tone ?? "", growthGoals: page.growthGoals ?? "",
          profileImageUrl: page.profileImageUrl ?? "", visualIdentity: page.visualIdentity ?? "",
          primaryColor: page.primaryColor ?? "#4f46e5", secondaryColor: page.secondaryColor ?? "#7c3aed",
          isActive: page.isActive, bibleVerses: page.bibleVerses, facebookPageId: page.facebookPageId ?? "",
        }}
      />
    </div>
  );
}
