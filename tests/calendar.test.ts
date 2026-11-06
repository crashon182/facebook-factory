import { describe, expect, it } from "vitest";
import { monthGrid, shiftKey, viewRange, viewRangeUtc, weekStartKey } from "@/lib/calendar";

describe("calendario", () => {
  it("la semana empieza en lunes", () => {
    expect(weekStartKey("2026-11-06")).toBe("2026-11-02"); // viernes → lunes
    expect(weekStartKey("2026-11-08")).toBe("2026-11-02"); // domingo → lunes anterior
    expect(weekStartKey("2026-11-02")).toBe("2026-11-02");
  });
  it("la grilla mensual cubre el mes en semanas completas", () => {
    const g = monthGrid("2026-11-15");
    expect(g.weeks.every((w) => w.length === 7)).toBe(true);
    expect(g.weeks[0][0].key).toBe("2026-10-26"); // 1/11/2026 es domingo → la grilla empieza el lunes anterior
    expect(g.weeks.flat().filter((d) => d.inMonth)).toHaveLength(30);
    expect(g.weeks.at(-1)![6].key >= "2026-11-30").toBe(true);
    const feb = monthGrid("2026-02-10");
    expect(feb.weeks).toHaveLength(5); // 1/2/2026 es domingo: con semana desde lunes ocupa 5 filas
    expect(monthGrid("2027-02-10").weeks).toHaveLength(4); // 1/2/2027 es lunes y tiene 28 días
  });
  it("rangos por vista y desplazamiento", () => {
    expect(viewRange("day", "2026-11-06")).toEqual({ fromKey: "2026-11-06", toKey: "2026-11-07" });
    expect(viewRange("week", "2026-11-06")).toEqual({ fromKey: "2026-11-02", toKey: "2026-11-09" });
    expect(viewRange("list", "2026-11-06").toKey).toBe("2026-12-07");
    expect(shiftKey("month", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftKey("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftKey("week", "2026-11-06", -1)).toBe("2026-10-30");
    expect(shiftKey("day", "2026-12-31", 1)).toBe("2027-01-01");
  });
  it("el rango en UTC respeta la zona horaria", () => {
    const r = viewRangeUtc("day", "2026-11-06", "America/Argentina/Buenos_Aires");
    expect(r.from.toISOString()).toBe("2026-11-06T03:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-11-07T03:00:00.000Z");
  });
});
