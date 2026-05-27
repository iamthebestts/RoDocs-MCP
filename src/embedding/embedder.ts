import { loadModel } from "./model.js";

export async function embed(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const model = await loadModel();
  const results: Float32Array[] = [];

  for (const text of texts) {
    const output = await model(text, { pooling: "mean" });
    const normalized = output.normalize();
    results.push(new Float32Array(normalized.data as Float32Array));
  }

  return results;
}
