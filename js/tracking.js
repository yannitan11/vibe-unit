// MediaPipe wrappers, decoupled from the render loop. Three models:
//   FaceLandmarker  — landmarks + 52 blendshapes → axis readings (always)
//   ImageSegmenter  — person mask → the head cutout that gets warped (always)
//   HandLandmarker  — pinch/fist → SCULPT mode (lazy-loaded on first use)
// Nothing here throws into the loop: a model that fails to load simply
// leaves its feature off and the app degrades gracefully.

import { MP } from './config.js';

export const ready = { face: false, seg: false, hands: false };

let visionModule = null;
let resolver = null;
let faceLm = null;
let segmenter = null;
let handLm = null;

async function getResolver() {
  if (resolver) return resolver;
  visionModule = await import(/* @vite-ignore */ `${MP.base}/vision_bundle.mjs`);
  resolver = await visionModule.FilesetResolver.forVisionTasks(MP.wasm);
  return resolver;
}

// GPU delegate can fail on some machines — retry on CPU.
async function withFallback(make) {
  try {
    return await make('GPU');
  } catch {
    return await make('CPU');
  }
}

// Face + segmenter, in parallel. Resolves when both settle (either way).
export async function loadCore() {
  const res = await getResolver();
  const { FaceLandmarker, ImageSegmenter } = visionModule;
  await Promise.all([
    (async () => {
      try {
        faceLm = await withFallback((delegate) =>
          FaceLandmarker.createFromOptions(res, {
            baseOptions: { modelAssetPath: MP.faceModel, delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
          })
        );
        ready.face = true;
      } catch (e) {
        console.warn('[vibe] FaceLandmarker unavailable.', e);
      }
    })(),
    (async () => {
      try {
        segmenter = await withFallback((delegate) =>
          ImageSegmenter.createFromOptions(res, {
            baseOptions: { modelAssetPath: MP.segmentModel, delegate },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          })
        );
        ready.seg = true;
      } catch (e) {
        console.warn('[vibe] Segmenter unavailable; no head cutout.', e);
      }
    })(),
  ]);
}

let handsLoading = null;
export function loadHands() {
  if (handsLoading) return handsLoading;
  handsLoading = (async () => {
    const res = await getResolver();
    const { HandLandmarker } = visionModule;
    try {
      handLm = await withFallback((delegate) =>
        HandLandmarker.createFromOptions(res, {
          baseOptions: { modelAssetPath: MP.handModel, delegate },
          runningMode: 'VIDEO',
          numHands: MP.numHands,
        })
      );
      ready.hands = true;
    } catch (e) {
      console.warn('[vibe] HandLandmarker unavailable; mouse-sculpt only.', e);
    }
  })();
  return handsLoading;
}

// ── Per-frame detection. Each model guards its own monotonic timestamp. ──

let faceTs = -1;
// → { landmarks: [{x,y,z}×478], shapes: {name: score} } or null
export function detectFace(video, ts) {
  if (!ready.face || ts <= faceTs) return null;
  faceTs = ts;
  try {
    const res = faceLm.detectForVideo(video, ts);
    const landmarks = res.faceLandmarks?.[0];
    if (!landmarks) return null;
    const shapes = {};
    for (const c of res.faceBlendshapes?.[0]?.categories || []) {
      shapes[c.categoryName] = c.score;
    }
    return { landmarks, shapes };
  } catch {
    return null;
  }
}

let handTs = -1;
// → [ [{x,y,z}×21], ... ]
export function detectHands(video, ts) {
  if (!ready.hands || ts <= handTs) return [];
  handTs = ts;
  try {
    return handLm.detectForVideo(video, ts).landmarks || [];
  } catch {
    return [];
  }
}

// Latest person mask, copied out of MediaPipe's transient buffer.
// { data: Float32Array, w, h } in raw (un-mirrored) video space.
let mask = null;
let segBusy = false;
let segTs = -1;
export function segment(video, ts) {
  if (!ready.seg || segBusy || ts <= segTs) return;
  segTs = ts;
  segBusy = true;
  try {
    segmenter.segmentForVideo(video, ts, (result) => {
      const masks = result.confidenceMasks;
      if (masks && masks.length) {
        // last confidence mask = foreground (person) probability
        const m = masks[masks.length - 1];
        mask = { data: m.getAsFloat32Array().slice(), w: m.width, h: m.height };
      }
      segBusy = false;
    });
  } catch {
    segBusy = false;
  }
}

export function getMask() {
  return mask;
}
