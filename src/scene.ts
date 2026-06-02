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
  // Fundo claro — melhor contraste para apresentação / captura de tela
  const sky = 0xf5f7fa;
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 120, 280);

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
  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xffffff, 1.05);
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

  // Preenchimento suave (céu claro + chão cinza)
  const fill = new THREE.HemisphereLight(0xffffff, 0xd8dde6, 0.45);
  scene.add(fill);

  // ----------- Chão ----------- //
  const groundGeo = new THREE.PlaneGeometry(300, 200);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0xe4e8ee,
    roughness: 0.92,
    metalness: 0.02,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Grid (linhas escuras sobre fundo claro)
  const grid = new THREE.GridHelper(200, 80, 0x9aa8b8, 0xc8d0dc);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.75;
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
