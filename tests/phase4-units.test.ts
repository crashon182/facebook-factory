import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { addDaysKey, dayKey, formatInTz, localToUtc, parseLocalInput, startOfDayUtc, toLocalInput, tzOffsetMs, weekdayOfKey } from "@/lib/time/tz";
import { candidateTimes, planSlots } from "@/lib/scheduling/plan";
import { composeMessage, idempotencyKey, matchesAttempt, publishKindFor } from "@/lib/integrations/meta/compose";
import { classifyMetaError, MetaApiError, MetaNetworkError } from "@/lib/integrations/meta/errors";
import { appSecretProof, MetaClient } from "@/lib/integrations/meta/client";
import { getMetaConfig, type MetaConfig } from "@/lib/integrations/meta/config";
import { verifyChallenge, verifySignature } from "@/lib/integrations/meta/webhook";
import { createOAuthState, readOAuthState } from "@/lib/integrations/meta/oauth-state";

describe("zonas horarias", () => {
  it("convierte hora local ↔ UTC con distintos desfases", () => {
    expect(localToUtc({ y: 2026, m: 11, d: 6, h: 9, mi: 0 }, "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-11-06T12:00:00.000Z");
    expect(localToUtc({ y: 2026, m: 11, d: 6, h: 9, mi: 0 }, "UTC").toISOString()).toBe("2026-11-06T09:00:00.000Z");
    expect(localToUtc({ y: 2026, m: 7, d: 1, h: 9, mi: 0 }, "Europe/Madrid").toISOString()).toBe("2026-07-01T07:00:00.000Z"); // verano +2
    expect(localToUtc({ y: 2026, m: 1, d: 1, h: 9, mi: 0 }, "Europe/Madrid").toISOString()).toBe("2026-01-01T08:00:00.000Z"); // invierno +1
    expect(tzOffsetMs(new Date("2026-11-06T12:00:00Z"), "America/Mexico_City")).toBe(-6 * 3600_000);
  });
  it("maneja el cambio de horario (DST) sin perder la hora local", () => {
    const d = localToUtc({ y: 2026, m: 10, d: 25, h: 12, mi: 0 }, "Europe/Madrid"); // día del cambio a invierno
    expect(toLocalInput(d, "Europe/Madrid")).toBe("2026-10-25T12:00");
    const spring = localToUtc({ y: 2026, m: 3, d: 29, h: 2, mi: 30 }, "Europe/Madrid"); // hora inexistente → pasa a la siguiente válida
    expect(toLocalInput(spring, "Europe/Madrid")).toMatch(/^2026-03-29T0[34]:/);
  });
  it("ida y vuelta con datetime-local y validación", () => {
    const d = parseLocalInput("2026-11-06T21:30", "America/Bogota");
    expect(d.toISOString()).toBe("2026-11-07T02:30:00.000Z");
    expect(toLocalInput(d, "America/Bogota")).toBe("2026-11-06T21:30");
    expect(() => parseLocalInput("2026-02-30T10:00", "UTC")).toThrow();
    expect(() => parseLocalInput("2026-11-06T25:00", "UTC")).toThrow();
    expect(() => parseLocalInput("hola", "UTC")).toThrow();
  });
  it("días de calendario", () => {
    expect(dayKey(new Date("2026-11-07T02:30:00Z"), "America/Bogota")).toBe("2026-11-06");
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOfKey("2026-11-06")).toBe(5); // viernes
    expect(startOfDayUtc("2026-11-06", "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(formatInTz(new Date("2026-11-06T12:00:00Z"), "UTC", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })).toBe("12:00");
  });
});

describe("planificador de horarios", () => {
  const base = { tz: "America/Argentina/Buenos_Aires", now: new Date("2026-11-06T12:00:00Z"), hypotheses: [] as { days: string[]; timeLocal: string }[], windowStart: "09:00", windowEnd: "21:00", maxPerDay: 1 };
  it("sin hipótesis reparte dentro de la franja y respeta el máximo diario", () => {
    expect(candidateTimes(1, { ...base, maxPerDay: 3 })).toEqual(["09:00", "15:00", "21:00"]);
    expect(candidateTimes(1, { ...base, maxPerDay: 1 })).toEqual(["15:00"]);
    const slots = planSlots({ ...base, count: 3, maxPerDay: 1 });
    expect(slots).toHaveLength(3);
    expect(new Set(slots.map((s) => dayKey(s, base.tz))).size).toBe(3); // un día cada uno
    for (const s of slots) expect(s.getTime()).toBeGreaterThan(base.now.getTime());
  });
  it("usa las hipótesis de la estrategia por día de la semana y respeta días permitidos", () => {
    const hyp = [{ days: ["MON", "WED"], timeLocal: "08:30" }, { days: ["MON"], timeLocal: "19:00" }];
    expect(candidateTimes(1, { ...base, hypotheses: hyp, maxPerDay: 2, windowStart: "08:00" })).toEqual(["08:30", "19:00"]);
    const slots = planSlots({ ...base, hypotheses: hyp, windowStart: "08:00", maxPerDay: 2, count: 4, publishDays: [1, 3] });
    expect(slots.map((s) => weekdayOfKey(dayKey(s, base.tz)))).toEqual([1, 1, 3, 1]); // el miércoles solo tiene un horario en la estrategia
  });
  it("descuenta lo ya programado, respeta el margen mínimo y no pasa de la franja", () => {
    const first = planSlots({ ...base, count: 1 })[0];
    const taken = planSlots({ ...base, count: 1, existing: { [dayKey(first, base.tz)]: 1 } })[0];
    expect(dayKey(taken, base.tz)).not.toBe(dayKey(first, base.tz));
    const late = planSlots({ ...base, now: new Date("2026-11-06T23:50:00Z"), count: 1 })[0]; // 20:50 local: el slot de las 15:00 ya pasó
    expect(dayKey(late, base.tz)).toBe("2026-11-07");
    for (const t of candidateTimes(2, { ...base, maxPerDay: 4 })) expect(t >= "09:00" && t <= "21:00").toBe(true);
  });
});

describe("composición y coincidencia", () => {
  it("compone texto con hashtags limpios y respeta el tope", () => {
    expect(composeMessage({ facebookCaption: " Hola ", hashtags: ["#fe", " paz ", "a b"] })).toBe("Hola\n\n#fe #paz #ab");
    expect(composeMessage({ facebookCaption: "", body: "Cuerpo", hashtags: null })).toBe("Cuerpo");
    expect(composeMessage({ facebookCaption: "x".repeat(6000) })).toHaveLength(5000);
    expect(composeMessage({})).toBe("");
  });
  it("elige el tipo de publicación por formato", () => {
    expect(["TEXT", "REFLECTION", "SHORT_STORY"].map(publishKindFor)).toEqual(["text", "text", "text"]);
    expect(["IMAGE", "QUOTE_IMAGE"].map(publishKindFor)).toEqual(["photo", "photo"]);
    expect(publishKindFor("REEL")).toBe("reel");
  });
  it("reconoce el post del intento (mismo texto, creado desde el intento) y no otros", () => {
    const start = new Date("2026-11-06T12:00:00Z");
    expect(matchesAttempt({ message: "Hola  mundo", createdTime: "2026-11-06T12:00:30+0000" }, "hola mundo", start)).toBe(true);
    expect(matchesAttempt({ message: "Hola mundo", createdTime: "2026-11-05T12:00:30+0000" }, "Hola mundo", start)).toBe(false); // publicación vieja con mismo texto
    expect(matchesAttempt({ message: "Otro", createdTime: "2026-11-06T12:00:30+0000" }, "Hola mundo", start)).toBe(false);
    expect(matchesAttempt({ message: null, createdTime: null }, "x", start)).toBe(false);
  });
  it("la clave de idempotencia es estable y depende de contenido y fecha", () => {
    const d = new Date("2026-11-06T12:00:00Z");
    expect(idempotencyKey("p1", d)).toBe(idempotencyKey("p1", new Date(d)));
    expect(idempotencyKey("p1", d)).not.toBe(idempotencyKey("p2", d));
    expect(idempotencyKey("p1", d)).not.toBe(idempotencyKey("p1", new Date(d.getTime() + 1000)));
  });
});

describe("errores de Meta", () => {
  it("clasifica códigos según la documentación", () => {
    expect(classifyMetaError(190)).toBe("auth");
    expect(classifyMetaError(100, 467)).toBe("auth");
    expect(classifyMetaError(102)).toBe("auth");
    for (const c of [4, 17, 32, 341, 613, 368]) expect(classifyMetaError(c)).toBe("rate");
    expect(classifyMetaError(1)).toBe("transient");
    expect(classifyMetaError(2)).toBe("transient");
    expect(classifyMetaError(506)).toBe("duplicate");
    expect(classifyMetaError(10)).toBe("permission");
    expect(classifyMetaError(283)).toBe("permission");
    expect(classifyMetaError(1363040)).toBe("invalid");
    expect(classifyMetaError(undefined, undefined, 503)).toBe("transient");
    expect(classifyMetaError(999)).toBe("unknown");
  });
  it("un error con respuesta 4xx es 'definitivamente no publicado'; un 5xx es ambiguo", () => {
    expect(new MetaApiError("x", 100, undefined, 400).definitelyNotPublished).toBe(true);
    expect(new MetaApiError("x", undefined, undefined, 502).definitelyNotPublished).toBe(false);
  });
});

describe("MetaClient (fetch simulado)", () => {
  const cfg: MetaConfig = { appId: "123", appSecret: "SECRET", version: "v27.0", verifyToken: "vt", scopes: ["pages_show_list", "pages_manage_posts"], redirectUri: "https://app.example.com/api/meta/oauth/callback", graphBase: "https://graph.facebook.com", uploadBase: "https://rupload.facebook.com" };
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const mk = (impl: (url: URL, init: RequestInit) => Response | Promise<Response>) => {
    const f = vi.fn(async (u: URL | string, init: RequestInit = {}) => impl(new URL(String(u)), init));
    return { f, client: new MetaClient(cfg, f as unknown as typeof fetch) };
  };

  it("appsecret_proof es HMAC-SHA256 hex del token", () => {
    expect(appSecretProof("TOKEN", "SECRET")).toBe(createHmac("sha256", "SECRET").update("TOKEN").digest("hex"));
  });
  it("arma la URL de autorización con versión, scopes y state", () => {
    const u = new URL(mk(() => ok({})).client.authorizeUrl("st4te"));
    expect(u.origin + u.pathname).toBe("https://www.facebook.com/v27.0/dialog/oauth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "123", state: "st4te", response_type: "code", scope: "pages_show_list,pages_manage_posts", redirect_uri: cfg.redirectUri });
  });
  it("intercambia código y token de larga duración", async () => {
    const { f, client } = mk((u) => ok({ access_token: u.searchParams.get("fb_exchange_token") ? "LONG" : "SHORT" }));
    expect(await client.exchangeCode("CODE")).toBe("SHORT");
    expect(await client.exchangeLongLived("SHORT")).toBe("LONG");
    const u1 = (f.mock.calls[0] as unknown as [URL])[0];
    expect(u1.pathname).toBe("/v27.0/oauth/access_token");
    expect(u1.searchParams.get("code")).toBe("CODE");
    expect((f.mock.calls[1] as unknown as [URL])[0].searchParams.get("grant_type")).toBe("fb_exchange_token");
  });
  it("lista páginas con paginación y descarta las sin token", async () => {
    let n = 0;
    const { client } = mk((u) => {
      n++;
      expect(u.searchParams.get("appsecret_proof")).toBe(appSecretProof("UT", "SECRET"));
      return n === 1
        ? ok({ data: [{ id: "1", name: "A", access_token: "T1", tasks: ["CREATE_CONTENT"] }, { id: "2", name: "SinToken" }], paging: { cursors: { after: "c1" }, next: "x" } })
        : ok({ data: [{ id: "3", name: "C", category: "Blog", access_token: "T3" }] });
    });
    const pages = await client.listPages("UT");
    expect(pages.map((p) => p.id)).toEqual(["1", "3"]);
    expect(pages[0].tasks).toEqual(["CREATE_CONTENT"]);
  });
  it("publica texto en /{page}/feed con token y proof, sin filtrar secretos", async () => {
    const { f, client } = mk(() => ok({ id: "123_456" }));
    const r = await client.publishText("999", "PAGETOKEN", { message: "Hola" });
    expect(r.id).toBe("123_456");
    const [url, init] = f.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/v27.0/999/feed");
    expect(url.searchParams.get("access_token")).toBe("PAGETOKEN");
    expect(url.searchParams.get("appsecret_proof")).toBe(appSecretProof("PAGETOKEN", "SECRET"));
    expect(JSON.parse(String(init.body))).toEqual({ message: "Hola", published: true });
  });
  it("mapea errores de Graph y no expone tokens en el mensaje", async () => {
    const { client } = mk(() => ok({ error: { message: "Invalid OAuth access_token=EAAB1234567890123456789012345 expired", code: 190, error_subcode: 463, fbtrace_id: "tr" } }, 400));
    const e = (await client.publishText("1", "T", { message: "x" }).catch((x) => x)) as MetaApiError;
    expect(e).toBeInstanceOf(MetaApiError);
    expect(e).toMatchObject({ code: 190, subcode: 463, kind: "auth", httpStatus: 400, fbtraceId: "tr" });
    expect(e.message).not.toContain("EAAB1234567890123456789012345");
  });
  it("los fallos de red son ambiguos (MetaNetworkError)", async () => {
    const client = new MetaClient(cfg, (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch);
    await expect(client.publishText("1", "T", { message: "x" })).rejects.toBeInstanceOf(MetaNetworkError);
  });
  it("Reels: start, upload con cabeceras OAuth/offset/file_size, finish y estado", async () => {
    const { f, client } = mk((u, init) => {
      if (u.hostname === "rupload.facebook.com") return ok({ success: true });
      if (u.pathname.endsWith("/video_reels")) return ok(JSON.parse(String(init.body)).upload_phase === "start" ? { video_id: "V1", upload_url: "https://rupload.facebook.com/video-upload/V1" } : { success: true });
      return ok({ status: { video_status: "ready", publishing_phase: { publish_status: "published" } } });
    });
    const s = await client.reelStart("999", "T");
    expect(s.video_id).toBe("V1");
    await client.reelUpload("V1", "T", "package.json", 100);
    const up = f.mock.calls[1] as unknown as [URL, RequestInit];
    expect(new URL(String(up[0])).pathname).toBe("/video-upload/v27.0/V1");
    expect(up[1].headers).toMatchObject({ Authorization: "OAuth T", offset: "0", file_size: "100" });
    await client.reelFinish("999", "T", { videoId: "V1", description: "d" });
    expect(JSON.parse(String((f.mock.calls[2] as unknown as [URL, RequestInit])[1].body))).toMatchObject({ upload_phase: "finish", video_id: "V1", video_state: "PUBLISHED", description: "d" });
    expect(await client.reelStatus("V1", "T")).toMatchObject({ videoStatus: "ready", publishStatus: "published" });
  });
  it("sin credenciales no hay configuración", () => {
    expect(getMetaConfig({} as NodeJS.ProcessEnv)).toBeNull();
    const c = getMetaConfig({ META_APP_ID: "1", META_APP_SECRET: "s", AUTH_URL: "https://x.com/" } as unknown as NodeJS.ProcessEnv)!;
    expect(c.version).toBe("v27.0");
    expect(c.redirectUri).toBe("https://x.com/api/meta/oauth/callback");
    // la sobrescritura de bases solo existe fuera de producción
    const dev = getMetaConfig({ META_APP_ID: "1", META_APP_SECRET: "s", META_GRAPH_BASE_URL: "http://127.0.0.1:9/" } as unknown as NodeJS.ProcessEnv)!;
    expect(dev.graphBase).toBe("http://127.0.0.1:9");
    const prod = getMetaConfig({ META_APP_ID: "1", META_APP_SECRET: "s", NODE_ENV: "production", META_GRAPH_BASE_URL: "http://127.0.0.1:9", META_UPLOAD_BASE_URL: "http://evil" } as unknown as NodeJS.ProcessEnv)!;
    expect([prod.graphBase, prod.uploadBase]).toEqual(["https://graph.facebook.com", "https://rupload.facebook.com"]);
    expect(() => getMetaConfig({ META_APP_ID: "1", META_APP_SECRET: "s", META_GRAPH_VERSION: "27" } as unknown as NodeJS.ProcessEnv)).toThrow();
  });
});

describe("webhook y estado OAuth", () => {
  it("valida X-Hub-Signature-256", () => {
    const body = JSON.stringify({ object: "page", entry: [] });
    const good = "sha256=" + createHmac("sha256", "SECRET").update(body).digest("hex");
    expect(verifySignature(body, good, "SECRET")).toBe(true);
    expect(verifySignature(body + " ", good, "SECRET")).toBe(false);
    expect(verifySignature(body, good, "OTRO")).toBe(false);
    expect(verifySignature(body, null, "SECRET")).toBe(false);
    expect(verifySignature(body, "sha256=zz", "SECRET")).toBe(false);
    expect(verifySignature(body, "sha1=" + good.slice(7), "SECRET")).toBe(false);
  });
  it("responde el challenge solo con modo y token correctos", () => {
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    expect(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "1158" }), "vt")).toBe("1158");
    expect(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "mal", "hub.challenge": "1" }), "vt")).toBeNull();
    expect(verifyChallenge(q({ "hub.mode": "unsubscribe", "hub.verify_token": "vt", "hub.challenge": "1" }), "vt")).toBeNull();
    expect(verifyChallenge(q({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "1" }), null)).toBeNull();
  });
  it("el estado OAuth se valida contra cookie firmada, vence y es de un solo destino", () => {
    const { state, cookie } = createOAuthState("page1", 1000);
    expect(readOAuthState(cookie, state, 2000)).toEqual({ pageId: "page1" });
    expect(readOAuthState(cookie, "otro", 2000)).toBeNull();
    expect(readOAuthState(cookie, state, 1000 + 11 * 60_000)).toBeNull();
    expect(readOAuthState(cookie.replace(/.$/, "x"), state, 2000)).toBeNull();
    expect(readOAuthState(undefined, state, 2000)).toBeNull();
    expect(readOAuthState("a.b", state, 2000)).toBeNull();
  });
});
