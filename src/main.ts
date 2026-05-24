/**
 * Entry-point: orquestra cena, planta, simulação, UI e interações.
 * Loop de animação com clock e dt limitado.
 */

import { createScene } from "./scene";
import { buildPlant, updateStream, applyEquipmentStateColor } from "./plant";
import { createInitialState, stepSim } from "./sim";
import { setupUI } from "./ui";
import { setupInteractions } from "./interactions";
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
  onOpenEquipment: (id: EquipmentId) => ui.openDrawer(id),
});

const interactions = setupInteractions(scn, plant, (id) => ui.openDrawer(id));

// Estado inicial coerente: labels e return visíveis
plant.setLabelsVisible(state.showLabels);
plant.setOversizeReturnVisible(state.oversizeReturn);

// ------------------------------------------------------------------ //
// Loop principal
// ------------------------------------------------------------------ //
const clock = new THREE.Clock();
let uiAccum = 0; // refresh da UI em 10 Hz (não a cada frame)

function tick() {
  requestAnimationFrame(tick);

  const dt = Math.min(0.05, clock.getDelta()); // cap de 50ms para evitar saltos
  // 1) Simulação
  stepSim(state, dt);

  // 2) Atualiza cor de estado por equipamento (somente se mudou — barato manter por frame)
  for (const id of Object.keys(plant.nodes) as EquipmentId[]) {
    const node = plant.nodes[id];
    if (node.state !== state.equipState[id]) {
      node.state = state.equipState[id];
      applyEquipmentStateColor(node);
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

  updateStream(plant.flows.conv, dt, convFlow);
  updateStream(plant.flows.undersize, dt, undersizeFlow);
  updateStream(plant.flows.oversize, dt, overFlowRate);

  // 4) Interações (hover/click)
  interactions.update();

  // 5) Render
  scn.controls.update();
  scn.renderer.render(scn.scene, scn.camera);

  // 6) UI a ~10 Hz
  uiAccum += dt;
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
