import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { PostStatusBadge } from "@/components/shared/content-badges";
import { Badge } from "@/components/ui/badge";
import { FORMAT_LABELS } from "@/lib/constants";
import { getContent } from "@/lib/services/contents";
import type { PostStatus } from "@/lib/services/content-status";
import { ContentEditor } from "./editor";

export const metadata: Metadata = { title: "Editar contenido" };

export default async function ContentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = await getContent(id);
  if (!post) notFound();
  const tags = Array.isArray(post.hashtags) ? (post.hashtags as string[]) : [];

  return (
    <>
      <Link href="/contenidos" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Contenidos</Link>
      <PageHeader title={post.internalTitle} description={`${post.page.name} · ${FORMAT_LABELS[post.format]}`} />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <PostStatusBadge status={post.status} />
        {post.approved && <Badge variant="outline" className="border-success/30 text-success">Aprobado</Badge>}
        <span className="text-xs text-muted-foreground">Creado {post.createdAt.toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" })}</span>
      </div>
      <ContentEditor
        key={post.updatedAt.toISOString()}
        post={{
          id: post.id, status: post.status as PostStatus, approved: post.approved, format: post.format, internalTitle: post.internalTitle,
          topic: post.topic ?? "", body: post.body ?? "", facebookCaption: post.facebookCaption ?? "", script: post.script ?? "", hashtags: tags,
          failureReason: post.failureReason,
          scenes: post.scenes.map((s) => ({ id: s.id, sceneOrder: s.sceneOrder, narration: s.narration, visualKeywords: Array.isArray(s.visualKeywords) ? (s.visualKeywords as string[]) : [] })),
        }}
      />
    </>
  );
}
