/**
 * Entry-point: orquestra cena, planta, simulação, UI e interações.
 * Loop de animação com clock e dt limitado.
 */

import { createScene } from "./scene";
import { buildPlant, updateStream, applyEquipmentStateColor } from "./plant";
import { createInitialState, stepSim } from "./sim";
import { setupUI } from "./ui";
import { setupInteractions } from "./interactions";
import { createCameraManager } from "./cameraManager";
import type { EquipmentId } from "./types";
import * as THREE from "three";

// ------------------------------------------------------------------ //
// Bootstrap
// ------------------------------------------------------------------ //
const container = document.getElementById("viewport");
if (!container) throw new Error("Container #viewport não encontrado.");

const scn = createScene(container);
const plant = buildPlant(scn.scene);
const state = createInitialState();

// Gerenciador de câmera: 3D (perspectiva) <-> ISO (ortográfica). Dimensiona o
// frustum ortográfico pelo bounding box real da planta.
const cameraManager = createCameraManager(scn.camera, scn.controls, container, {
  fitBox: new THREE.Box3().setFromObject(plant.root),
  isoDir: new THREE.Vector3(1, 1, 1), // planta no plano XZ, Y para cima
});

// ------------------------------------------------------------------ //
// Seleção visual (contorno leve via BoxHelper — funciona em 3D e ISO,
// sem mexer nos materiais nem em pós-processamento).
// ------------------------------------------------------------------ //
const selectionBox = new THREE.BoxHelper(plant.root, 0x3ea6ff);
selectionBox.visible = false;
const selMat = selectionBox.material as THREE.LineBasicMaterial;
selMat.depthTest = false;
selMat.transparent = true;
selectionBox.renderOrder = 1000;
scn.scene.add(selectionBox);

function selectEquipment(id: EquipmentId): void {
  const node = plant.nodes[id];
  if (!node || node.pickables.length === 0) return;
  selectionBox.setFromObject(node.group);
  selectionBox.visible = true;
}
function clearSelection(): void {
  selectionBox.visible = false;
}

// UI primeiro (precisa do estado), depois interações (precisam de UI para abrir drawer).
const ui = setupUI(state, {
  onToggleReturn: () => {
    state.oversizeReturn = !state.oversizeReturn;
    plant.setOversizeReturnVisible(state.oversizeReturn);
  },
  onToggleLabels: () => {
    state.showLabels = !state.showLabels;
    plant.setLabelsVisible(state.showLabels);
  },
  onToggleView: () => {
    const mode = cameraManager.toggle({ smooth: true });
    ui.setViewMode(mode);
  },
  onFit: () => cameraManager.frameAll({ smooth: true }),
  onOpenEquipment: (id: EquipmentId) => {
    ui.openDrawer(id);
    selectEquipment(id);
  },
  onCloseDrawer: () => clearSelection(),
});

const interactions = setupInteractions(
  scn,
  plant,
  (id) => {
    ui.openDrawer(id);
    selectEquipment(id);
  },
  () => cameraManager.getActiveCamera(),
  () => ui.closeDrawer(),
);

// Resize do frustum ortográfico (o renderer e a perspectiva já são tratados em scene.ts).
window.addEventListener("resize", () => {
  cameraManager.handleResize(container.clientWidth, container.clientHeight);
});

// Estado inicial coerente: labels e return visíveis
plant.setLabelsVisible(state.showLabels);
plant.setOversizeReturnVisible(state.oversizeReturn);

// ------------------------------------------------------------------ //
// Loop principal — física em timestep FIXO (determinística), render a 60 fps.
// ------------------------------------------------------------------ //
const clock = new THREE.Clock();
const FIXED_DT = 0.02; // 50 Hz de simulação
const MAX_SUBSTEPS = 5; // evita "espiral da morte" após travadas
let simAccum = 0;
let uiAccum = 0; // refresh da UI em 10 Hz (não a cada frame)
let active = true; // pausa o trabalho quando a aba não está visível

document.addEventListener("visibilitychange", () => {
  active = !document.hidden;
  if (active) clock.getDelta(); // descarta o gap acumulado ao voltar
});

function tick() {
  requestAnimationFrame(tick);
  if (!active) return;

  const frameDt = Math.min(0.1, clock.getDelta());

  // 1) Simulação em passos fixos (independente do FPS)
  simAccum += frameDt;
  let steps = 0;
  while (simAccum >= FIXED_DT && steps < MAX_SUBSTEPS) {
    stepSim(state, FIXED_DT);
    simAccum -= FIXED_DT;
    steps++;
  }
  if (steps === MAX_SUBSTEPS) simAccum = 0; // descarta atraso excessivo

  // 2) Atualiza cor de estado por equipamento (somente se mudou)
  for (const id of Object.keys(plant.nodes) as EquipmentId[]) {
    const node = plant.nodes[id];
    if (node.state !== state.equipState[id]) {
      node.state = state.equipState[id];
      applyEquipmentStateColor(node);
    }
  }

  // 2b) Pulso de emissive nos equipamentos em ALARM (feedback visual)
  const pulse = 0.35 + 0.4 * (0.5 + 0.5 * Math.sin(performance.now() * 0.008));
  for (const id of Object.keys(plant.nodes) as EquipmentId[]) {
    const node = plant.nodes[id];
    if (node.state !== "ALARM") continue;
    for (const obj of node.pickables) {
      const mesh = obj as THREE.Mesh;
      if (mesh.material instanceof THREE.MeshStandardMaterial) {
        mesh.material.emissiveIntensity = pulse;
      }
    }
  }

  // 3) Animação das partículas — velocidade depende de WT-105 e ST-105
  const wtFactor = state.values["WT-105"] / 220; // ~1.0 perto do SP
  const beltFactor = state.values["ST-105"] / 2.5;
  const convFlow = state.running && !state.eStop ? Math.max(0.05, wtFactor) * beltFactor : 0;
  const undersizeFlow = state.running && !state.eStop ? Math.max(0.05, wtFactor) * state.screenEff : 0;
  const overFlowRate = state.running && state.oversizeReturn && !state.eStop
    ? Math.max(0.05, wtFactor) * (1 - state.screenEff)
    : 0;

  updateStream(plant.flows.conv, frameDt, convFlow);
  updateStream(plant.flows.undersize, frameDt, undersizeFlow);
  updateStream(plant.flows.oversize, frameDt, overFlowRate);

  // 4) Interações (hover/click)
  interactions.update();

  // 5) Render (câmera ativa = 3D ou ISO; cameraManager também dirige a transição suave)
  cameraManager.update(frameDt);
  scn.renderer.render(scn.scene, cameraManager.getActiveCamera());

  // 6) UI a ~10 Hz
  uiAccum += frameDt;
  if (uiAccum >= 0.1) {
    uiAccum = 0;
    ui.refresh();
  }
}

tick();

// ------------------------------------------------------------------ //
// Exporta debug no window (útil em dev console)
// ------------------------------------------------------------------ //
declare global {
  interface Window {
    __scada3d?: {
      state: typeof state;
      plant: typeof plant;
      scene: typeof scn;
    };
  }
}
window.__scada3d = { state, plant, scene: scn };
