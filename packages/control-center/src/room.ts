import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ControlSnapshot } from "./shared.js";

export function createRoom(
  host: HTMLElement,
  selected: (id: string) => void,
): { update(snapshot: ControlSnapshot): void; dispose(): void } {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0xdfe5df);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-13, 13, 9, -9, 0.1, 100);
  camera.position.set(18, 21, 22);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 1);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.25;
  controls.update();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x52645c, 3));
  const sun = new THREE.DirectionalLight(0xffefd4, 3);
  sun.position.set(-8, 14, 7);
  scene.add(sun);
  const material = (color: number) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const box = (
    size: [number, number, number],
    at: [number, number, number],
    color: number,
    root: THREE.Object3D = scene,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...size),
      material(color),
    );
    mesh.position.set(...at);
    root.add(mesh);
    return mesh;
  };
  box([20, 0.3, 17], [0, -0.2, 1], 0xbcb39f);
  box([20, 4, 0.2], [0, 2, -7.4], 0xf0eee6);
  box([0.2, 4, 17], [-10, 2, 1], 0xd4ddd5);
  const people = new Map<string, THREE.Group>();
  let signature = "";
  const build = (snapshot: ControlSnapshot) => {
    for (const person of people.values()) scene.remove(person);
    people.clear();
    snapshot.agents.forEach((agent, index) => {
      const group = new THREE.Group();
      group.userData.agentId = agent.id;
      const run =
        snapshot.runs.find(
          (item) =>
            item.agentId === agent.id &&
            ["running", "waiting_for_approval", "queued"].includes(item.state),
        ) ?? snapshot.runs.find((item) => item.agentId === agent.id);
      const planning = agent.mode === "plan" && run?.state === "running";
      const done = run?.state === "completed";
      const x = planning
        ? index % 2
          ? 2
          : -2
        : done
          ? -3 + (index % 6) * 1.2
          : index % 2
            ? 5.8
            : -5.8;
      const z = planning ? -1 : done ? 5 : -2 + Math.floor(index / 2) * 3.6;
      group.position.set(x, 0, z);
      if (!planning && !done) {
        box([2.8, 0.15, 1.3], [0, 1, 0], 0xc9a47c, group);
        box([1, 0.7, 0.1], [0, 1.6, -0.25], 0x39534d, group);
        box([0.8, 0.1, 0.7], [0, 0.5, 0.95], 0x425c55, group);
      }
      const shirt = [0x547e78, 0xc18464, 0x747d9c, 0xb59751][index % 4];
      const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.25, 0.45, 4, 8),
        material(shirt),
      );
      body.position.y = 1.05;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.23, 12, 12),
        material(0xd8ad8c),
      );
      head.position.y = 1.65;
      group.add(head);
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.18),
        material(
          run?.state === "waiting_for_approval"
            ? 0xe2af45
            : done
              ? 0x67bd92
              : 0x80aed0,
        ),
      );
      marker.position.y = 2.2;
      group.add(marker);
      scene.add(group);
      people.set(agent.id, group);
    });
  };
  const raycaster = new THREE.Raycaster();
  renderer.domElement.addEventListener("click", (event) => {
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    let object: THREE.Object3D | undefined = raycaster.intersectObjects(
      [...people.values()],
      true,
    )[0]?.object;
    while (object) {
      if (typeof object.userData.agentId === "string") {
        selected(object.userData.agentId);
        return;
      }
      object = object.parent ?? undefined;
    }
  });
  const resize = new ResizeObserver(() => {
    const width = host.clientWidth,
      height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.left = (-10 * width) / height;
    camera.right = (10 * width) / height;
    camera.updateProjectionMatrix();
  });
  resize.observe(host);
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  return {
    update(snapshot) {
      const next = JSON.stringify(snapshot.agents.map((agent) => agent.id));
      if (next !== signature) {
        signature = next;
        build(snapshot);
      }
    },
    dispose() {
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
