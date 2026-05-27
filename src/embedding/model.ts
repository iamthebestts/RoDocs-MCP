import { logger } from "../utils/logger.js";

type PipelineType = Awaited<ReturnType<typeof import("@xenova/transformers")["pipeline"]>>;

const MODEL_ID = "Xenova/multilingual-e5-small";

let _model: PipelineType | null = null;
let _loadPromise: Promise<PipelineType> | null = null;

export async function loadModel(): Promise<PipelineType> {
  if (_model !== null) return _model;
  if (_loadPromise !== null) return _loadPromise;

  _loadPromise = (async () => {
    logger.info(`[Embedding] loading model ${MODEL_ID}`);
    const { pipeline } = await import("@xenova/transformers");
    const model = await pipeline("feature-extraction", MODEL_ID);
    _model = model;
    logger.info(`[Embedding] model ready`);
    return model;
  })().catch((err: unknown) => {
    _loadPromise = null;
    throw err;
  });

  return _loadPromise;
}

export function _resetModelForTesting(): void {
  _model = null;
  _loadPromise = null;
}
