/* =============================================
   HERO 3D MODEL — interactive head / eye tracking
   ---------------------------------------------
   Replaces the flower art in .hero-right with an
   interactive glTF model. The model sits in side
   view; its `head` bone turns to face the camera
   and follows the cursor, and the `eye.R` / `eye.L`
   bones add a little extra eye movement.

   Rendering is plain Three.js (no React) with a
   damped rAF loop, so pointer response is smooth
   and never blocks the main thread.

   ── If the model looks wrong, tune these ──────
   Everything you might need to adjust lives in the
   CONFIG block below.
   ============================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Post-processing: a composer we swap effect passes in/out of, toggled by the
// "fx" button. Each pass is created disabled and switched on per mode below.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { DotScreenPass } from 'three/addons/postprocessing/DotScreenPass.js';

const CONFIG = {
  modelUrl: 'models/materialtest.glb',

  // Bone names as authored in Blender. head + neck are driven for the look; the
  // cornea bones carry the eyeball mesh and are driven for the extra eye flick.
  // (The `eyec1` controllers rely on a Blender constraint that does NOT export
  // to glTF, so `cornea.R`/`cornea.L` are used directly instead.)
  headBone:   'head',
  neckBone:   'neck',
  eyeRBone:   'cornea.R',
  eyeLBone:   'cornea.L',

  // The model ships with a single held "resting" pose baked into its
  // animation clip (the seated pose). We play the clip and freeze it at this
  // time (seconds) so the body sits in that pose, then layer cursor tracking
  // on top of the head / neck / eyes.
  poseTime: 1.25,

  // Body orientation. The model is shown in SIDE view (profile), so we yaw the
  // whole model 90°. +90° shows the body facing left (matching the reference);
  // flip the sign to mirror to the other side.
  sideViewYaw: Math.PI / 2,   // radians, applied to the loaded model

  // In the resting pose the head is curled down; at rest we aim the face at
  // the camera by rotating the head so its face-forward axis (head-local +X)
  // points toward the viewer. This is the world-space neutral facing.
  faceAimYaw: -Math.PI / 2,   // radians about world-up (measured from the rig)

  // Cursor tracking, applied as WORLD-space yaw/pitch on top of the neutral
  // facing (robust regardless of how far the head is turned). The neck takes a
  // share so the whole neck-head chain cranes, like a real look up / down.
  lookYaw:      Math.PI / 2, // max face turn to the LEFT (90° → full side profile)
  lookYawRight: 0.34,        // max face turn to the RIGHT — small, so it only
                             //   cranes a little behind the neck on that side
  lookPitch:  0.42,          // max face tilt up/down, radians
  neckShare:  0.42,          // fraction of the look the neck contributes (cranes)

  // Horizontal screen position (0=left … 1=right) where the head faces the
  // camera head-on. Because the model is offset to the right, the neutral point
  // sits right of centre — so the cursor over the model = straight ahead, and
  // the far left of the page = a full turn.
  neutralX:   0.62,

  // Eyes. The eye bones are parented to the armature root (not the head), so
  // when the head turns to face the camera the sockets move but the eyeballs
  // don't — leaving them mis-positioned. We reparent the eye bones under the
  // head so they ride with it, then rotate the cornea bones for the eye flick.
  eyeLookYaw:   0.16,   // extra eye turn left/right, radians
  eyeLookPitch: 0.12,   // extra eye turn up/down,   radians
  eyeSaccade:   0.07,   // amplitude of idle eye darts (radians) for life

  // Camera framing (metres, model-dependent — auto-fit adjusts distance).
  cameraFov:      32,
  verticalFill:   1.5,    // model height as a fraction of the viewport; >1 = top/bottom crop
                          //   (higher = more zoomed in / more crop top & bottom)
  focusY:         0.2,    // raise the framing toward the head (fraction of model
                          //   height): keeps the hair crop roughly the same while
                          //   cropping the legs off the bottom much more
  modelShiftX:    0.32,   // push the model to the RIGHT (fraction of model width);
                          //   right of centre but still fully on screen
  minWidthFit:    1.02,   // ensure the model width still fits (with a hair of margin)
  cameraTilt:     0.16,   // downward camera tilt (radians) so the ground shadow shows

  // Motion smoothing. Lower = smoother/slower catch-up (0–1 per frame).
  damping:        0.12,
};

/* Glyph face for the ASCII pass — the site's own self-hosted family (see
   css/style.css). 500 is the Medium cut; at this size it holds together
   better than Roman. These must be declared ABOVE the initHero3D() call
   below: initHero3D builds the glyph atlas synchronously, and a `const`
   declared further down the module would still be in its temporal dead
   zone at that point, throwing before anything renders. */
const GLYPH_FAMILY = "'Neue Haas Grotesk Display'";
const GLYPH_WEIGHT = 500;
const GLYPH_FONT = GLYPH_WEIGHT + " %SIZE%px " + GLYPH_FAMILY +
                   ", 'Helvetica Neue LT', Helvetica, Arial, sans-serif";

const container = document.getElementById('hero3d');
if (container && supportsWebGL()) {
  initHero3D(container);
} else {
  // No WebGL / no mount — unblock the site loader.
  document.dispatchEvent(new Event('hero-model-ready'));
}

function supportsWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}

/* Draw a row of characters to a canvas → a texture atlas the ASCII shader
   samples (glyph i lives in the i-th 1/N slice of the width).

   Sharpness comes from drawing each glyph at ~2x the size it will actually
   occupy on screen. At exactly 2x, the bilinear filter's four taps cover the
   2x2 block being reduced, so the downsample is a clean box average — the
   letterforms come out smooth instead of aliased. Drawing at a fixed 64px
   and then squeezing that into an 18px cell, as this did before, throws away
   most of those pixels unevenly and is what made the type look ragged.
   The GLYPH_* constants it uses are declared near the top of the module,
   above the initHero3D() call. */
function makeGlyphAtlas(chars, cellPx) {
  const n = chars.length;
  // Glyph box on screen, in device pixels, doubled for the supersample.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const size = Math.max(24, Math.min(128, Math.round(cellPx * dpr) * 2));

  const cv = document.createElement('canvas');
  cv.width = n * size;
  cv.height = size;

  const ctx = cv.getContext('2d', { alpha: false });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#fff';
  // 0.7 keeps the widest glyphs (@ % 8) clear of the cell edges, which is
  // what stops neighbours bleeding into each other when the shader samples
  // across a boundary.
  ctx.font = GLYPH_FONT.replace('%SIZE%', String(Math.round(size * 0.7)));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    ctx.fillText(chars[i], i * size + size / 2, size / 2 + size * 0.03);
  }

  const texture = new THREE.CanvasTexture(cv);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;   // coverage mask, not colour
  texture.needsUpdate = true;
  return { texture, count: n, size };
}

function initHero3D(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';

  const scene = new THREE.Scene();

  // Opaque background matching the page (--bg), kept in sync with the light/dark
  // toggle. An opaque background is what lets the bloom/glow pass composite
  // correctly — over a transparent canvas the bloom darkens the page behind it.
  function applySceneBg() {
    const c = getComputedStyle(document.documentElement)
      .getPropertyValue('--bg').trim() || '#ffffff';
    scene.background = new THREE.Color(c);
  }
  applySceneBg();
  new MutationObserver(applySceneBg).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });

  // Neutral studio environment so the metallic body has something bright to
  // reflect — without it, a white metal reads as flat grey.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(CONFIG.cameraFov, 1, 0.01, 100);
  camera.position.set(0, 0, 5);

  // Soft fill lighting on top of the environment.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 0.6));
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-3, 1, 2);
  scene.add(fill);

  // Key light that casts the ground shadow (positioned/aimed once the model is
  // framed, in setupShadow()).
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);   // higher res so the soft blur stays clean
  key.shadow.radius = 6;                 // wider PCF kernel → softer edges
  key.shadow.bias = -0.0005;
  scene.add(key);
  scene.add(key.target);

  // Transparent ground plane that only shows the cast shadow.
  const shadowPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ opacity: 0.16 })
  );
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  // ── Post-processing composer ───────────────────────────────────────────────
  // Built once; every effect pass starts disabled. A mode just flips `enabled`
  // on the passes it wants. `none` bypasses the composer entirely so it renders
  // pixel-identical to the plain path.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  // Subtle bloom: a high threshold means only the already-bright highlights
  // bloom (not the whole model); low strength + wide radius keeps it to a soft
  // halo/blur on those hotspots rather than an overall glow.
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.85, 0.9);
  bloomPass.enabled = false;
  composer.addPass(bloomPass);

  const rgbShiftPass = new ShaderPass(RGBShiftShader);
  rgbShiftPass.uniforms.amount.value = 0.0022;
  rgbShiftPass.enabled = false;
  composer.addPass(rgbShiftPass);

  const dotPass = new DotScreenPass(new THREE.Vector2(0.5, 0.5), 1.05, 0.9);
  // The stock DotScreen shader emits large NEGATIVE values for near-black pixels
  // (average*10 − 5). The later OutputPass runs ACES tone-mapping, which is a
  // rational curve that flips those negatives back up to ~1.0 — turning the black
  // dark-mode background solid WHITE. Clamp the shader output to [0,1] so black
  // stays black in both themes.
  dotPass.material.fragmentShader = dotPass.material.fragmentShader.replace(
    'vec3( average * 10.0 - 5.0 + pattern() )',
    'clamp( vec3( average * 10.0 - 5.0 + pattern() ), 0.0, 1.0 )'
  );
  dotPass.material.needsUpdate = true;
  dotPass.enabled = false;
  composer.addPass(dotPass);

  const filmPass = new FilmPass(0.4, false);   // (intensity, grayscale)
  filmPass.enabled = false;
  composer.addPass(filmPass);

  // ── ASCII pass ──────────────────────────────────────────────────────────
  // Dense glyph grid: luminance drives ink amount; each cell independently
  // cycles through the charset over time (per-character flicker). Smaller
  // uCell → finer "pixels" and a clearer read of the 3D form.
  const ASCII_CHARS = ' .\'`^",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';
  const ASCII_CELL = 9.0;   // CSS px per glyph — smaller = denser / clearer model
  const asciiGlyphs = makeGlyphAtlas(ASCII_CHARS, ASCII_CELL);
  const asciiPass = new ShaderPass({
    uniforms: {
      tDiffuse:    { value: null },
      tGlyphs:     { value: asciiGlyphs.texture },
      uGlyphCount: { value: asciiGlyphs.count },
      uCell:       { value: ASCII_CELL },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime:       { value: 0 },
      uInk:        { value: new THREE.Color(0xffffff) },
      uPaper:      { value: new THREE.Color(0x000000) },
      uInvert:     { value: 0 },      // 1 in light theme (ink where scene is dark)
    },
    vertexShader:
      'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: [
      'uniform sampler2D tDiffuse; uniform sampler2D tGlyphs;',
      'uniform float uGlyphCount, uCell, uTime, uInvert;',
      'uniform vec2 uResolution; uniform vec3 uInk, uPaper;',
      'varying vec2 vUv;',
      'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
      'void main(){',
      '  vec2 px = vUv * uResolution;',
      '  vec2 cell = floor(px / uCell);',
      '  vec2 centre = (cell * uCell + uCell * 0.5) / uResolution;',
      '  vec3 src = texture2D(tDiffuse, centre).rgb;',
      '  float lum = clamp(dot(src, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);',
      '  float ink = mix(lum, 1.0 - lum, uInvert);',
      // Per-cell phase so every character cycles on its own clock
      '  float phase = hash(cell) * 64.0;',
      '  float tick = floor(uTime * 20.0 + phase);',
      '  float gi = floor(mod(hash(cell + vec2(tick, tick * 1.37)) * uGlyphCount, uGlyphCount));',
      '  vec2 sub = fract(px / uCell);',
      // Keep the sample a hair inside the glyph's slice. Without this, the
      // bilinear tap at the very edge of a cell reaches into the neighbouring
      // character and smears a ghost of it into this one.
      '  float inset = 0.5 / (uGlyphCount * uCell);',
      '  float u = (gi + clamp(sub.x, inset, 1.0 - inset)) / uGlyphCount;',
      '  float glyph = texture2D(tGlyphs, vec2(u, sub.y)).r;',
      // Pull the soft downsampled edge back to a defined one. The band is
      // deliberately narrow rather than a hard step, so the letters stay
      // anti-aliased instead of turning crunchy.
      '  glyph = smoothstep(0.34, 0.66, glyph);',
      '  float a = glyph * smoothstep(0.04, 0.45, ink);',
      '  gl_FragColor = vec4(mix(uPaper, uInk, a), 1.0);',
      '}',
    ].join('\n'),
  });
  asciiPass.enabled = false;
  composer.addPass(asciiPass);

  function updateAsciiTheme() {
    const cs = getComputedStyle(document.documentElement);
    asciiPass.uniforms.uInk.value.set((cs.getPropertyValue('--fg').trim()) || '#fff');
    asciiPass.uniforms.uPaper.value.set((cs.getPropertyValue('--bg').trim()) || '#000');
    const dark = document.documentElement.getAttribute('data-theme') !== 'light';
    asciiPass.uniforms.uInvert.value = dark ? 0.0 : 1.0;
  }
  updateAsciiTheme();
  new MutationObserver(updateAsciiTheme).observe(document.documentElement, {
    attributes: true, attributeFilter: ['data-theme'],
  });

  /* The atlas above was drawn the moment this ran, which may be before the
     webfont finished loading — canvas silently falls back to a default face,
     and the glyphs come out in the wrong typeface. Redraw once the font is
     genuinely available, and again if the window moves to a display with a
     different pixel ratio (the atlas is sized to that). */
  let atlasDpr = Math.min(window.devicePixelRatio || 1, 2);

  function rebuildGlyphAtlas() {
    const next = makeGlyphAtlas(ASCII_CHARS, ASCII_CELL);
    const prev = asciiPass.uniforms.tGlyphs.value;
    asciiPass.uniforms.tGlyphs.value = next.texture;
    asciiPass.uniforms.uGlyphCount.value = next.count;
    if (prev && prev.dispose) prev.dispose();
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load(GLYPH_WEIGHT + ' 64px ' + GLYPH_FAMILY)
      .then(() => document.fonts.ready)
      .then(rebuildGlyphAtlas)
      .catch(() => {});
  }

  function checkAtlasScale() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== atlasDpr) {
      atlasDpr = dpr;
      rebuildGlyphAtlas();
    }
  }

  composer.addPass(new OutputPass());          // tone-map + sRGB, last

  // Effect modes: name shown on the button + which passes it switches on.
  const FX_MODES = [
    { name: 'none',   on: [] },
    { name: 'glow',   on: [bloomPass] },
    { name: 'chroma', on: [rgbShiftPass] },
    { name: 'film',   on: [filmPass] },
    { name: 'dots',   on: [dotPass] },
    { name: 'ascii',  on: [asciiPass] },
    { name: 'vhs',    on: [rgbShiftPass, filmPass, bloomPass] },
  ];
  let fxIndex = 5;   // default to "ascii"

  function applyFxMode() {
    const mode = FX_MODES[fxIndex];
    [bloomPass, rgbShiftPass, dotPass, filmPass, asciiPass].forEach((p) => { p.enabled = false; });
    mode.on.forEach((p) => { p.enabled = true; });
    const label = document.getElementById('fxLabel');
    if (label) label.textContent = mode.name;
  }

  applyFxMode();   // ascii is the only effect now — no toggle button left to cycle it

  // Pointer state (normalised −1..1, centre = 0). Damped toward in the loop.
  const pointer = { x: 0, y: 0 };
  const target  = { x: 0, y: 0 };

  let head = null, neck = null;
  let modelSize = null;     // THREE.Vector3, set once the model loads
  let mixer = null;         // AnimationMixer holding the frozen resting pose

  // World-space aiming constants (computed once the model + pose are ready).
  let faceAim = null;           // head world quaternion that faces the camera
  let neckParentWorld = null;   // neck's parent world quaternion (pose is frozen → constant)
  let neckRestLocal = null;     // neck local quaternion in the resting pose
  let neckWorldNeutral = null;  // neck world quaternion in the resting pose
  const corneas = [];           // [{ bone, rest }] eye bones reparented under the head

  const loader = new GLTFLoader();
  loader.load(
    CONFIG.modelUrl,
    (gltf) => {
      const model = gltf.scene;
      model.rotation.y = CONFIG.sideViewYaw;

      // Freeze the baked resting (seated) pose ONCE: the clip's two keyframes
      // are identical (a single held pose that already places the eyes), so we
      // pose the whole body here and never touch the mixer again. From now on
      // only head / neck / cornea are moved, relative to this frozen pose.
      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        mixer.clipAction(gltf.animations[0]).play();
        mixer.setTime(CONFIG.poseTime);
        mixer.update(0);
        model.updateMatrixWorld(true);
      }

      // Auto-centre using skinning-aware bounds (now in the resting pose),
      // then store size so resize() can reframe for any viewport aspect.
      modelSize = skinnedBounds(model);
      scene.add(model);
      resize();

      // Signal the loading screen (js/main.js) that the hero is ready to show.
      document.dispatchEvent(new Event('hero-model-ready'));

      // Cast shadows: let the model cast, sit the ground plane at its base, and
      // aim the key light from above-front so the shadow falls below it.
      model.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      const groundY = -modelSize.y / 2;
      shadowPlane.position.y = groundY;
      const reach = Math.max(modelSize.x, modelSize.y, modelSize.z);
      key.position.set(reach * 0.6, groundY + reach * 2.2, reach * 1.1);
      key.target.position.set(0, groundY, 0);
      const s = key.shadow.camera;
      s.left = -reach; s.right = reach; s.top = reach; s.bottom = -reach;
      s.near = 0.1; s.far = reach * 5;
      s.updateProjectionMatrix();

      // GLTFLoader strips dots from node names, so resolve bones ignoring
      // dots/spaces to keep the Blender names in CONFIG.
      head = findBone(model, CONFIG.headBone);
      neck = findBone(model, CONFIG.neckBone);

      // Precompute the world-space aiming frame. `faceAim` is the head's world
      // orientation that points the face (head-local +X) at the camera; the
      // neck constants let the neck crane while the body pose stays frozen.
      if (head && neck) {
        model.updateWorldMatrix(true, true);
        neckParentWorld = neck.parent.getWorldQuaternion(new THREE.Quaternion());
        neckRestLocal = neck.quaternion.clone();
        neckWorldNeutral = neckParentWorld.clone().multiply(neckRestLocal);
        // Face the camera, tilted up by the camera's downward tilt so the gaze
        // meets the (slightly elevated) viewer.
        faceAim = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -CONFIG.cameraTilt)
          .multiply(new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0), CONFIG.faceAimYaw));
      }

      // Reparent the eye bones under the head so the eyeballs ride with it
      // (they're authored under the armature root, so otherwise they stay put
      // while the head turns). `head.attach` preserves world transform, so the
      // frozen pose is unchanged — the eyes just now follow the head. Then keep
      // the cornea bones (which the eyeball mesh is skinned to) for the flick.
      if (head) {
        const eyeR = findBone(model, 'eye.R');
        const eyeL = findBone(model, 'eye.L');
        [eyeR, eyeL].forEach((eye) => { if (eye) head.attach(eye); });

        [CONFIG.eyeRBone, CONFIG.eyeLBone].forEach((name) => {
          const bone = findBone(model, name);
          if (bone) corneas.push({ bone, rest: bone.quaternion.clone() });
        });
      }

      if (!head) {
        console.warn('[hero3d] Head bone "' + CONFIG.headBone +
          '" not found. Available named nodes:', collectNames(model));
      }
    },
    // Download progress → the loading screen's bar (js/main.js). Only
    // reported when the server sends a length; otherwise the model simply
    // counts as unfinished until it lands, rather than showing a made-up
    // number.
    (evt) => {
      if (!evt || !evt.lengthComputable || !evt.total) return;
      document.dispatchEvent(new CustomEvent('hero-model-progress', {
        detail: { loaded: evt.loaded, total: evt.total,
                  fraction: evt.loaded / evt.total },
      }));
    },
    (err) => {
      console.error('[hero3d] Failed to load ' + CONFIG.modelUrl +
        '. If the .glb is empty, re-export from Blender ' +
        'without "Limit to → Selected Objects" (or select the mesh + armature first).', err);
      document.dispatchEvent(new Event('hero-model-ready'));
    }
  );

  // Track the pointer across the whole viewport, mapped to −1..1 over the container.
  window.addEventListener('pointermove', (e) => {
    const r = container.getBoundingClientRect();
    // Map x so 0 = neutral at the model's on-screen position (neutralX), −1 at
    // the far left, +1 at the far right — the two sides scaled independently so
    // the head faces the camera over the model and turns fully at the edges.
    const fx = (e.clientX - r.left) / r.width;
    const nx = CONFIG.neutralX;
    target.x = clamp(fx < nx ? (fx - nx) / nx : (fx - nx) / (1 - nx), -1, 1);
    target.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
  }, { passive: true });

  // Ease back to centre when the pointer leaves the window.
  window.addEventListener('pointerleave', () => { target.x = 0; target.y = 0; });

  const _dWorld = new THREE.Quaternion();
  const _qy = new THREE.Quaternion();
  const _qx = new THREE.Quaternion();
  const _neckNow = new THREE.Quaternion();
  const _eyeDelta = new THREE.Quaternion();
  const _eyeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const X_AXIS = new THREE.Vector3(1, 0, 0);

  // Idle eye saccades: every so often the eyes dart to a new small offset, then
  // hold — a quick ease toward the target reads as a natural flick. Added on top
  // of the cursor-driven eye motion.
  const saccade = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };

  // A world-space yaw (about up) + pitch (about the side axis) rotation.
  function worldDelta(yaw, pitch) {
    _qy.setFromAxisAngle(Y_AXIS, yaw);
    _qx.setFromAxisAngle(X_AXIS, pitch);
    return _dWorld.copy(_qy).multiply(_qx);
  }

  // Only render while the hero is on screen — once it scrolls away (e.g. the
  // whole work section), skip the WebGL draw + post-processing entirely, which
  // is the single biggest cost on the page. rAF keeps ticking (cheap) so it
  // resumes instantly when the hero returns.
  let heroVisible = true;
  new IntersectionObserver((entries) => {
    heroVisible = entries[0].isIntersecting;
  }, { threshold: 0 }).observe(container);

  function render() {
    requestAnimationFrame(render);
    if (!heroVisible) return;

    pointer.x += (target.x - pointer.x) * CONFIG.damping;
    pointer.y += (target.y - pointer.y) * CONFIG.damping;

    // The body stays in the frozen pose (posed once at load). Each frame we
    // only move head / neck / cornea, relative to that pose, for cursor tracking.
    if (head && faceAim) {
      // Asymmetric: full 90° turn to the left, but only a small turn to the
      // right (so it can't crane all the way behind its neck on that side).
      const yaw   = pointer.x < 0 ? pointer.x * CONFIG.lookYaw
                                  : pointer.x * CONFIG.lookYawRight;
      const pitch = pointer.y * CONFIG.lookPitch;  // cursor up → look up (screen y is inverted)

      // Neck cranes a share of the look, so up/down reads as a real neck bend
      // rather than the head pivoting on a fixed neck.
      if (neck && neckWorldNeutral) {
        const neckWorld = worldDelta(yaw * CONFIG.neckShare, pitch * CONFIG.neckShare)
          .multiply(neckWorldNeutral);
        neck.quaternion.copy(neckParentWorld).invert().multiply(neckWorld);
      }

      // Head aims the face at the camera (faceAim) plus the cursor offset, in
      // world space — robust no matter how far it is turned (no gimbal roll).
      // getWorldQuaternion refreshes the neck's world matrix after the update.
      const headWorld = worldDelta(yaw, pitch).multiply(faceAim);
      neck.getWorldQuaternion(_neckNow);
      head.quaternion.copy(_neckNow).invert().multiply(headWorld);

      // Idle saccades: pick a new random dart target on a randomised interval,
      // then ease quickly toward it (fast catch-up = a natural flick + hold).
      const now = performance.now();
      if (now > saccade.next) {
        saccade.tx = (Math.random() * 2 - 1) * CONFIG.eyeSaccade;
        saccade.ty = (Math.random() * 2 - 1) * CONFIG.eyeSaccade * 0.6;
        saccade.next = now + 900 + Math.random() * 2600;
      }
      saccade.x += (saccade.tx - saccade.x) * 0.4;
      saccade.y += (saccade.ty - saccade.y) * 0.4;

      // Eyes: the eyeballs follow the head (reparented above); on top of that we
      // flick the cornea bones toward the cursor, plus the idle saccade, for life.
      _eyeEuler.set(pointer.y * CONFIG.eyeLookPitch + saccade.y,
                    pointer.x * CONFIG.eyeLookYaw + saccade.x, 0, 'YXZ');
      _eyeDelta.setFromEuler(_eyeEuler);
      for (let i = 0; i < corneas.length; i++) {
        corneas[i].bone.quaternion.copy(corneas[i].rest).multiply(_eyeDelta);
      }
    }

    // `none` renders straight through; any other mode routes through the
    // composer so its enabled passes apply.
    if (fxIndex === 0) {
      renderer.render(scene, camera);
    } else {
      if (asciiPass.enabled) {
        const t = performance.now() / 1000;
        asciiPass.uniforms.uTime.value = t;
        if (asciiPass.material && asciiPass.material.uniforms && asciiPass.material.uniforms.uTime) {
          asciiPass.material.uniforms.uTime.value = t;
        }
      }
      composer.render();
    }
  }
  requestAnimationFrame(render);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    asciiPass.uniforms.uResolution.value.set(w, h);   // CSS px → cell size stays constant
    checkAtlasScale();
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    // Frame the model large and centred: fill the viewport height (so the top
    // and bottom crop a little), but back off if that would clip the width.
    if (modelSize) {
      const vFov = camera.fov * Math.PI / 180;
      const tan = Math.tan(vFov / 2);
      const distFill = (modelSize.y / 2) / tan / CONFIG.verticalFill;
      const distWidth = (modelSize.x / 2) / tan / camera.aspect * CONFIG.minWidthFit;
      const dist = Math.max(distFill, distWidth);
      // Orbit the camera up by cameraTilt so it looks slightly down — the model
      // stays framed at `dist`, and the ground shadow becomes visible. `focusY`
      // raises the aim toward the head so the legs crop off the bottom while the
      // hair stays where it is. The model itself stays horizontally centred.
      const t = CONFIG.cameraTilt;
      const focusY = modelSize.y * CONFIG.focusY;
      // Shift camera + aim left by the same amount so the model slides to the
      // RIGHT of frame (undistorted) — clearing the left side for the text.
      const shiftX = modelSize.x * CONFIG.modelShiftX;
      camera.position.set(-shiftX, focusY + dist * Math.sin(t), dist * Math.cos(t));
      camera.lookAt(-shiftX, focusY, 0);
    }
  }
  window.addEventListener('resize', resize, { passive: true });
  resize();
}

/* Centre the model at the origin using SKINNING-AWARE bounds and return its
   world-space size. `Box3.setFromObject` ignores skinning and badly
   under-measures rigged characters, so we union each SkinnedMesh's own
   (bone-transformed) bounding box instead. */
function skinnedBounds(model) {
  model.updateWorldMatrix(true, true);
  const box = new THREE.Box3(); box.makeEmpty();
  const tmp = new THREE.Box3();
  let found = false;
  model.traverse((o) => {
    if (o.isSkinnedMesh && typeof o.computeBoundingBox === 'function') {
      o.computeBoundingBox();                       // applies bone transforms
      tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp); found = true;
    } else if (o.isMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp); found = true;
    }
  });
  if (!found) box.setFromObject(model);

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  return size;
}

/* Resolve a bone by name, ignoring dots/spaces (GLTFLoader strips them). */
function findBone(root, name) {
  let bone = root.getObjectByName(name);
  if (bone) return bone;
  const norm = (s) => s.replace(/[.\s]/g, '');
  const want = norm(name);
  root.traverse((o) => { if (!bone && o.name && norm(o.name) === want) bone = o; });
  return bone;
}

function collectNames(root) {
  const names = [];
  root.traverse((o) => { if (o.name) names.push(o.name); });
  return names;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
