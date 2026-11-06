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
import { prisma } from "@/lib/db";
import { getTTSProvider } from "@/lib/integrations/tts";
import { listRenders } from "@/lib/services/renders";
import { isEditable } from "@/lib/services/content-status";
import { ContentEditor } from "./editor";
import { ImagePanel } from "./image-panel";
import { ReelPanel } from "./reel-panel";
import { ProgramPanel } from "./program-panel";
import { suggestedLocalInput, toLocalInput } from "@/lib/time/tz";

export const metadata: Metadata = { title: "Editar contenido" };

export default async function ContentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ programar?: string }> }) {
  const { id } = await params;
  const { programar } = await searchParams;
  const post = await getContent(id);
  if (!post) notFound();
  const isReel = post.format === "REEL";
  const isImage = post.format === "QUOTE_IMAGE" || post.format === "IMAGE";
  const [library, renders, images] = await Promise.all([
    isReel || isImage ? prisma.mediaAsset.findMany({ where: { type: { in: ["PHOTO", "VIDEO", "AUDIO"] } }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, type: true, title: true, durationMs: true, provider: true, externalId: true } }) : [],
    isReel ? listRenders(post.id) : [],
    isImage ? prisma.mediaAsset.findMany({ where: { postId: post.id, type: "RENDERED_IMAGE" }, orderBy: { createdAt: "desc" }, take: 6 }) : [],
  ]);
  const libRows = library.map((a) => ({ id: a.id, type: a.type, durationMs: a.durationMs, title: a.title ?? `${a.provider} ${a.externalId ?? a.id.slice(0, 6)}` }));
  const blockedReason = !getTTSProvider() ? "Falta configurar la narración (OPENAI_API_KEY)." : !process.env.REDIS_URL ? "Falta REDIS_URL." : post.scenes.length === 0 ? "El Reel no tiene escenas." : null;
  const schedule = await prisma.publicationSchedule.findUnique({ where: { postId: post.id }, select: { status: true } });
  const rule = await prisma.automationRule.findUnique({ where: { pageId: post.pageId }, select: { requireApproval: true } });
  const defaultLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(programar ?? "") ? programar! : post.scheduledAt ? toLocalInput(post.scheduledAt, post.page.timezone) : suggestedLocalInput(post.page.timezone);
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
      <div className="mt-6 space-y-6">
        {["READY", "SCHEDULED", "PUBLISHING", "PUBLISHED", "FAILED"].includes(post.status) && (
          <ProgramPanel
            key={`${post.updatedAt.toISOString()}-${programar ?? ""}`}
            info={{
              postId: post.id, pageId: post.pageId, tz: post.page.timezone, status: post.status, approved: post.approved, requireApproval: rule?.requireApproval ?? true,
              connection: post.page.connectionStatus, scheduledAtIso: post.scheduledAt?.toISOString() ?? null, publishedAtIso: post.publishedAt?.toISOString() ?? null,
              facebookPostId: post.facebookPostId, scheduleStatus: schedule?.status ?? null, failureReason: post.failureReason, defaultLocal,
            }}
          />
        )}
        {isReel && (
          <ReelPanel
            postId={post.id}
            ready={!blockedReason}
            blockedReason={blockedReason}
            library={libRows}
            initial={renders.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))}
            scenes={post.scenes.map((s) => ({ id: s.id, sceneOrder: s.sceneOrder, narration: s.narration, visualKeywords: Array.isArray(s.visualKeywords) ? (s.visualKeywords as string[]) : [], mediaAssetId: s.mediaAssetId }))}
          />
        )}
        {isImage && (
          <ImagePanel
            postId={post.id}
            editable={isEditable(post.status as PostStatus)}
            defaultText={post.imageText ?? ""}
            photos={libRows.filter((a) => a.type === "PHOTO").map((a) => ({ id: a.id, title: a.title }))}
            images={images.map((i) => ({ id: i.id, path: i.localPath!, title: i.title }))}
          />
        )}
      </div>
    </>
  );
}
