import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../model.js", () => ({
  loadModel: vi.fn(),
  _resetModelForTesting: vi.fn(),
}));

import { embed } from "../embedder.js";
import { _resetModelForTesting, loadModel } from "../model.js";

const mockLoadModel = vi.mocked(loadModel);

describe("embed()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetModelForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns one vector per input text", async () => {
    const fakeOutput = {
      data: new Float32Array([1, 0, 0]),
      dims: [1, 3],
      mean: () => fakeOutput,
      normalize: () => fakeOutput,
    };
    mockLoadModel.mockResolvedValue(
      vi.fn().mockResolvedValue(fakeOutput) as unknown as Awaited<ReturnType<typeof loadModel>>,
    );

    const results = await embed(["hello world"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toBeInstanceOf(Float32Array);
  });

  it("returns empty array for empty input", async () => {
    mockLoadModel.mockResolvedValue(vi.fn() as unknown as Awaited<ReturnType<typeof loadModel>>);
    const results = await embed([]);
    expect(results).toHaveLength(0);
    expect(mockLoadModel).not.toHaveBeenCalled();
  });

  it("L2-normalizes the output vectors", async () => {
    const rawData = new Float32Array([3, 4]);
    const fakeOutput = {
      data: rawData,
      dims: [1, 2],
      mean: () => fakeOutput,
      normalize: () => ({
        data: new Float32Array([0.6, 0.8]),
        dims: [1, 2],
      }),
    };
    mockLoadModel.mockResolvedValue(
      vi.fn().mockResolvedValue(fakeOutput) as unknown as Awaited<ReturnType<typeof loadModel>>,
    );

    const results = await embed(["test"]);
    expect(results[0]?.[0]).toBeCloseTo(0.6, 4);
    expect(results[0]?.[1]).toBeCloseTo(0.8, 4);
  });
});
