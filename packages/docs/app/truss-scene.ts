/**
 * The landing hero's holographic truss: a curved triangular space frame that
 * sweeps through the scene, with orange energy packets travelling along its
 * members, glowing joints, a receding floor grid, drifting dust and a slow
 * scan beam, all through a bloom pass. The camera follows the pointer.
 *
 * Loaded lazily by `hero-scene.tsx` so three.js never blocks first paint.
 * Everything created here is released by `dispose()`.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

export type TrussScene = { dispose(): void };

const BG = 0x06100d;
const TEAL = new THREE.Color(0x18c4a3);
const MINT = new THREE.Color(0xa8e4cc);
const ORANGE = new THREE.Color(0xf28a43);

const additive = {
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
} as const;

/* ------------------------------------------------------------------------ */
/* Truss geometry                                                            */
/* ------------------------------------------------------------------------ */

const BAYS = 26;
const RADIUS = 1.15;

/** Centre line of the beam: a gentle S-curve rising from back-left to front-right. */
function spine(t: number) {
  const x = THREE.MathUtils.lerp(-15, 13, t);
  const y = Math.sin(t * Math.PI * 1.1 - 0.6) * 1.6 - 0.2;
  const z = THREE.MathUtils.lerp(-14, 2.5, t) + Math.sin(t * Math.PI * 2) * 1.4;
  return new THREE.Vector3(x, y, z);
}

/** The three chord points of the triangular cross-section at `t`. */
function chordPoints(t: number): THREE.Vector3[] {
  const c = spine(t);
  const ahead = spine(Math.min(1, t + 0.01))
    .sub(spine(Math.max(0, t - 0.01)))
    .normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3().crossVectors(ahead, up).normalize();
  const realUp = new THREE.Vector3().crossVectors(side, ahead).normalize();
  const twist = t * 1.4;
  return [0, 1, 2].map((k) => {
    const a = twist + (k * Math.PI * 2) / 3;
    return c
      .clone()
      .addScaledVector(realUp, Math.cos(a) * RADIUS)
      .addScaledVector(side, Math.sin(a) * RADIUS);
  });
}

type Member = { a: THREE.Vector3; b: THREE.Vector3; kind: number };

function buildMembers() {
  const rings: THREE.Vector3[][] = [];
  for (let i = 0; i <= BAYS; i++) rings.push(chordPoints(i / BAYS));
  const members: Member[] = [];
  const joints: THREE.Vector3[] = [];
  rings.forEach((ring, i) => {
    joints.push(...ring);
    // Cross-section triangle.
    for (let k = 0; k < 3; k++)
      members.push({ a: ring[k], b: ring[(k + 1) % 3], kind: 1 });
    const next = rings[i + 1];
    if (!next) return;
    for (let k = 0; k < 3; k++) {
      // Chords run the length of the beam; diagonals alternate per bay.
      members.push({ a: ring[k], b: next[k], kind: 0 });
      const diag = i % 2 === 0 ? next[(k + 1) % 3] : next[(k + 2) % 3];
      members.push({ a: ring[k], b: diag, kind: 2 });
    }
  });
  return { members, joints };
}

const MEMBER_VERT = /* glsl */ `
attribute float aAlong;
attribute float aSeed;
attribute float aKind;
attribute float aBeam;
varying float vAlong;
varying float vSeed;
varying float vKind;
varying float vBeam;
varying float vDepth;
void main() {
  vAlong = aAlong; vSeed = aSeed; vKind = aKind; vBeam = aBeam;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const MEMBER_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uTeal;
uniform vec3 uMint;
uniform vec3 uHot;
uniform float uScan;
varying float vAlong;
varying float vSeed;
varying float vKind;
varying float vBeam;
varying float vDepth;
void main() {
  // Energy packets: chords carry a steady flow, diagonals fire occasionally.
  float speed = vKind < 0.5 ? 0.55 : 0.9;
  float phase = fract(vAlong - uTime * speed + vSeed * 7.0);
  float packet = pow(1.0 - phase, 18.0);
  float gate = vKind < 0.5 ? 1.0 : step(0.72, fract(vSeed * 13.0 + floor(uTime * 0.35 + vSeed * 5.0) * 0.37));
  float scan = exp(-abs(vBeam - uScan) * 9.0);
  float flicker = 0.9 + 0.1 * sin(uTime * 11.0 + vSeed * 60.0);
  vec3 base = mix(uTeal, uMint, vKind == 1.0 ? 0.55 : 0.15);
  float baseLevel = vKind < 0.5 ? 0.55 : 0.32;
  vec3 col = base * (baseLevel + scan * 0.9) * flicker;
  col += uHot * packet * gate * 2.2;
  float fog = 1.0 - smoothstep(10.0, 34.0, vDepth);
  gl_FragColor = vec4(col * fog, 1.0);
}`;

function buildFrame(members: Member[]) {
  const n = members.length * 2;
  const pos = new Float32Array(n * 3);
  const along = new Float32Array(n);
  const seed = new Float32Array(n);
  const kind = new Float32Array(n);
  const beam = new Float32Array(n);
  members.forEach((m, i) => {
    const s = Math.random();
    [m.a, m.b].forEach((p, j) => {
      const v = i * 2 + j;
      pos.set([p.x, p.y, p.z], v * 3);
      along[v] = j;
      seed[v] = s;
      kind[v] = m.kind;
      beam[v] = (p.x + 15) / 28;
    });
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aAlong", new THREE.BufferAttribute(along, 1));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aKind", new THREE.BufferAttribute(kind, 1));
  geo.setAttribute("aBeam", new THREE.BufferAttribute(beam, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScan: { value: 0 },
      uTeal: { value: TEAL },
      uMint: { value: MINT },
      uHot: { value: ORANGE },
    },
    vertexShader: MEMBER_VERT,
    fragmentShader: MEMBER_FRAG,
    ...additive,
  });
  return new THREE.LineSegments(geo, mat);
}

/* ------------------------------------------------------------------------ */
/* Joints, grid, dust                                                        */
/* ------------------------------------------------------------------------ */

function glowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.22, "rgba(190,255,232,.7)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildJoints(joints: THREE.Vector3[], tex: THREE.Texture) {
  const geo = new THREE.BufferGeometry().setFromPoints(joints);
  const mat = new THREE.PointsMaterial({
    map: tex,
    color: MINT,
    size: 0.42,
    sizeAttenuation: true,
    ...additive,
  });
  return new THREE.Points(geo, mat);
}

const GRID_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * vec2(60.0, 40.0);
  p.y += uTime * 0.6;
  vec2 g = abs(fract(p) - 0.5) / fwidth(p);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float fade = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float side = 1.0 - smoothstep(0.35, 0.5, abs(vUv.x - 0.5));
  gl_FragColor = vec4(uColor * line * fade * side * 0.16, 1.0);
}`;

function buildGrid() {
  const geo = new THREE.PlaneGeometry(90, 60);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: TEAL } },
    vertexShader:
      "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: GRID_FRAG,
    ...additive,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -4.2, -12);
  return mesh;
}

function buildDust(tex: THREE.Texture) {
  const count = 420;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos.set(
      [
        THREE.MathUtils.randFloatSpread(44),
        THREE.MathUtils.randFloat(-4, 9),
        THREE.MathUtils.randFloat(-26, 6),
      ],
      i * 3,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: tex,
    color: TEAL,
    size: 0.11,
    opacity: 0.7,
    ...additive,
  });
  return new THREE.Points(geo, mat);
}

/* ------------------------------------------------------------------------ */
/* Scene                                                                     */
/* ------------------------------------------------------------------------ */

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
  scene.fog = new THREE.Fog(BG, 14, 40);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 1.4, 14);

  const tex = glowTexture();
  const { members, joints } = buildMembers();
  const rig = new THREE.Group();
  const frame = buildFrame(members);
  const jointPoints = buildJoints(joints, tex);
  rig.add(frame, jointPoints);
  scene.add(rig);
  const grid = buildGrid();
  const dust = buildDust(tex);
  scene.add(grid, dust);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.15, 0.6, 0.08);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let redraw = () => {};
  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.resolution.set(w, h);
    camera.aspect = w / h;
    // Narrow screens: pull back and centre so the beam still reads.
    const narrow = w / h < 1;
    camera.position.z = narrow ? 20 : 14;
    rig.position.x = narrow ? -1 : 3.2;
    camera.updateProjectionMatrix();
    // Resizing clears the canvas; a reduced-motion still must be redrawn.
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

  const frameMat = frame.material as THREE.ShaderMaterial;
  const gridMat = grid.material as THREE.ShaderMaterial;
  const clock = new THREE.Clock();
  let raf = 0;
  let visible = true;

  const draw = (time: number) => {
    frameMat.uniforms.uTime.value = time;
    frameMat.uniforms.uScan.value = ((time * 0.12) % 1.4) - 0.2;
    gridMat.uniforms.uTime.value = time;
    eased.lerp(pointer, 0.04);
    rig.rotation.y = Math.sin(time * 0.12) * 0.12 + eased.x * 0.18;
    rig.rotation.x = eased.y * 0.06;
    camera.position.x = eased.x * 1.2;
    camera.position.y = 1.4 - eased.y * 0.7;
    camera.lookAt(0, 0, -4);
    dust.rotation.y = time * 0.01;
    (jointPoints.material as THREE.PointsMaterial).size =
      0.38 + Math.sin(time * 2) * 0.04;
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
    redraw = () => draw(4.2);
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
      tex.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
