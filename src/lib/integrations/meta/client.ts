import { createHmac } from "node:crypto";
import { openAsBlob } from "node:fs";
import path from "node:path";
import { getMetaConfig, type MetaConfig } from "./config";
import { MetaApiError, MetaNetworkError } from "./errors";

export type MetaPage = { id: string; name: string; category: string | null; accessToken: string; tasks: string[] };
export type ReelStatus = {
  videoStatus: string | null;       // uploading | upload_complete | processing | ready | error | expired | upload_failed
  publishStatus: string | null;     // draft | scheduled | published | error
  errors: string[];
};
export type RecentPost = { id: string; message: string | null; createdTime: string | null };

/** appsecret_proof = HMAC-SHA256(access_token, app_secret) en hex (https://developers.facebook.com/docs/graph-api/securing-requests). */
export function appSecretProof(token: string, secret: string) {
  return createHmac("sha256", secret).update(token).digest("hex");
}

/** Cliente mínimo de Graph API: solo endpoints documentados. Los tokens nunca se registran ni van en mensajes de error. */
export class MetaClient {
  constructor(private readonly cfg: MetaConfig, private readonly fetchImpl: typeof fetch = fetch) {}

  static fromEnv(fetchImpl?: typeof fetch) {
    const cfg = getMetaConfig();
    if (!cfg) throw new Error("Meta no está configurado: definí META_APP_ID y META_APP_SECRET.");
    return new MetaClient(cfg, fetchImpl);
  }

  get version() {
    return this.cfg.version;
  }

  private url(p: string, params: Record<string, string | number | undefined> = {}, token?: string) {
    const u = new URL(`${this.cfg.graphBase}/${this.cfg.version}/${p.replace(/^\/+/, "")}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
    if (token) {
      u.searchParams.set("access_token", token);
      u.searchParams.set("appsecret_proof", appSecretProof(token, this.cfg.appSecret));
    }
    return u;
  }

  private async call<T>(url: URL | string, init: RequestInit, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new MetaNetworkError("No se pudo completar la comunicación con Meta (red o tiempo de espera).");
    }
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const err = (body as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } } | null)?.error;
    if (!res.ok || err) {
      throw new MetaApiError(sanitize(err?.message ?? `HTTP ${res.status}`), err?.code, err?.error_subcode, res.status, err?.fbtrace_id);
    }
    return body as T;
  }

  private get<T>(p: string, params: Record<string, string | number | undefined>, token?: string) {
    return this.call<T>(this.url(p, params, token), { method: "GET" });
  }
  private postJson<T>(p: string, token: string, body: Record<string, unknown>, timeoutMs?: number) {
    return this.call<T>(this.url(p, {}, token), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, timeoutMs);
  }

  // ───── OAuth ─────
  authorizeUrl(state: string) {
    const u = new URL(`https://www.facebook.com/${this.cfg.version}/dialog/oauth`);
    u.searchParams.set("client_id", this.cfg.appId);
    u.searchParams.set("redirect_uri", this.cfg.redirectUri);
    u.searchParams.set("state", state);
    u.searchParams.set("scope", this.cfg.scopes.join(","));
    u.searchParams.set("response_type", "code");
    return u.toString();
  }

  async exchangeCode(code: string): Promise<string> {
    const r = await this.get<{ access_token: string }>("oauth/access_token", { client_id: this.cfg.appId, client_secret: this.cfg.appSecret, redirect_uri: this.cfg.redirectUri, code });
    return r.access_token;
  }

  /** Token de usuario de ~60 días; con él, los tokens de Página no vencen por tiempo. */
  async exchangeLongLived(shortToken: string): Promise<string> {
    const r = await this.get<{ access_token: string }>("oauth/access_token", { grant_type: "fb_exchange_token", client_id: this.cfg.appId, client_secret: this.cfg.appSecret, fb_exchange_token: shortToken });
    return r.access_token;
  }

  async listPages(userToken: string): Promise<MetaPage[]> {
    const pages: MetaPage[] = [];
    let after: string | undefined;
    for (let i = 0; i < 5; i++) {
      const r = await this.get<{ data: { id: string; name: string; category?: string; access_token?: string; tasks?: string[] }[]; paging?: { cursors?: { after?: string }; next?: string } }>(
        "me/accounts", { fields: "id,name,category,access_token,tasks", limit: 100, after }, userToken,
      );
      for (const p of r.data) if (p.access_token) pages.push({ id: p.id, name: p.name, category: p.category ?? null, accessToken: p.access_token, tasks: p.tasks ?? [] });
      if (!r.paging?.next || !r.paging.cursors?.after) break;
      after = r.paging.cursors.after;
    }
    return pages;
  }

  getPage(pageId: string, pageToken: string) {
    return this.get<{ id: string; name: string }>(pageId, { fields: "id,name" }, pageToken);
  }

  // ───── Publicación ─────
  /** POST /{page-id}/feed → { id } */
  publishText(pageId: string, token: string, p: { message: string; link?: string }) {
    return this.postJson<{ id: string }>(`${pageId}/feed`, token, { message: p.message, ...(p.link ? { link: p.link } : {}), published: true });
  }

  /** POST /{page-id}/photos con el archivo local (multipart `source`) → { id, post_id } */
  async publishPhoto(pageId: string, token: string, p: { caption: string; filePath: string }) {
    const form = new FormData();
    form.set("caption", p.caption);
    form.set("published", "true");
    form.set("source", await openAsBlob(p.filePath), path.basename(p.filePath));
    return this.call<{ id: string; post_id?: string }>(this.url(`${pageId}/photos`, {}, token), { method: "POST", body: form }, 120_000);
  }

  /** Reels, fase 1: POST /{page-id}/video_reels {upload_phase:start} → { video_id, upload_url } */
  reelStart(pageId: string, token: string) {
    return this.postJson<{ video_id: string; upload_url: string }>(`${pageId}/video_reels`, token, { upload_phase: "start" });
  }

  /** Reels, fase 2: sube el binario a rupload.facebook.com (cabeceras Authorization: OAuth, offset, file_size). */
  async reelUpload(videoId: string, token: string, filePath: string, fileSize: number) {
    const blob = await openAsBlob(filePath);
    return this.call<{ success: boolean }>(`${this.cfg.uploadBase}/video-upload/${this.cfg.version}/${encodeURIComponent(videoId)}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(fileSize), "Content-Type": "application/octet-stream" },
      body: blob,
    }, 600_000);
  }

  /** Reels, fase 3: publica. */
  reelFinish(pageId: string, token: string, p: { videoId: string; description: string; title?: string }) {
    return this.postJson<{ success: boolean }>(`${pageId}/video_reels`, token, {
      upload_phase: "finish", video_id: p.videoId, video_state: "PUBLISHED", description: p.description, ...(p.title ? { title: p.title } : {}),
    });
  }

  async reelStatus(videoId: string, token: string): Promise<ReelStatus> {
    const r = await this.get<{ status?: { video_status?: string; uploading_phase?: { errors?: { message?: string }[] }; processing_phase?: { error?: { message?: string } }; publishing_phase?: { publish_status?: string } } }>(videoId, { fields: "status" }, token);
    const s = r.status;
    const errors = [...(s?.uploading_phase?.errors?.map((e) => e.message ?? "error de subida") ?? []), ...(s?.processing_phase?.error?.message ? [s.processing_phase.error.message] : [])];
    return { videoStatus: s?.video_status ?? null, publishStatus: s?.publishing_phase?.publish_status ?? null, errors };
  }

  /** GET /{page-id}/feed (para reconciliar publicaciones de texto/foto tras un resultado ambiguo). */
  async recentPosts(pageId: string, token: string, limit = 25): Promise<RecentPost[]> {
    const r = await this.get<{ data: { id: string; message?: string; created_time?: string }[] }>(`${pageId}/feed`, { fields: "id,message,created_time", limit }, token);
    return r.data.map((p) => ({ id: p.id, message: p.message ?? null, createdTime: p.created_time ?? null }));
  }
}

function sanitize(msg: string) {
  return msg.replace(/(access_token|appsecret_proof|client_secret|fb_exchange_token)=[^&\s"]+/g, "$1=***").replace(/EAA[A-Za-z0-9]{20,}/g, "EAA***").slice(0, 400);
}
