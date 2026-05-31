/**
 * Gerencia DUAS câmeras compartilhando o mesmo OrbitControls e o mesmo target:
 *  - PerspectiveCamera  -> modo "3d"  (orbit livre, como antes)
 *  - OrthographicCamera -> modo "iso" (2.5D isométrico SCADA: pan + zoom, sem rotação)
 *
 * A troca preserva o foco (controls.target) e pode ser suave (lerp de posição +
 * slerp de quaternion + lerp de zoom ortográfico), sem libs externas.
 *
 * Convenção do mundo: plano XZ, eixo Y para cima -> direção isométrica (1,1,1).
 */

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type ViewMode = "3d" | "iso";

export interface CameraManagerOptions {
  /** Box envolvente da planta para dimensionar o frustum ortográfico. */
  fitBox?: THREE.Box3;
  /** Direção isométrica (será normalizada). Default (1, 1, 1). */
  isoDir?: THREE.Vector3;
}

export interface CameraManager {
  /** Câmera que deve ser usada para render e raycast (muda durante a transição). */
  getActiveCamera(): THREE.Camera;
  getControls(): OrbitControls;
  getMode(): ViewMode;
  /** Define o modo de visualização. `smooth` (default true) anima a transição. */
  setMode(mode: ViewMode, opts?: { smooth?: boolean }): void;
  /** Alterna 3d <-> iso. */
  toggle(opts?: { smooth?: boolean }): ViewMode;
  /** Reenquadra a planta inteira preservando o modo atual. */
  frameAll(opts?: { smooth?: boolean }): void;
  handleResize(w: number, h: number): void;
  /** Dirige a transição suave; deve ser chamado a cada frame com o dt. */
  update(dt: number): void;
}

const TRANSITION_DURATION = 0.45; // s
const ISO_MIN_ZOOM = 0.5;
const ISO_MAX_ZOOM = 4.0;

function easeInOutCubic(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function createCameraManager(
  perspCamera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  container: HTMLElement,
  options: CameraManagerOptions = {},
): CameraManager {
  const isoDir = (options.isoDir?.clone() ?? new THREE.Vector3(1, 1, 1)).normalize();
  const up = new THREE.Vector3(0, 1, 0);

  // ----- bounding box da planta (para frustum e para "enquadrar") ----- //
  const fitBox = options.fitBox?.clone() ?? null;
  const fitCenter = new THREE.Vector3(0, 5, 0);
  let fitRadius = 35;
  let frustumSize = 70;
  if (fitBox && !fitBox.isEmpty()) {
    const size = new THREE.Vector3();
    fitBox.getSize(size);
    fitBox.getCenter(fitCenter);
    fitRadius = Math.max(size.x, size.y, size.z) * 0.6;
    // a maior extensão horizontal domina o enquadramento; margem de 25%
    frustumSize = Math.max(size.x, size.y, size.z) * 1.25;
  }

  // ----- Câmera ortográfica ----- //
  const w0 = Math.max(1, container.clientWidth);
  const h0 = Math.max(1, container.clientHeight);
  const aspect0 = w0 / h0;
  const orthoCamera = new THREE.OrthographicCamera(
    (-frustumSize * aspect0) / 2,
    (frustumSize * aspect0) / 2,
    frustumSize / 2,
    -frustumSize / 2,
    0.1,
    2000,
  );
  orthoCamera.position.copy(perspCamera.position);
  orthoCamera.quaternion.copy(perspCamera.quaternion);
  orthoCamera.updateProjectionMatrix();

  // ----- Estado ----- //
  let mode: ViewMode = "3d";
  let activeCamera: THREE.Camera = perspCamera;

  // Pose 3D salva, para restaurar exatamente ao voltar de iso -> 3d.
  const saved3dPos = perspCamera.position.clone();
  const saved3dQuat = perspCamera.quaternion.clone();

  // ----- Transição ----- //
  let transitioning = false;
  let tElapsed = 0;
  let transitionCam: THREE.Camera = perspCamera;
  const fromPos = new THREE.Vector3();
  const fromQuat = new THREE.Quaternion();
  let fromZoom = 1;
  const toPos = new THREE.Vector3();
  const toQuat = new THREE.Quaternion();
  let toZoom = 1;

  const _m = new THREE.Matrix4();

  function computeIsoPose(distance: number): { pos: THREE.Vector3; quat: THREE.Quaternion } {
    const target = controls.target;
    const pos = target.clone().add(isoDir.clone().multiplyScalar(distance));
    _m.lookAt(pos, target, up);
    const quat = new THREE.Quaternion().setFromRotationMatrix(_m);
    return { pos, quat };
  }

  function applyControlsForMode(m: ViewMode): void {
    if (m === "iso") {
      controls.enableRotate = false; // SCADA: sem rotação livre
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.screenSpacePanning = true;
      controls.minZoom = ISO_MIN_ZOOM;
      controls.maxZoom = ISO_MAX_ZOOM;
    } else {
      controls.enableRotate = true;
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.screenSpacePanning = false;
    }
  }

  function finishTransition(): void {
    transitioning = false;
    if (mode === "iso") {
      orthoCamera.position.copy(toPos);
      orthoCamera.quaternion.copy(toQuat);
      orthoCamera.zoom = toZoom;
      orthoCamera.updateProjectionMatrix();
      activeCamera = orthoCamera;
      controls.object = orthoCamera;
    } else {
      perspCamera.position.copy(toPos);
      perspCamera.quaternion.copy(toQuat);
      perspCamera.updateProjectionMatrix();
      activeCamera = perspCamera;
      controls.object = perspCamera;
    }
    applyControlsForMode(mode);
    controls.enabled = true;
    controls.update();
  }

  function setMode(next: ViewMode, opts?: { smooth?: boolean }): void {
    if (next === mode && !transitioning) return;
    const smooth = opts?.smooth ?? true;

    // "from" = pose atual da câmera que está sendo renderizada.
    fromPos.copy(activeCamera.position);
    fromQuat.copy(activeCamera.quaternion);
    fromZoom = (activeCamera as THREE.OrthographicCamera).zoom ?? 1;

    if (next === "iso") {
      // Salva a pose 3D para restaurar ao voltar.
      saved3dPos.copy(perspCamera.position);
      saved3dQuat.copy(perspCamera.quaternion);

      const dist = Math.max(
        perspCamera.position.distanceTo(controls.target),
        frustumSize * 0.6,
      );
      const { pos, quat } = computeIsoPose(dist);
      toPos.copy(pos);
      toQuat.copy(quat);
      toZoom = 1;

      // zoom inicial que aproxima a escala da perspectiva (evita "salto" visual).
      const fovRad = THREE.MathUtils.degToRad(perspCamera.fov);
      const visibleH = 2 * dist * Math.tan(fovRad / 2);
      fromZoom = visibleH > 0 ? frustumSize / visibleH : 1;

      transitionCam = orthoCamera;
      orthoCamera.position.copy(fromPos);
      orthoCamera.quaternion.copy(fromQuat);
      orthoCamera.zoom = fromZoom;
      orthoCamera.updateProjectionMatrix();
    } else {
      toPos.copy(saved3dPos);
      toQuat.copy(saved3dQuat);
      toZoom = 1;
      transitionCam = perspCamera;
      perspCamera.position.copy(fromPos);
      perspCamera.quaternion.copy(fromQuat);
      perspCamera.updateProjectionMatrix();
    }

    mode = next;
    activeCamera = transitionCam; // renderiza a câmera de destino já durante a transição
    controls.enabled = false; // congela o input enquanto anima

    if (smooth) {
      transitioning = true;
      tElapsed = 0;
    } else {
      finishTransition();
    }
  }

  function toggle(opts?: { smooth?: boolean }): ViewMode {
    setMode(mode === "3d" ? "iso" : "3d", opts);
    return mode;
  }

  function frameAll(opts?: { smooth?: boolean }): void {
    const smooth = opts?.smooth ?? true;
    // recoloca o foco no centro da planta
    controls.target.copy(fitCenter);

    if (mode === "iso") {
      const dist = Math.max(fitRadius * 2, frustumSize * 0.6);
      const { pos, quat } = computeIsoPose(dist);
      fromPos.copy(activeCamera.position);
      fromQuat.copy(activeCamera.quaternion);
      fromZoom = orthoCamera.zoom;
      toPos.copy(pos);
      toQuat.copy(quat);
      toZoom = 1;
      transitionCam = orthoCamera;
    } else {
      // visão 3D padrão olhando a planta de frente/cima
      const dir = new THREE.Vector3(0, 0.45, 1).normalize();
      const dist = fitRadius * 2.4;
      const pos = fitCenter.clone().add(dir.multiplyScalar(dist));
      _m.lookAt(pos, fitCenter, up);
      fromPos.copy(activeCamera.position);
      fromQuat.copy(activeCamera.quaternion);
      fromZoom = 1;
      toPos.copy(pos);
      toQuat.copy(new THREE.Quaternion().setFromRotationMatrix(_m));
      toZoom = 1;
      transitionCam = perspCamera;
    }

    controls.enabled = false;
    if (smooth) {
      transitioning = true;
      tElapsed = 0;
    } else {
      finishTransition();
    }
  }

  function update(dt: number): void {
    if (!transitioning) {
      controls.update();
      return;
    }
    tElapsed += dt;
    const a = TRANSITION_DURATION > 0 ? tElapsed / TRANSITION_DURATION : 1;
    if (a >= 1) {
      finishTransition();
      return;
    }
    const e = easeInOutCubic(a);
    transitionCam.position.lerpVectors(fromPos, toPos, e);
    transitionCam.quaternion.copy(fromQuat).slerp(toQuat, e);
    if (transitionCam === orthoCamera) {
      orthoCamera.zoom = THREE.MathUtils.lerp(fromZoom, toZoom, e);
      orthoCamera.updateProjectionMatrix();
    }
  }

  function handleResize(w: number, h: number): void {
    const aspect = Math.max(1, w) / Math.max(1, h);
    perspCamera.aspect = aspect;
    perspCamera.updateProjectionMatrix();

    orthoCamera.left = (-frustumSize * aspect) / 2;
    orthoCamera.right = (frustumSize * aspect) / 2;
    orthoCamera.top = frustumSize / 2;
    orthoCamera.bottom = -frustumSize / 2;
    orthoCamera.updateProjectionMatrix();
  }

  return {
    getActiveCamera: () => activeCamera,
    getControls: () => controls,
    getMode: () => mode,
    setMode,
    toggle,
    frameAll,
    handleResize,
    update,
  };
}
