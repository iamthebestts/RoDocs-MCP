import { loadModel } from "./model.js";

type EmbedOutput = { data: Float32Array; normalize(): { data: Float32Array } };
type EmbedFn = (text: string, opts: { pooling: string }) => Promise<EmbedOutput>;

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const model = (await loadModel()) as unknown as EmbedFn;
  const results: Float32Array[] = [];

  for (const text of texts) {
    const output = await model(text, { pooling: "mean" });
    const normalized = output.normalize();
    results.push(new Float32Array(normalized.data));
  }

  return results;
}
