// Docker build-ийн үед transformers.js-ийн model-уудыг .cache/hf-д урьдчилан татна.
import { env, pipeline } from '@huggingface/transformers';

import { HF_CACHE_DIR } from '../src/openVocab';

env.cacheDir = HF_CACHE_DIR;
const models = [
  ['zero-shot-object-detection', 'Xenova/owlvit-base-patch32', 'q8'],
  ['zero-shot-object-detection', 'Xenova/owlv2-base-patch16-ensemble', 'q8'],
  ['object-detection', 'onnx-community/rfdetr_nano-ONNX', 'fp32'],
] as const;
for (const [task, model, dtype] of models) {
  await pipeline(task, model, { dtype });
  console.log(`Татлаа: ${model}`);
}
