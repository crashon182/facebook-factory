export type Pricing = { inputPer1M: number; outputPer1M: number } | null;

function num(v: string | undefined): number | null {
  if (!v?.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Precios configurados por el administrador (no se asumen precios de ningún modelo). */
export function getPricing(env: NodeJS.ProcessEnv = process.env): Pricing {
  const i = num(env.OPENAI_PRICE_INPUT_PER_1M);
  const o = num(env.OPENAI_PRICE_OUTPUT_PER_1M);
  return i !== null && o !== null ? { inputPer1M: i, outputPer1M: o } : null;
}

export function estimateCostUsd(inputTokens: number, outputTokens: number, pricing: Pricing = getPricing()): number {
  if (!pricing) return 0;
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}
