/**
 * Raycaster para hover e click.
 *  - Hover: emissive simples no equipamento.
 *  - Click: dispara callback (UI abre drawer).
 *
 * Para evitar travar a UI: o hover é processado apenas no animation frame.
 */

import * as THREE from "three";
import type { SceneCtx } from "./scene";
import type { PlantCtx } from "./plant";
import type { EquipmentId, EquipmentNode } from "./types";
import { applyEquipmentStateColor } from "./plant";

export interface Interactions {
  /** Atualizar raycaster a cada frame. */
  update(): void;
  dispose(): void;
}

const HIGHLIGHT_EMISSIVE = 0x2c5f8f;
const HIGHLIGHT_INTENSITY = 0.45;

export function setupInteractions(
  scn: SceneCtx,
  plant: PlantCtx,
  onClick: (id: EquipmentId) => void,
): Interactions {
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerActive = false;
  let pendingClick = false;
  let hoveredId: EquipmentId | null = null;
  let lastDownX = 0;
  let lastDownY = 0;

  const dom = scn.renderer.domElement;
  dom.style.cursor = "grab";

  function onMove(ev: PointerEvent) {
    const rect = dom.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    pointerActive = true;
  }
  function onLeave() {
    pointerActive = false;
    setHovered(null);
  }
  function onDown(ev: PointerEvent) {
    lastDownX = ev.clientX;
    lastDownY = ev.clientY;
  }
  function onUp(ev: PointerEvent) {
    // tratar como click apenas se o usuário "não arrastou"
    const dx = ev.clientX - lastDownX;
    const dy = ev.clientY - lastDownY;
    if (dx * dx + dy * dy < 25) {
      pendingClick = true;
    }
  }

  dom.addEventListener("pointermove", onMove);
  dom.addEventListener("pointerleave", onLeave);
  dom.addEventListener("pointerdown", onDown);
  dom.addEventListener("pointerup", onUp);

  function setHovered(id: EquipmentId | null) {
    if (id === hoveredId) return;
    // remove highlight anterior
    if (hoveredId) {
      const node = plant.nodes[hoveredId];
      if (node) applyEquipmentStateColor(node); // restaura cor
    }
    hoveredId = id;
    if (id) {
      const node = plant.nodes[id];
      if (node) applyHighlight(node);
    }
    dom.style.cursor = id ? "pointer" : "grab";
  }

  function applyHighlight(node: EquipmentNode) {
    for (const obj of node.pickables) {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.emissive.setHex(HIGHLIGHT_EMISSIVE);
        mat.emissiveIntensity = HIGHLIGHT_INTENSITY;
      }
    }
  }

  function update() {
    if (!pointerActive && !pendingClick) return;

    ray.setFromCamera(pointer, scn.camera);
    const hits = ray.intersectObjects(plant.pickables, false);
    const first = hits[0]?.object;
    const id = (first?.userData.equipmentId as EquipmentId | undefined) ?? null;

    if (pointerActive) setHovered(id);

    if (pendingClick) {
      pendingClick = false;
      if (id) onClick(id);
    }
  }

  function dispose() {
    dom.removeEventListener("pointermove", onMove);
    dom.removeEventListener("pointerleave", onLeave);
    dom.removeEventListener("pointerdown", onDown);
    dom.removeEventListener("pointerup", onUp);
  }

  return { update, dispose };
}
