# VIBE UNIT

**Your face is the chart.** A webcam vibe radar in the HÄND STUDIO CV-debug
aesthetic: MediaPipe segments your head and a WebGL warp pulls its silhouette
into a five-axis radar polygon (VOLT · STATIC · DRIFT · MELLOW · FERAL) — the
spikes ARE your reading. Inspired by the humanoid "what's your vibe today?"
campaign.

Two modes:

- **AUTO READ** — face blendshapes drive the axes live: go wide-eyed and VOLT
  spikes, scowl and STATIC swells, tilt away dreamily and DRIFT grows.
- **SCULPT** (`M`) — pinch a spike tip with your hand (or drag it with the
  mouse) and pull the reading where you think it should be. Fists snap back
  to the machine's opinion.

Press **READ** (`SPACE`) → a 2.4s sampling ring → the chart locks, the machine
names your vibe (SUGAR GLITCH, NIGHT STATIC, PAPER GHOST…) with a short
spec-sheet verdict, and `S` saves a 1080×1920 poster. `R` resets.

Everything runs client-side: no backend, no account, nothing recorded or
uploaded. The only thing persisted is a reading counter in `localStorage`.

## Run locally

```bash
python3 -m http.server 8000
# → http://localhost:8000  (camera needs http://localhost or https)
```

## Architecture (vanilla no-build ES modules)

- `js/config.js` — every feel-knob: axis blendshape weights, warp constants,
  chart geometry, scan timing, ticker copy, and all verdict copy.
- `js/tracking.js` — MediaPipe FaceLandmarker (blendshapes) + ImageSegmenter
  (person mask), CDN-loaded, GPU→CPU fallback; HandLandmarker lazy-loads on
  first SCULPT. Decoupled from the render loop; failures degrade gracefully.
- `js/axes.js` — blendshapes + head-motion features → five smoothed axis
  values (pure math exported for tests).
- `js/warp.js` — the trick: per-direction radial remap in a fragment shader
  so the mask silhouette lands exactly on the radar polygon. Pure profile
  math (`polygonRadii`, `silhouetteRadii`) is testable headlessly.
- `js/hud.js` — the radar chart (rings/spokes under the head, labels/values/
  markers over it), scan ring, capture flash, grip crosses. Takes an explicit
  chart object so the poster reuses it.
- `js/gestures.js` — pinch/fist/grip math over hand landmarks (HÄND STUDIO).
- `js/results.js` — verdict picker (two tallest spikes → a named archetype;
  flat-and-low → PAPER GHOST; everything lit → VELVET STORM) + the reading
  counter.
- `js/poster.js` — 1080×1920 PNG export.
- `js/app.js` — state machine (LIVE → SCAN → LOCKED), AUTO/SCULPT modes,
  render loop, input, screens.

Preview-sandbox note: the sandbox has no webcam and the hidden tab pauses
`requestAnimationFrame`, so verify the start/error screens plus headless eval
tests of the pure math; the live warp needs a real localhost with a camera.
