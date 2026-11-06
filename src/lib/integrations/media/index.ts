import type { MediaProvider } from "./types";
import { PexelsProvider } from "./pexels";
import { PixabayProvider } from "./pixabay";

/** Registro de proveedores. Para sumar otro (Pixabay, Unsplash…) basta implementar MediaProvider y agregarlo aquí. */
const providers: MediaProvider[] = [new PexelsProvider(), new PixabayProvider()];

export function listProviders() {
  return providers;
}
export function getProvider(id: string): MediaProvider | undefined {
  return providers.find((p) => p.id === id);
}
/** Proveedor activo por defecto: MEDIA_PROVIDER o el primero configurado. */
export function getDefaultProvider(): MediaProvider | null {
  const wanted = process.env.MEDIA_PROVIDER?.trim();
  const p = wanted ? getProvider(wanted) : providers.find((x) => x.isConfigured());
  return p?.isConfigured() ? p : null;
}
