export type SynthesizeRequest = { text: string; language?: string; voice?: string };
export type SynthesizeResult = { audio: Buffer; format: "mp3"; characters: number; provider: string; model: string };

/** Contrato de cualquier proveedor de narración. */
export interface TTSProvider {
  readonly id: string;
  isConfigured(): boolean;
  synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>;
}
