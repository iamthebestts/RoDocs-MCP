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

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const model = (await loadModel()) as unknown as EmbedFn;
  const batchSize = readBatchSize();
  const results: Float32Array[] = [];

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const input = batch.length === 1 ? (batch[0] ?? "") : batch;
    const output = await model(input, { pooling: "mean" });
    results.push(...tensorToVectors(output));
    if (offset + batchSize < texts.length) {
      await yieldToEventLoop();
    }
  }

  return results;
}
