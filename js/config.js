// ─────────────────────────────────────────────────────────────────────────
// VIBE UNIT — all the feel-knobs live here.
//
// The core loop (from the humanoid "what's your vibe today?" reference):
//   the camera segments your head → your face becomes the radar polygon,
//   silhouette pulled into spikes toward five vibe axes → press READ →
//   the machine locks a verdict + poster.
// Two modes: AUTO (blendshapes drive the axes) and SCULPT (pinch a spike
// with your hand and pull it where you think it should be).
// ─────────────────────────────────────────────────────────────────────────

export const BRAND = {
  watermark: 'VIBE · UNIT',
  build: 'v0.1',
  url: 'yannitan11.github.io/vibe-unit',
};

// MediaPipe models (loaded from CDN at runtime).
export const MP = {
  version: '0.10.14',
  get base() {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${this.version}`;
  },
  get wasm() {
    return `${this.base}/wasm`;
  },
  // Face landmarks + 52 blendshapes → the axis readings.
  faceModel:
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  // Selfie segmentation → the head cutout that gets warped.
  segmentModel:
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  // Hands — lazy-loaded only when SCULPT mode is entered.
  handModel:
    'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  numHands: 2,
};

export const CAMERA = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
};

// ── Radar chart geometry ──
// Radii are fractions of min(canvasW, canvasH). First axis points up,
// the rest every 72° clockwise.
export const CHART = {
  outerR: 0.3, // spike radius at value 1.0
  innerR: 0.11, // spike radius at value 0.0
  midRing: 0.62, // dotted ring, fraction of outerR
  startAngle: -Math.PI / 2,
  labelGap: 30, // px (CSS) past the outer ring for axis labels
  pad: 8, // px slack around the warp canvas
};

// ── The five axes ──
// value = clamp01(bias + Σ weight·blendshape + Σ weight·feature), smoothed.
// Blendshape names are MediaPipe's. Features (computed in axes.js):
//   speed — head motion, 0 still → 1 fast
//   still — 1 − speed
//   roll  — head tilt magnitude, 0 level → 1 ~26°
export const AXES = [
  {
    key: 'VOLT', // wired, awake, running hot
    bias: 0.1,
    weights: {
      eyeWideLeft: 0.8,
      eyeWideRight: 0.8,
      browOuterUpLeft: 0.45,
      browOuterUpRight: 0.45,
      browInnerUp: 0.3,
    },
    features: { speed: 0.3 },
  },
  {
    key: 'STATIC', // tension, edge, storm pressure
    bias: 0.08,
    weights: {
      browDownLeft: 0.75,
      browDownRight: 0.75,
      mouthPressLeft: 0.45,
      mouthPressRight: 0.45,
      noseSneerLeft: 0.4,
      noseSneerRight: 0.4,
      jawForward: 0.4,
      eyeSquintLeft: 0.2,
      eyeSquintRight: 0.2,
    },
  },
  {
    key: 'DRIFT', // dreamy, elsewhere, low gravity
    bias: 0.12,
    weights: {
      eyeLookUpLeft: 0.5,
      eyeLookUpRight: 0.5,
      eyeLookOutLeft: 0.35,
      eyeLookOutRight: 0.35,
    },
    features: { roll: 0.55, still: 0.25 },
  },
  {
    key: 'MELLOW', // soft, warm, unhurried
    bias: 0.1,
    weights: {
      mouthSmileLeft: 0.6,
      mouthSmileRight: 0.6,
      cheekSquintLeft: 0.35,
      cheekSquintRight: 0.35,
    },
    features: { still: 0.3 },
  },
  {
    key: 'FERAL', // chaos, appetite, no warranty
    bias: 0.06,
    weights: {
      jawOpen: 0.9,
      mouthStretchLeft: 0.4,
      mouthStretchRight: 0.4,
      mouthFunnel: 0.3,
      tongueOut: 0.9,
    },
    features: { speed: 0.45 },
  },
];

export const SMOOTH = {
  axisLerp: 0.12, // per-frame lerp of axis values toward the raw reading
  profileLerp: 0.35, // per-frame lerp of the silhouette radius profile
  speedNorm: 3, // head speed (face-widths/second) that counts as 1.0
  rollNorm: 0.45, // head roll (radians) that counts as 1.0
};

// ── The head warp ──
export const WARP = {
  // Angular buckets for the silhouette + polygon profiles. Must be a power
  // of two (the radius LUT wraps via gl.REPEAT). 256 keeps the spike tips
  // sharp — at 64 the LUT interpolation visibly blunts them.
  rays: 256,
  maskThreshold: 0.5, // person-probability that counts as "head"
  maskFeather: 0.15, // smoothstep half-width around the threshold
  minR: 0.6, // clamp silhouette radius ≥ this × face size
  maxR: 2.6, // clamp silhouette radius ≤ this × face size (neck chop)
  centerBias: 0.25, // head centre = eye midpoint nudged this far to nose tip
  edgeFadePx: 2.5, // soft fade at the polygon boundary (CSS px)
  // Fraction of min(silhouette, polygon) radius that maps 1:1 — the face
  // core stays flat/natural and ALL the stretch happens in the rim band
  // (hair and cheeks smear into the spikes, like the reference). 0 = the
  // old fully-linear remap, which dishes the whole face concave.
  coreLock: 0.55,
};

// ── Gestures (SCULPT mode) — normalized to hand size, from HÄND STUDIO ──
export const GESTURE = {
  pinchRatio: 0.42,
  pinchReleaseRatio: 0.55,
  fistReach: 1.35,
  fistHoldFrames: 8, // frames all visible hands hold fists → snap back to AUTO reading
  grabRadiusPx: 64, // CSS px from a spike tip to grab it
};

// ── The scan ritual ──
export const SCAN = {
  durationMs: 2400,
  flashMs: 300,
};

// Rotating instruction ticker (bottom-left). State-aware.
export const TICKER = {
  intervalMs: 2600,
  noface: ['STEP INTO FRAME', 'SHOW YOUR FACE'],
  live: ['YOUR FACE IS THE CHART', 'MAKE AN EXPRESSION', 'PRESS READ FOR A VERDICT'],
  sculpt: ['PINCH A SPIKE TO PULL IT', 'FISTS TO SNAP BACK', 'PRESS READ TO LOCK IT'],
  scanning: ['SAMPLING VIBE FIELD', 'HOLD STILL'],
  locked: ['SAVE THE POSTER', 'PRESS R TO GO AGAIN'],
};

export const STATUS = {
  BOOTING: 'BOOTING',
  NOFACE: 'NO FACE',
  READING: 'READING',
  SCULPTING: 'SCULPTING',
  SAMPLING: 'SAMPLING',
  LOCKED: 'LOCKED',
};

// ── Verdicts ──
// Picked from the locked axis values: the two tallest spikes name you,
// unless the whole chart is flat-and-low (PAPER GHOST) or lit across the
// board (VELVET STORM). Copy rule: encouraging, wry, never shaming.
export const VERDICT = {
  lowMean: 0.3, // mean below this + flat spread → PAPER GHOST
  flatSpread: 0.14,
  highMean: 0.72, // mean above this → VELVET STORM
};

export const RESULTS = {
  flat: {
    name: 'PAPER GHOST',
    copy: [
      'faint signal, fully present. you are in power-saving mode and that is a feature, not a fault. drift through today gently and haunt only the rooms you like.',
      'the reading is quiet on every axis, which is its own kind of rare. rest is not a lack of vibe. it is the vibe. float accordingly.',
    ],
  },
  high: {
    name: 'VELVET STORM',
    copy: [
      'every axis lit. the reading shows too much of everything, luxuriously. you are a lot today, in the way an orchestra is a lot. play all of it.',
      'full spectrum, no apologies. whatever today asks for, you appear to already be carrying it. spend it somewhere that deserves you.',
    ],
  },
  // keys are the two dominant axes, in AXES order, joined with '+'
  pairs: {
    'VOLT+STATIC': {
      name: 'MINT LIGHTNING',
      copy: [
        'cold spark, clean edges. you are running at full voltage and you know exactly where it is going. people will ask if you slept. ignore them. today has corners and you are the one cutting them.',
        'high charge, zero slack. the reading shows precision under pressure, like a laser with a to-do list. keep the wire insulated: one good break before noon and nothing can touch you.',
      ],
    },
    'VOLT+DRIFT': {
      name: 'LOW ORBIT',
      copy: [
        'all thrust, no destination. you are wide awake and slightly elsewhere, which is the exact altitude where good ideas live. stay up there a while. gravity can file a complaint.',
        'the reading shows motion without hurry, a satellite doing laps for the joy of it. you will get there, wherever there is. take the scenic orbit.',
      ],
    },
    'VOLT+MELLOW': {
      name: 'WARM MACHINE',
      copy: [
        'high output, soft edges. you are the rare device that runs hot and stays kind. today wants momentum with a smile on it. give generously; the battery reads full.',
        'efficient and gentle is a rare spec. the reading shows a motor wrapped in a blanket. do the big thing, then hold the door for someone on your way out.',
      ],
    },
    'VOLT+FERAL': {
      name: 'SUGAR GLITCH',
      copy: [
        'the reading is loud and delighted. you are a firework in a jar and the lid is decorative. point yourself at something fun before you point yourself at everything.',
        'maximum sparkle, minimum warranty. today runs on impulse and it suits you. commit to the bit. apologize to no one except maybe your calendar.',
      ],
    },
    'STATIC+DRIFT': {
      name: 'NIGHT STATIC',
      copy: [
        'moody with excellent reception. you are tuned between stations, catching signals nobody else hears. keep the lights low and the standards high. something good is coming through.',
        'the reading shows weather: overcast, electric, beautiful from a window. you do not need fixing, you need a soundtrack. let today be atmospheric.',
      ],
    },
    'STATIC+MELLOW': {
      name: 'SLOW BURN',
      copy: [
        'quiet intensity, long fuse. you hold heat the way a stone holds sun: no flames, all warmth, impossible to argue with. keep going at your own temperature.',
        'the reading shows patience with an edge. you are not slow, you are thorough, and everyone in a hurry will need you by friday.',
      ],
    },
    'STATIC+FERAL': {
      name: 'FERAL SAINT',
      copy: [
        'sharp teeth, good heart. the reading shows chaos with a moral compass, which is the most dangerous kind. defend something today. loudly is fine.',
        'you are a storm that shows up on time. intensity is the gift; aim is the practice. pick one hill, plant one flag, terrify politely.',
      ],
    },
    'DRIFT+MELLOW': {
      name: 'SYRUP MOON',
      copy: [
        'soft, slow, luminous. the reading is a warm room with the good lamp on. nothing needs to happen fast today, and honestly nothing should. pour yourself somewhere comfortable.',
        'low tide, high tenderness. you are moving at the speed of honey and it is correct. protect the calm; it is doing more work than it looks.',
      ],
    },
    'DRIFT+FERAL': {
      name: 'SLEEPWALK RIOT',
      copy: [
        'dreamy with a kick. the reading shows a quiet exterior wrapped around a parade. today may start slow and end somewhere unexplainable. allow it.',
        'half asleep, fully alive. your chaos runs on intuition instead of caffeine, which makes it impossible to schedule and hard to beat. follow the weird thread.',
      ],
    },
    'MELLOW+FERAL': {
      name: 'SOFT CHAOS',
      copy: [
        'friendly disorder. you are confetti with feelings: warm, scattered, impossible to be mad at. let the day stay loose. the mess is load-bearing.',
        'the reading shows joy without a filing system. plans will wobble and it will not matter. bring snacks, wing it, hug someone about it.',
      ],
    },
  },
};

// HUD look
export const HUD = {
  ring: 'rgba(244,242,236,0.4)',
  ringDotted: 'rgba(244,242,236,0.28)',
  spoke: 'rgba(244,242,236,0.22)',
  label: 'rgba(244,242,236,0.85)',
  labelDim: 'rgba(244,242,236,0.45)',
  accent: '#c8ff3c',
  tickSize: 5, // value marker square, CSS px
  grip: 'rgba(244,242,236,0.9)',
};
