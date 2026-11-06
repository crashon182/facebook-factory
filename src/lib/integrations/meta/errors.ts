export type MetaErrorKind =
  | "auth"        // token vencido/inválido: no reintentar, reconectar
  | "permission"  // falta de permisos/rol: no reintentar
  | "rate"        // límites: reintentar con espera larga
  | "transient"   // error temporal de Meta: reintentar
  | "duplicate"   // contenido duplicado: cambiar el texto
  | "invalid"     // pedido/medio inválido: no reintentar
  | "unknown";

export function classifyMetaError(code?: number, subcode?: number, httpStatus?: number): MetaErrorKind {
  if (code === 190 || code === 102 || [458, 459, 460, 463, 464, 467, 492].includes(subcode ?? -1)) return "auth";
  if (code === 4 || code === 17 || code === 32 || code === 341 || code === 613 || code === 368) return "rate";
  if (code === 1 || code === 2) return "transient";
  if (code === 506) return "duplicate";
  if (code === 10 || code === 3 || (code !== undefined && code >= 200 && code <= 299)) return "permission";
  if (code === 100 || (code !== undefined && code >= 1363000 && code < 1364000)) return "invalid";
  if (httpStatus && httpStatus >= 500) return "transient";
  return "unknown";
}

export class MetaApiError extends Error {
  readonly kind: MetaErrorKind;
  constructor(message: string, readonly code?: number, readonly subcode?: number, readonly httpStatus?: number, readonly fbtraceId?: string) {
    super(message);
    this.kind = classifyMetaError(code, subcode, httpStatus);
  }
  /** Meta respondió con un error: la publicación NO se realizó (salvo httpStatus 5xx, que es ambiguo). */
  get definitelyNotPublished() {
    return !(this.httpStatus && this.httpStatus >= 500);
  }
}

/** Fallo de red/timeout: no se sabe si Meta llegó a procesar el pedido (ambiguo → reconciliar antes de reintentar). */
export class MetaNetworkError extends Error {}

export function describeMetaError(e: unknown): string {
  if (e instanceof MetaApiError) return `Meta ${e.code ?? e.httpStatus ?? ""}${e.subcode ? `/${e.subcode}` : ""}: ${e.message}`.slice(0, 500);
  if (e instanceof Error) return e.message.slice(0, 500);
  return "Error desconocido";
}
