import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { RoomAgent } from "./room-model.js";

export interface AgentRoomScene {
  update(agents: readonly RoomAgent[]): void;
  reset(): void;
  dispose(): void;
}

/** Presentation only. No provider, execution, storage or Electron dependencies. */
export function createAgentRoomScene(
  host: HTMLElement,
  select: (id: string) => void,
): AgentRoomScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xe4e7e4);
  renderer.domElement.setAttribute(
    "aria-label",
    "Agent office. Use the agent list for keyboard controls. Drag to orbit, scroll to zoom.",
  );
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 160);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minZoom = 0.35;
  controls.maxZoom = 3;
  controls.maxPolarAngle = Math.PI / 2.25;
  const reset = () => {
    camera.position.set(18, 21, 23);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.update();
  };
  reset();
  scene.add(new THREE.HemisphereLight(0xf8faf5, 0x838d84, 2.5));
  const sun = new THREE.DirectionalLight(0xffedcf, 3.2);
  sun.position.set(-8, 16, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
  });
  sun.shadow.bias = -0.001;
  scene.add(sun);
  const office = new THREE.Group();
  scene.add(office);
  const material = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.78 });
  const box = (
    parent: THREE.Object3D,
    size: number[],
    position: number[],
    color: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...(size as [number, number, number])),
      material(color),
    );
    mesh.position.set(...(position as [number, number, number]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const cylinder = (
    parent: THREE.Object3D,
    radius: number,
    height: number,
    position: number[],
    color: number,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, 12),
      material(color),
    );
    mesh.position.set(...(position as [number, number, number]));
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const free = (root: THREE.Object3D) =>
    root.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const value of Array.isArray(object.material)
          ? object.material
          : [object.material])
          value.dispose();
      }
    });
  const label = (parent: THREE.Object3D, text: string, y: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 80;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#f6f3e9";
    context.fillRect(0, 0, 512, 80);
    context.fillStyle = "#344b44";
    context.font = "500 30px sans-serif";
    context.textAlign = "center";
    context.fillText(text.slice(0, 28), 256, 51, 490);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: false }),
    );
    sprite.position.y = y;
    sprite.scale.set(2.7, 0.42, 1);
    parent.add(sprite);
  };
  const avatars = new Map<
    string,
    { group: THREE.Group; target: THREE.Vector3; marker: THREE.Mesh }
  >();
  let signature = "";
  const colors = [0x547e78, 0xc18464, 0x747d9c, 0xb59751, 0x997e93];
  const deskPosition = (i: number) =>
    new THREE.Vector3((i % 2 ? 1 : -1) * 5.5, 0, -3 + Math.floor(i / 2) * 3.5);
  const build = (agents: readonly RoomAgent[]) => {
    free(office);
    office.clear();
    avatars.clear();
    const depth = Math.max(12, Math.ceil(agents.length / 2) * 3.5 + 5);
    box(office, [18, 0.3, depth], [0, -0.2, depth / 2 - 6], 0xbcb39f);
    for (let z = -6; z < depth - 6; z += 0.7)
      box(office, [18, 0.015, 0.018], [0, -0.035, z], 0xaaa38f);
    box(office, [18, 3.5, 0.18], [0, 1.6, -6], 0xf2f0e7);
    box(office, [0.18, 3.5, depth], [-9, 1.6, depth / 2 - 6], 0xd7ded6);
    for (const x of [-5.5, 0, 5.5]) {
      box(office, [3.4, 1.9, 0.12], [x, 2, -5.86], 0x768d86);
      box(office, [3.15, 1.65, 0.14], [x, 2, -5.78], 0xc6e0de);
      box(office, [0.07, 1.65, 0.18], [x, 2, -5.68], 0xf6f1e5);
    }
    box(office, [5.2, 0.035, 6.8], [0, 0, -0.7], 0x829a92);
    box(office, [2.5, 0.16, 4], [0, 1.05, -1], 0xc6a37c);
    box(office, [1.6, 1, 2.8], [0, 0.5, -1], 0x475f59);
    box(office, [0.9, 0.03, 0.65], [0.2, 1.15, -0.7], 0xf5eedc);
    for (const z of [-2, 0])
      for (const x of [-1.9, 1.9]) {
        box(office, [0.65, 0.12, 0.65], [x, 0.55, z], 0x3c5755);
        box(
          office,
          [0.12, 0.7, 0.65],
          [x + Math.sign(x) * 0.3, 0.9, z],
          0x3c5755,
        );
        cylinder(office, 0.08, 0.5, [x, 0.25, z], 0x505750);
      }
    for (const x of [-8, 8]) {
      cylinder(office, 0.4, 0.65, [x, 0.3, -4.7], 0xe1c9aa);
      cylinder(office, 0.07, 1.1, [x, 1, -4.7], 0x7b7556);
      const leaves = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.7, 1),
        material(0x557e5a),
      );
      leaves.position.set(x, 1.7, -4.7);
      office.add(leaves);
    }
    agents.forEach((agent, i) => {
      const pos = deskPosition(i);
      const desk = new THREE.Group();
      desk.position.copy(pos);
      office.add(desk);
      label(desk, `${agent.lead ? "LEAD · " : ""}${agent.name}`, 2.8);
      box(desk, [2.7, 0.14, 1.25], [0, 1, 0], agent.lead ? 0xb69a60 : 0xd9c5a9);
      for (const x of [-1.1, 1.1])
        box(desk, [0.12, 0.95, 1], [x, 0.48, 0], 0x65706b);
      box(desk, [0.95, 0.65, 0.09], [0, 1.55, -0.3], 0x354743);
      box(desk, [0.82, 0.51, 0.02], [0, 1.55, -0.24], 0x91c3be);
      box(desk, [0.1, 0.3, 0.1], [0, 1.15, -0.3], 0x354743);
      box(desk, [0.8, 0.035, 0.25], [0, 1.1, 0.25], 0x53615b);
      cylinder(desk, 0.12, 0.2, [0.95, 1.17, 0.15], 0xf2eee3);
      box(desk, [0.7, 0.12, 0.65], [0, 0.5, 1], 0x536963);
      box(desk, [0.7, 0.65, 0.12], [0, 0.85, 1.3], 0x536963);
      const person = new THREE.Group();
      person.userData.agentId = agent.id;
      person.position.copy(pos).add(new THREE.Vector3(0, 0, 0.9));
      office.add(person);
      const shirt = colors[i % colors.length];
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.23, 0.4, 4, 8),
        material(shirt),
      );
      body.position.y = 1.08;
      person.add(body);
      cylinder(
        person,
        0.21,
        0.38,
        [0, 1.67, 0],
        [0xd6ac8d, 0xa8795d, 0xe6c3a4][i % 3],
      );
      cylinder(person, 0.225, 0.13, [0, 1.88, 0], 0x483e35);
      for (const x of [-0.13, 0.13]) {
        box(person, [0.19, 0.65, 0.23], [x, 0.4, 0], 0x424e57);
        box(person, [0.22, 0.12, 0.38], [x, 0.1, -0.07], 0x393c3a);
        box(person, [0.16, 0.6, 0.2], [Math.sign(x) * 0.34, 1.06, 0], shirt);
      }
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.17),
        material(0x77bfa3),
      );
      marker.position.y = 2.35;
      person.add(marker);
      avatars.set(agent.id, {
        group: person,
        target: person.position.clone(),
        marker,
      });
    });
  };
  const update = (agents: readonly RoomAgent[]) => {
    const next = JSON.stringify(
      agents.map((agent) => [agent.id, agent.lead, agent.name]),
    );
    if (signature !== next) {
      signature = next;
      build(agents);
    }
    agents.forEach((agent, i) => {
      const avatar = avatars.get(agent.id);
      if (!avatar) return;
      const pos = deskPosition(i).add(new THREE.Vector3(0, 0, 0.9));
      if (agent.zone === "meeting")
        pos.set(i % 2 ? 2.2 : -2.2, 0, -2.6 + Math.floor(i / 2) * 1.1);
      if (agent.zone === "handoff")
        pos.set(-1.6 + (i % 4) * 1.05, 0, 3 + Math.floor(i / 4) * 1.1);
      avatar.target.copy(pos);
      (avatar.marker.material as THREE.MeshStandardMaterial).color.setHex(
        agent.run?.state === "waiting_for_approval"
          ? 0xe7b24b
          : agent.run?.state === "failed"
            ? 0xd57368
            : agent.run?.state === "completed"
              ? 0x6cc69b
              : agent.lead
                ? 0xd5b66e
                : 0x91b9d2,
      );
    });
  };
  const raycaster = new THREE.Raycaster();
  let down = new THREE.Vector2();
  renderer.domElement.onpointerdown = (event) => {
    down = new THREE.Vector2(event.clientX, event.clientY);
  };
  renderer.domElement.onpointerup = (event) => {
    if (down.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 5)
      return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    const hit = raycaster.intersectObjects(
      [...avatars.values()].map((value) => value.group),
      true,
    )[0];
    let object: THREE.Object3D | undefined = hit?.object;
    while (object) {
      if (typeof object.userData.agentId === "string") {
        select(object.userData.agentId);
        break;
      }
      object = object.parent ?? undefined;
    }
  };
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.left = (-9 * width) / height;
    camera.right = (9 * width) / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);
  let visible = true;
  const visibility = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
  });
  visibility.observe(host);
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let previous = 0;
  renderer.setAnimationLoop((time) => {
    const delta = Math.min((time - previous) / 1000, 0.05);
    previous = time;
    if (!visible || document.hidden) return;
    for (const avatar of avatars.values()) {
      avatar.group.position.lerp(
        avatar.target,
        reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 4),
      );
      if (!reducedMotion.matches) avatar.marker.rotation.y += delta;
    }
    controls.update();
    renderer.render(scene, camera);
  });
  return {
    update,
    reset,
    dispose: () => {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      visibility.disconnect();
      controls.dispose();
      free(scene);
      sun.shadow.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
