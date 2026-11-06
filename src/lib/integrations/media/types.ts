export type MediaKind = "photo" | "video";
export type Orientation = "portrait" | "landscape" | "square";
export type Quality = "small" | "medium" | "large";

export type MediaSearchParams = {
  query: string;
  kind: MediaKind;
  orientation?: Orientation;
  quality?: Quality;
  page?: number;
  perPage?: number;
  /** Idioma de la consulta (es, en…). Solo lo usan los proveedores que lo soportan. */
  language?: string;
};

export type MediaCandidate = {
  provider: string;
  externalId: string;
  kind: MediaKind;
  title: string | null;
  previewUrl: string;
  downloadUrl: string;
  width: number;
  height: number;
  durationSec: number | null;
  author: string | null;
  authorUrl: string | null;
  sourceUrl: string;
  license: string;
};

export type MediaSearchResult = { items: MediaCandidate[]; page: number; perPage: number; total: number; rateLimitRemaining: number | null };

/** Contrato de cualquier proveedor multimedia: el resto del sistema solo conoce esta interfaz. */
export interface MediaProvider {
  readonly id: string;
  readonly name: string;
  /** Hosts (y subdominios) desde los que se permite descargar archivos de este proveedor. */
  readonly allowedDownloadHosts: string[];
  /** Texto y enlace para mostrar la procedencia de los resultados (algunos proveedores lo piden en sus términos). */
  readonly attribution?: { text: string; url: string };
  isConfigured(): boolean;
  search(params: MediaSearchParams): Promise<MediaSearchResult>;
}

export class MediaProviderNotConfiguredError extends Error {
  constructor(name: string) {
    super(`${name} no está configurado.`);
  }
}
export class MediaRateLimitError extends Error {
  constructor(public retryAfterSec: number | null) {
    super("El proveedor multimedia limitó las solicitudes (429). Reintentá más tarde.");
  }
}
export class MediaProviderError extends Error {}
