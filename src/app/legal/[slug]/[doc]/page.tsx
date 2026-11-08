import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { buildLegalContent, isLegalDoc, LEGAL_LABELS } from "@/lib/legal";

export const dynamic = "force-dynamic";

type Params = { slug: string; doc: string };

async function load({ slug, doc }: Params) {
  if (!isLegalDoc(doc)) return null;
  // Público: solo se expone el nombre de la Página, nunca otros datos.
  const page = await prisma.socialPage.findUnique({ where: { slug }, select: { name: true, updatedAt: true } });
  if (!page) return null;
  const contactEmail = process.env.LEGAL_CONTACT_EMAIL || process.env.ADMIN_EMAIL || "";
  const updated = page.updatedAt.toLocaleDateString("es-AR", { dateStyle: "long" });
  return { doc, content: buildLegalContent(doc, { pageName: page.name, contactEmail, updated }) };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  return { title: isLegalDoc(p.doc) ? LEGAL_LABELS[p.doc] : "Documento", robots: { index: true, follow: true } };
}

export default async function LegalPage({ params }: { params: Promise<Params> }) {
  const data = await load(await params);
  if (!data) notFound();
  const { content } = data;
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{content.title}</h1>
      <p className="mt-4 text-muted-foreground">{content.intro}</p>
      {content.sections.map((s) => (
        <section key={s.heading} className="mt-8">
          <h2 className="text-xl font-semibold">{s.heading}</h2>
          {s.paragraphs?.map((t, i) => <p key={i} className="mt-3 leading-relaxed">{t}</p>)}
          {s.list && <ul className="mt-3 list-disc space-y-1.5 pl-6 leading-relaxed">{s.list.map((t, i) => <li key={i}>{t}</li>)}</ul>}
        </section>
      ))}
    </main>
  );
}
