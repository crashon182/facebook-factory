export type PostStatus = "DRAFT" | "GENERATING" | "READY" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELLED";

const TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  DRAFT: ["GENERATING", "READY", "CANCELLED"],
  GENERATING: ["READY", "FAILED"],
  READY: ["GENERATING", "SCHEDULED", "CANCELLED", "DRAFT"],
  SCHEDULED: ["PUBLISHING", "READY", "CANCELLED"],
  PUBLISHING: ["PUBLISHED", "FAILED", "SCHEDULED"],
  PUBLISHED: [],
  FAILED: ["GENERATING", "READY", "DRAFT", "SCHEDULED", "CANCELLED"],
  CANCELLED: ["DRAFT"],
};

export function canTransition(from: PostStatus, to: PostStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** El contenido solo se edita/regenera mientras no esté en cola, publicándose o publicado. */
export const EDITABLE: PostStatus[] = ["DRAFT", "READY", "FAILED", "CANCELLED"];
export const DELETABLE: PostStatus[] = ["DRAFT", "READY", "FAILED", "CANCELLED"];
export const isEditable = (s: PostStatus) => EDITABLE.includes(s);
export const isDeletable = (s: PostStatus) => DELETABLE.includes(s);
export const isCancellable = (s: PostStatus) => canTransition(s, "CANCELLED");
