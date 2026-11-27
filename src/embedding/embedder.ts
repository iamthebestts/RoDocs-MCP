import { loadModel } from "./model.js";

type EmbedOutput = {
  data: Float32Array;
  dims: number[];
  normalize(): { data: Float32Array; dims: number[] };
};

type EmbedFn = (text: string | string[], opts: { pooling: string }) => Promise<EmbedOutput>;

const DEFAULT_BATCH_SIZE = 32;

function readBatchSize(): number {
  const raw = Number(process.env.RODOCS_EMBED_BATCH_SIZE);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 256) return Math.floor(raw);
  return DEFAULT_BATCH_SIZE;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function tensorToVectors(output: EmbedOutput): Float32Array[] {
  const normalized = output.normalize();
  const { data, dims } = normalized;
  if (dims.length === 1) {
    return [new Float32Array(data)];
  }
  if (dims.length === 2) {
    const batch = dims[0] ?? 0;
    const dim = dims[1] ?? 0;
    const vectors: Float32Array[] = [];
    for (let i = 0; i < batch; i++) {
      vectors.push(data.slice(i * dim, (i + 1) * dim));
    }
    return vectors;
  }
  throw new Error(`Unsupported embedding dims: ${dims.join("x")}`);
}

export type EmbedMode = "query" | "passage";

export interface EmbedOptions {
  /**
   * Prefix mode for E5-family embedding models (`multilingual-e5-small`).
   * - `"query"` prepends `"query: "` (for search queries)
   * - `"passage"` prepends `"passage: "` (for indexed documents)
   * Omit to pass raw text through unchanged.
   */
  mode?: EmbedMode;
}

function applyModePrefix(text: string, mode: EmbedMode | undefined): string {
  if (mode === undefined) return text;
  const prefix = `${mode}: `;
  return text.startsWith(prefix) ? text : `${prefix}${text}`;
}

export async function embed(texts: string[], options?: EmbedOptions): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const model = (await loadModel()) as unknown as EmbedFn;
  const batchSize = readBatchSize();
  const mode = options?.mode;
  const preparedTexts = mode ? texts.map((text) => applyModePrefix(text, mode)) : texts;
  const results: Float32Array[] = [];

  for (let offset = 0; offset < preparedTexts.length; offset += batchSize) {
    const batch = preparedTexts.slice(offset, offset + batchSize);
    const input = batch.length === 1 ? (batch[0] ?? "") : batch;
    const output = await model(input, { pooling: "mean" });
    results.push(...tensorToVectors(output));
    if (offset + batchSize < preparedTexts.length) {
      await yieldToEventLoop();
    }
  }

  return results;
}
