/**
 * Cria renderer, cena, câmera, luzes, chão e OrbitControls.
 * A câmera inicia mostrando o conjunto linear (de SILO até CONE).
 */

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface SceneCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  container: HTMLElement;
}

export function createScene(container: HTMLElement): SceneCtx {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e141d);
  scene.fog = new THREE.Fog(0x0e141d, 80, 220);

  // Camera
  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / container.clientHeight,
    0.1,
    500,
  );
  camera.position.set(0, 20, 55);
  camera.lookAt(0, 5, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 180;
  controls.maxPolarAngle = Math.PI * 0.49; // não atravessar o chão

  // ----------- Luzes ----------- //
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 0.95);
  sun.position.set(40, 60, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Luz de preenchimento azulada
  const fill = new THREE.HemisphereLight(0x8fb3ff, 0x1a1f2a, 0.35);
  scene.add(fill);

  // ----------- Chão ----------- //
  const groundGeo = new THREE.PlaneGeometry(300, 200);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1a2230,
    roughness: 0.95,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid
  const grid = new THREE.GridHelper(200, 80, 0x2a3a52, 0x1e2a3a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  scene.add(grid);

  // Eixo helper discreto (apenas como referência)
  const axes = new THREE.AxesHelper(3);
  axes.position.set(-45, 0.02, -25);
  scene.add(axes);

  // ----------- Responsividade ----------- //
  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", onResize);

  return { renderer, scene, camera, controls, container };
}
