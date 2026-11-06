import { beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto", () => {
  it("cifra y descifra", () => {
    const enc = encryptSecret("EAAB-token-secreto");
    expect(enc).not.toContain("EAAB");
    expect(decryptSecret(enc)).toBe("EAAB-token-secreto");
  });
  it("usa IV distinto en cada cifrado", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("detecta manipulación", () => {
    const parts = encryptSecret("hola").split(":");
    parts[3] = Buffer.from("alterado").toString("base64");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });
  it("rechaza claves de largo incorrecto", () => {
    process.env.ENCRYPTION_KEY = "corta";
    expect(() => encryptSecret("x")).toThrow();
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
});
