// Constantes puras (seguras para importar desde componentes de cliente).
export const IMAGE_TEMPLATES = [
  { id: "classic-dark", label: "Clásico oscuro" },
  { id: "light-minimal", label: "Claro minimalista" },
  { id: "brand-gradient", label: "Degradado de marca" },
  { id: "photo-veil", label: "Foto con velo" },
] as const;
export type TemplateId = (typeof IMAGE_TEMPLATES)[number]["id"];
export const ASPECTS = { square: { w: 1080, h: 1080, label: "Cuadrado 1080×1080" }, portrait: { w: 1080, h: 1350, label: "Vertical 1080×1350" } } as const;
export type AspectId = keyof typeof ASPECTS;

