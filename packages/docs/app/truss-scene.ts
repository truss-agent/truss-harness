/**
 * The landing hero's holographic workshop: two rotating geodesic truss cores,
 * a sweeping space-frame beam carrying orange energy packets, floating
 * holographic agent panels, rising light streaks, a scrolling triangular
 * floor and drifting dust, all through a bloom pass. The camera follows the
 * pointer.
 *
 * Loaded lazily by `hero-scene.tsx` so three.js never blocks first paint.
 * Everything created here is released by `dispose()`.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

export type TrussScene = { dispose(): void };

const BG = 0x050d0b;
const TEAL = new THREE.Color(0x18c4a3);
const MINT = new THREE.Color(0xa8e4cc);
const ORANGE = new THREE.Color(0xf28a43);

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
} as const;

const VERT_UV =
  "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";

function glowTexture(inner: string) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.2, inner);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------------------ */
/* Energy-carrying line shader (beam and cores)                              */
/* ------------------------------------------------------------------------ */

const MEMBER_VERT = /* glsl */ `
attribute float aAlong;
attribute float aSeed;
attribute float aKind;
varying float vAlong;
varying float vSeed;
varying float vKind;
varying float vDepth;
void main() {
  vAlong = aAlong; vSeed = aSeed; vKind = aKind;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const MEMBER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uLevel;
uniform vec3 uTeal;
uniform vec3 uMint;
uniform vec3 uHot;
varying float vAlong;
varying float vSeed;
varying float vKind;
varying float vDepth;
void main() {
  float speed = vKind < 0.5 ? 0.5 : 0.85;
  float phase = fract(vAlong - uTime * speed + vSeed * 7.0);
  float packet = pow(1.0 - phase, 16.0);
  float gate = vKind < 0.5 ? 1.0 : step(0.68, fract(vSeed * 13.0 + floor(uTime * 0.4 + vSeed * 5.0) * 0.37));
  float flicker = 0.88 + 0.12 * sin(uTime * 11.0 + vSeed * 60.0);
  vec3 base = mix(uTeal, uMint, vKind > 0.5 && vKind < 1.5 ? 0.6 : 0.2);
  float baseLevel = vKind < 0.5 ? 0.75 : 0.45;
  vec3 col = base * baseLevel * flicker * uLevel;
  col += uHot * packet * gate * 2.6;
  float fog = 1.0 - smoothstep(14.0, 42.0, vDepth);
  gl_FragColor = vec4(col * fog, 1.0);
}`;

function memberMaterial(level: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uLevel: { value: level },
      uTeal: { value: TEAL },
      uMint: { value: MINT },
      uHot: { value: ORANGE },
    },
    vertexShader: MEMBER_VERT,
    fragmentShader: MEMBER_FRAG,
    ...additive,
  });
}

type Member = { a: THREE.Vector3; b: THREE.Vector3; kind: number };

function linesFrom(members: Member[], material: THREE.ShaderMaterial) {
  const n = members.length * 2;
  const pos = new Float32Array(n * 3);
  const along = new Float32Array(n);
  const seed = new Float32Array(n);
  const kind = new Float32Array(n);
  members.forEach((m, i) => {
    const s = Math.random();
    const flip = Math.random() < 0.5;
    [m.a, m.b].forEach((p, j) => {
      const v = i * 2 + j;
      pos.set([p.x, p.y, p.z], v * 3);
      along[v] = flip ? 1 - j : j;
      seed[v] = s;
      kind[v] = m.kind;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
  return new THREE.LineSegments(geo, material);
}

/* ------------------------------------------------------------------------ */
/* Space-frame beam                                                          */
/* ------------------------------------------------------------------------ */

function buildBeam(material: THREE.ShaderMaterial) {
  const bays = 34;
  const radius = 0.9;
  const spine = (t: number) =>
    new THREE.Vector3(
      THREE.MathUtils.lerp(-24, 24, t),
      Math.sin(t * Math.PI * 1.2) * 1.2 - 3.2,
      -9 + Math.sin(t * Math.PI) * 3.5,
    );
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= bays; i++) {
    const t = i / bays;
    const c = spine(t);
    const ahead = spine(Math.min(1, t + 0.01))
      .sub(spine(Math.max(0, t - 0.01)))
      .normalize();
    const side = new THREE.Vector3()
      .crossVectors(ahead, new THREE.Vector3(0, 1, 0))
      .normalize();
    const up = new THREE.Vector3().crossVectors(side, ahead).normalize();
    rings.push(
      [0, 1, 2].map((k) => {
        const a = t * 2 + (k * Math.PI * 2) / 3;
        return c
          .clone()
          .addScaledVector(up, Math.cos(a) * radius)
          .addScaledVector(side, Math.sin(a) * radius);
      }),
    );
  }
  const members: Member[] = [];
  rings.forEach((ring, i) => {
    for (let k = 0; k < 3; k++)
      members.push({ a: ring[k], b: ring[(k + 1) % 3], kind: 1 });
    const next = rings[i + 1];
    if (!next) return;
    for (let k = 0; k < 3; k++) {
      members.push({ a: ring[k], b: next[k], kind: 0 });
      members.push({
        a: ring[k],
        b: next[(k + (i % 2 ? 2 : 1)) % 3],
        kind: 2,
      });
    }
  });
  return { lines: linesFrom(members, material), joints: rings.flat() };
}

/* ------------------------------------------------------------------------ */
/* Geodesic truss cores                                                      */
/* ------------------------------------------------------------------------ */

function geodesicMembers(radius: number, detail: number, kind: number) {
  const geo = new THREE.IcosahedronGeometry(radius, detail);
  const edges = new THREE.EdgesGeometry(geo, 1);
  const p = edges.getAttribute("position");
  const members: Member[] = [];
  for (let i = 0; i < p.count; i += 2) {
    members.push({
      a: new THREE.Vector3().fromBufferAttribute(p, i),
      b: new THREE.Vector3().fromBufferAttribute(p, i + 1),
      kind,
    });
  }
  geo.dispose();
  edges.dispose();
  return members;
}

function buildCore(material: THREE.ShaderMaterial, glow: THREE.Texture) {
  const group = new THREE.Group();
  const outer = linesFrom(geodesicMembers(2.3, 2, 0), material);
  const inner = linesFrom(geodesicMembers(1.15, 1, 2), material);
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: ORANGE,
      opacity: 0.5,
      ...additive,
    }),
  );
  halo.scale.setScalar(2.2);
  const aura = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glow,
      color: TEAL,
      opacity: 0.1,
      ...additive,
    }),
  );
  aura.scale.setScalar(7);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.05, 3.1, 96),
    new THREE.MeshBasicMaterial({
      color: MINT,
      side: THREE.DoubleSide,
      opacity: 0.55,
      ...additive,
    }),
  );
  ring.rotation.x = Math.PI / 2.4;
  group.add(aura, outer, inner, halo, ring);
  return { group, outer, inner, ring, halo };
}

/* ------------------------------------------------------------------------ */
/* Holographic panels                                                        */
/* ------------------------------------------------------------------------ */

type PanelLine = { text: string; color?: string };

function panelTexture(title: string, lines: PanelLine[]) {
  const w = 640;
  const h = 400;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  ctx.fillStyle = "rgba(24,196,163,0.07)";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(168,228,204,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  // HUD corner brackets.
  ctx.strokeStyle = "rgba(242,138,67,0.95)";
  ctx.lineWidth = 6;
  const c = 34;
  for (const [x, y, dx, dy] of [
    [4, 4, 1, 1],
    [w - 4, 4, -1, 1],
    [4, h - 4, 1, -1],
    [w - 4, h - 4, -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(x, y + dy * c);
    ctx.lineTo(x, y);
    ctx.lineTo(x + dx * c, y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(24,196,163,0.22)";
  ctx.fillRect(10, 10, w - 20, 54);
  ctx.font = "600 26px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "#d8fff0";
  ctx.fillText(title, 32, 46);
  ctx.font = "24px ui-monospace, Menlo, monospace";
  lines.forEach((line, i) => {
    ctx.fillStyle = line.color ?? "rgba(190,240,220,0.85)";
    ctx.fillText(line.text, 32, 110 + i * 46);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const PANEL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float scan = 0.82 + 0.18 * sin(vUv.y * 220.0 - uTime * 6.0);
  float band = abs(fract(uTime * 0.18 + uSeed) - (1.0 - vUv.y));
  float sweep = (1.0 - smoothstep(0.0, 0.04, band)) * 1.5;
  float flicker = 0.9 + 0.1 * sin(uTime * 23.0 + uSeed * 40.0);
  gl_FragColor = vec4(t.rgb * t.a * scan * flicker * (1.0 + sweep), 1.0);
}`;

function buildPanel(texture: THREE.Texture, seed: number) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uTime: { value: 0 },
      uSeed: { value: seed },
    },
    vertexShader: VERT_UV,
    fragmentShader: PANEL_FRAG,
    side: THREE.DoubleSide,
    ...additive,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(4.8, 3), material);
}

/* ------------------------------------------------------------------------ */
/* Floor, streaks, dust                                                      */
/* ------------------------------------------------------------------------ */

const FLOOR_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vUv;
float tri(vec2 p) {
  vec3 d = vec3(p.y, dot(p, vec2(0.866, 0.5)), dot(p, vec2(0.866, -0.5)));
  vec3 g = abs(fract(d) - 0.5) / fwidth(d);
  return 1.0 - min(min(g.x, min(g.y, g.z)), 1.0);
}
void main() {
  vec2 p = vUv * vec2(70.0, 46.0);
  p.y += uTime * 0.5;
  float line = tri(p);
  float pulse = pow(0.5 + 0.5 * sin(length((vUv - vec2(0.5, 0.62)) * vec2(70.0, 46.0)) * 0.45 - uTime * 1.6), 10.0);
  float fade = smoothstep(0.05, 0.45, vUv.y) * (1.0 - smoothstep(0.6, 0.95, vUv.y));
  vec3 col = uColor * line * (0.13 + pulse * 0.35) + uHot * line * pulse * 0.18;
  gl_FragColor = vec4(col * fade, 1.0);
}`;

function buildFloor() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 70),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: TEAL },
        uHot: { value: ORANGE },
      },
      vertexShader: VERT_UV,
      fragmentShader: FLOOR_FRAG,
      ...additive,
    }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -5.2, -14);
  return mesh;
}

const STREAK_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float core = 1.0 - abs(vUv.x - 0.5) * 2.0;
  float tail = smoothstep(0.0, 1.0, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
  gl_FragColor = vec4(uColor * core * tail * uAlpha, 1.0);
}`;

type Streak = { mesh: THREE.Mesh; speed: number };

function buildStreaks(count: number) {
  const streaks: Streak[] = [];
  const geo = new THREE.PlaneGeometry(0.05, 3.2);
  for (let i = 0; i < count; i++) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: i % 4 === 0 ? ORANGE : MINT },
        uAlpha: { value: THREE.MathUtils.randFloat(0.5, 1.2) },
      },
      vertexShader: VERT_UV,
      fragmentShader: STREAK_FRAG,
      ...additive,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(
      THREE.MathUtils.randFloatSpread(48),
      THREE.MathUtils.randFloat(-6, 10),
      THREE.MathUtils.randFloat(-22, -2),
    );
    streaks.push({ mesh, speed: THREE.MathUtils.randFloat(1.2, 3.4) });
  }
  return streaks;
}

function buildDust(tex: THREE.Texture) {
  const count = 700;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos.set(
      [
        THREE.MathUtils.randFloatSpread(56),
        THREE.MathUtils.randFloat(-5, 11),
        THREE.MathUtils.randFloat(-30, 6),
      ],
      i * 3,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      map: tex,
      color: MINT,
      size: 0.12,
      opacity: 0.8,
      ...additive,
    }),
  );
}

/* ------------------------------------------------------------------------ */
/* Scene                                                                     */
/* ------------------------------------------------------------------------ */

const PANELS: [string, PanelLine[]][] = [
  [
    "agent · edit mode",
    [
      { text: "read_file   src/auth/login.ts" },
      { text: "search      'redirect'   3 hits" },
      { text: "approve?    edit +4 −1", color: "#ffb27a" },
      { text: "✓ npm test  42 passed", color: "#9dffd6" },
    ],
  ],
  [
    "providers",
    [
      { text: "ollama      qwen3-coder  local" },
      { text: "lm studio   devstral     local" },
      { text: "anthropic   claude       byok", color: "#ffb27a" },
      { text: "openrouter  any model    byok" },
    ],
  ],
  [
    "diff · login.ts",
    [
      { text: "- return res.status(200)", color: "#ff9b8a" },
      { text: "+ return res.redirect('/app')", color: "#9dffd6" },
      { text: "  // keeps session cookie" },
      { text: "[ approve ]   [ reject ]", color: "#ffb27a" },
    ],
  ],
  [
    "plan · 3 steps",
    [
      { text: "1 ✓ reproduce failing test" },
      { text: "2 ✓ patch login handler" },
      { text: "3 ▸ run full suite", color: "#ffb27a" },
      { text: "write lease: builder" },
    ],
  ],
];

export function createTrussScene(
  host: HTMLElement,
  { reduced }: { reduced: boolean },
): TrussScene {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setClearColor(BG, 1);
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
  camera.position.set(0, 1, 16);

  const tealGlow = glowTexture("rgba(150,255,225,.6)");
  const hotGlow = glowTexture("rgba(255,190,140,.7)");
  const textures: THREE.Texture[] = [tealGlow, hotGlow];

  const beamMat = memberMaterial(1);
  const coreMat = memberMaterial(1.25);
  const beam = buildBeam(beamMat);
  const joints = new THREE.Points(
    new THREE.BufferGeometry().setFromPoints(beam.joints),
    new THREE.PointsMaterial({
      map: tealGlow,
      color: MINT,
      size: 0.45,
      ...additive,
    }),
  );
  scene.add(beam.lines, joints);

  const left = buildCore(coreMat, hotGlow);
  const right = buildCore(coreMat, hotGlow);
  scene.add(left.group, right.group);

  const panels = PANELS.map(([title, lines], i) => {
    const tex = panelTexture(title, lines);
    textures.push(tex);
    return buildPanel(tex, i * 0.27);
  });
  for (const panel of panels) scene.add(panel);

  const floor = buildFloor();
  const streaks = buildStreaks(46);
  for (const s of streaks) scene.add(s.mesh);
  const dust = buildDust(tealGlow);
  scene.add(floor, dust);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.95, 0.55, 0.14);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const panelHome: THREE.Vector3[] = [];
  const panelTilt = [0.45, -0.45, 0.35, -0.38];

  let redraw = () => {};
  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    const narrow = w / h < 1;
    camera.position.z = narrow ? 24 : 16;
    // Keep the cores and panels in the side gutters, clear of the headline.
    const spread = narrow ? 5.5 : Math.min(11.5, 6.4 * camera.aspect);
    left.group.position.set(-spread, narrow ? 8 : 1.2, -4);
    right.group.position.set(spread, narrow ? -8.5 : 0.4, -4);
    const px = narrow ? 4 : spread + 1.4;
    panelHome.length = 0;
    panelHome.push(
      new THREE.Vector3(-px + 1, 4.6, -6),
      new THREE.Vector3(px - 0.6, 4.4, -7),
      new THREE.Vector3(-px - 0.4, -2.4, -5),
      new THREE.Vector3(px + 0.4, -2.8, -6),
    );
    for (const p of panels) p.visible = !narrow;
    camera.updateProjectionMatrix();
    if (reduced) redraw();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const pointer = new THREE.Vector2();
  const eased = new THREE.Vector2();
  const onPointer = (event: PointerEvent) => {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      (event.clientY / window.innerHeight) * 2 - 1,
    );
  };
  window.addEventListener("pointermove", onPointer, { passive: true });

  const floorMat = floor.material as THREE.ShaderMaterial;
  const clock = new THREE.Clock();
  let last = 0;
  let raf = 0;
  let visible = true;

  const draw = (time: number) => {
    const dt = Math.min(0.05, Math.max(0, time - last));
    last = time;
    beamMat.uniforms.uTime.value = time;
    coreMat.uniforms.uTime.value = time;
    floorMat.uniforms.uTime.value = time;
    eased.lerp(pointer, 0.045);

    for (const [core, dir] of [
      [left, 1],
      [right, -1],
    ] as const) {
      core.outer.rotation.y = time * 0.18 * dir;
      core.outer.rotation.x = time * 0.07;
      core.inner.rotation.y = -time * 0.45 * dir;
      core.inner.rotation.z = time * 0.2;
      core.ring.rotation.z = time * 0.6 * dir;
      core.halo.scale.setScalar(2.1 + Math.sin(time * 2.2 + dir) * 0.25);
    }

    panels.forEach((panel, i) => {
      const home = panelHome[i];
      if (!home) return;
      panel.position.set(
        home.x,
        home.y + Math.sin(time * 0.8 + i) * 0.25,
        home.z,
      );
      panel.rotation.y = (panelTilt[i] ?? 0) + eased.x * 0.12;
      (panel.material as THREE.ShaderMaterial).uniforms.uTime.value = time;
    });

    for (const s of streaks) {
      s.mesh.position.y += s.speed * dt;
      if (s.mesh.position.y > 12) {
        s.mesh.position.y = -7;
        s.mesh.position.x = THREE.MathUtils.randFloatSpread(48);
      }
    }

    dust.rotation.y = time * 0.012;
    camera.position.x = eased.x * 1.4;
    camera.position.y = 1 - eased.y * 0.8;
    camera.lookAt(0, 0, -5);
    composer.render();
  };

  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (visible) draw(clock.getElapsedTime());
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
  });
  io.observe(host);

  if (reduced) {
    redraw = () => {
      last = 6;
      draw(6);
    };
    redraw();
  } else loop();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      observer.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as
          | THREE.Material
          | THREE.Material[]
          | undefined;
        if (Array.isArray(material)) for (const m of material) m.dispose();
        else material?.dispose();
      });
      for (const t of textures) t.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
