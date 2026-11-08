import { describe, expect, it } from "vitest";
import { buildLegalContent, isLegalDoc, legalPath, LEGAL_DOCS } from "@/lib/legal";

const ctx = { pageName: "Frases Diarias", contactEmail: "contacto@ejemplo.com", updated: "8 de noviembre de 2026" };

describe("páginas legales para Meta", () => {
  it("genera las tres páginas con el nombre y el correo de contacto", () => {
    for (const doc of LEGAL_DOCS) {
      const c = buildLegalContent(doc, ctx);
      const text = JSON.stringify(c);
      expect(c.title).toContain("Frases Diarias");
      expect(text).toContain("contacto@ejemplo.com");
      expect(c.sections.length).toBeGreaterThan(2);
    }
  });
  it("las instrucciones de eliminación explican cómo pedirla", () => {
    expect(JSON.stringify(buildLegalContent("eliminacion-de-datos", ctx))).toContain("Eliminar mis datos");
  });
  it("arma rutas por slug y valida el documento", () => {
    expect(legalPath("frases-diarias", "privacidad")).toBe("/legal/frases-diarias/privacidad");
    expect(isLegalDoc("terminos")).toBe(true);
    expect(isLegalDoc("otro")).toBe(false);
  });
});
