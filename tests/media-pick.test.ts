import { describe, expect, it } from "vitest";
import { backgroundQueries, chooseCandidate, FALLBACK_BACKGROUND_QUERY } from "@/lib/media-pick";

describe("consultas para la foto de fondo", () => {
  it("va de lo más específico a lo genérico y termina en un fallback", () => {
    const q = backgroundQueries({ imageKeywords: ["sunrise", "mountain", "peace", "light"], topic: "Paz", pageTopic: "Reflexión cristiana" });
    expect(q[0]).toBe("sunrise mountain peace");
    expect(q).toContain("sunrise");
    expect(q.slice(-1)[0]).toBe(FALLBACK_BACKGROUND_QUERY);
  });
  it("sin palabras clave usa el tema y el fallback, sin duplicados ni vacíos", () => {
    expect(backgroundQueries({ imageKeywords: null, topic: " ", pageTopic: "Paz" })).toEqual(["Paz", FALLBACK_BACKGROUND_QUERY]);
    expect(backgroundQueries({ imageKeywords: ["Paz"], topic: "paz", pageTopic: "PAZ" })).toEqual(["Paz", FALLBACK_BACKGROUND_QUERY]);
    expect(backgroundQueries({ imageKeywords: [1, "", "   ", "luz"] as unknown })).toEqual(["luz", FALLBACK_BACKGROUND_QUERY]);
  });
});

describe("elección de la foto", () => {
  const items = [{ externalId: "1", width: 640 }, { externalId: "2", width: 1280 }, { externalId: "3", width: 1920 }, { externalId: "4", width: 1600 }];
  it("descarta las de baja resolución y prefiere las que aún no están en la biblioteca", () => {
    for (const r of [0, 0.4, 0.99]) {
      const c = chooseCandidate(items, new Set(["2"]), () => r)!;
      expect(["3", "4"]).toContain(c.externalId);
    }
  });
  it("si todas están en la biblioteca, elige entre las nítidas igual", () => {
    expect(["2", "3", "4"]).toContain(chooseCandidate(items, new Set(["2", "3", "4"]), () => 0.5)!.externalId);
  });
  it("si ninguna llega a la resolución mínima usa lo que haya, y sin resultados devuelve null", () => {
    expect(chooseCandidate([{ externalId: "9", width: 500 }], new Set())!.externalId).toBe("9");
    expect(chooseCandidate([], new Set())).toBeNull();
  });
  it("el azar en el borde superior no se sale del arreglo", () => {
    expect(chooseCandidate(items, new Set(), () => 0.9999999)).toBeTruthy();
  });
});
