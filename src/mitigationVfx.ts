/**
 * Efeitos visuais 3D durante ações de mitigação (operador corrigindo falhas).
 * Cada mitigação ativa mostra animação no equipamento correspondente.
 */

import * as THREE from "three";
import type { EquipmentId, MitigationActionId, SimState } from "./types";
import type { EquipmentNode } from "./types";
import { getMitigationProgress } from "./sim";

// ------------------------------------------------------------------ //
export interface MitigationVfx {
  /** Atualiza visibilidade e animação conforme mitigações em andamento. */
  update(state: SimState, simTime: number, frameDt: number): void;
}

// ------------------------------------------------------------------ //
interface VfxSlot {
  group: THREE.Group;
  meshes: THREE.Object3D[];
  animate(active: boolean, progress: number, simTime: number, dt: number): void;
}

function attach(parent: THREE.Object3D, slot: VfxSlot): void {
  slot.group.visible = false;
  parent.add(slot.group);
}

// ----------- Água — limpeza da peneira (M_SCREEN_CLEAN) ----------- //
function createWaterSprayVfx(): VfxSlot {
  const group = new THREE.Group();
  group.name = "VFX_WATER";

  const jetMat = new THREE.MeshBasicMaterial({
    color: 0x5ec8ff,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const jetPositions: [number, number, number, number][] = [
    [-1.8, 4.2, -1.2, -0.35],
    [1.8, 4.2, -1.2, 0.35],
    [-1.8, 4.2, 1.2, -0.35],
    [1.8, 4.2, 1.2, 0.35],
    [0, 4.8, 0, 0],
  ];

  const jets: THREE.Mesh[] = [];
  for (const [x, y, z, rotZ] of jetPositions) {
    const jet = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.2, 8, 1, true), jetMat);
    jet.position.set(x, y, z);
    jet.rotation.x = Math.PI * 0.42;
    jet.rotation.z = rotZ;
    group.add(jet);
    jets.push(jet);
  }

  const DROP_COUNT = 120;
  const dropGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(DROP_COUNT * 3);
  const seeds = new Float32Array(DROP_COUNT);
  for (let i = 0; i < DROP_COUNT; i++) {
    seeds[i] = Math.random();
    positions[i * 3] = (Math.random() - 0.5) * 4.5;
    positions[i * 3 + 1] = 2 + Math.random() * 3;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 3;
  }
  dropGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const dropMat = new THREE.PointsMaterial({
    color: 0x88ddff,
    size: 0.28,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  group.add(drops);

  const mist = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 16, 12),
    new THREE.MeshBasicMaterial({
      color: 0xa8e8ff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  mist.position.set(0, 2.8, 0);
  mist.scale.set(1.2, 0.5, 1);
  group.add(mist);

  return {
    group,
    meshes: [...jets, drops, mist],
    animate(active, progress, simTime, dt) {
      group.visible = active;
      if (!active) return;
      const pulse = 0.5 + 0.5 * Math.sin(simTime * 12);
      jetMat.opacity = 0.4 + pulse * 0.35;
      mist.scale.y = 0.45 + pulse * 0.15;
      mist.material.opacity = 0.08 + progress * 0.12;

      const pos = dropGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < DROP_COUNT; i++) {
        const phase = (seeds[i] + simTime * 2.5) % 1;
        const y = 5.5 - phase * 4;
        pos.setY(i, y);
        pos.setX(i, (Math.sin(simTime * 3 + seeds[i] * 20) * 0.15 + seeds[i] - 0.5) * 4.5);
      }
      pos.needsUpdate = true;
      dropMat.size = 0.22 + pulse * 0.12;

      for (const j of jets) {
        j.scale.y = 0.85 + pulse * 0.3;
      }
    },
  };
}

// ----------- Carregamento — material caindo no silo (M_REFILL) ----------- //
function createSiloRefillVfx(): VfxSlot {
  const group = new THREE.Group();
  group.name = "VFX_REFILL";

  const COUNT = 48;
  const geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x8b6914,
    roughness: 0.9,
    metalness: 0.05,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.castShadow = false;
  group.add(mesh);

  const phases = new Float32Array(COUNT);
  const offsets = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    phases[i] = Math.random();
    offsets[i * 3] = (Math.random() - 0.5) * 4;
    offsets[i * 3 + 1] = 0;
    offsets[i * 3 + 2] = (Math.random() - 0.5) * 4;
  }

  const truck = new THREE.Mesh(
    new THREE.BoxGeometry(3.5, 1.2, 2),
    new THREE.MeshStandardMaterial({ color: 0xff9a3c, roughness: 0.6 }),
  );
  truck.position.set(-5, 12, 4);
  group.add(truck);

  const _m = new THREE.Matrix4();
  const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  return {
    group,
    meshes: [mesh, truck],
    animate(active, progress, simTime, dt) {
      group.visible = active;
      if (!active) return;

      truck.position.x = -5 + Math.sin(simTime * 0.8) * 0.3;
      truck.position.y = 11.5 + Math.sin(simTime * 2) * 0.1;

      for (let i = 0; i < COUNT; i++) {
        let p = (phases[i] + simTime * 0.9) % 1;
        const visible = active && p < 0.92;
        if (!visible) {
          mesh.setMatrixAt(i, _hidden);
          continue;
        }
        const y = 11 - p * 7;
        _m.makeTranslation(
          offsets[i * 3] + Math.sin(simTime + i) * 0.2,
          y,
          offsets[i * 3 + 2],
        );
        mesh.setMatrixAt(i, _m);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

// ----------- Lubrificação — gotas azuis no JAW (M_LUBE) ----------- //
function createLubeVfx(): VfxSlot {
  const group = new THREE.Group();
  group.name = "VFX_LUBE";

  const COUNT = 40;
  const geo = new THREE.SphereGeometry(0.12, 6, 6);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x3ea6ff,
    transparent: true,
    opacity: 0.75,
  });
  const drops: THREE.Mesh[] = [];
  const seeds: number[] = [];
  for (let i = 0; i < COUNT; i++) {
    const d = new THREE.Mesh(geo, mat.clone());
    d.position.set((Math.random() - 0.5) * 3, Math.random() * 4, (Math.random() - 0.5) * 2);
    group.add(d);
    drops.push(d);
    seeds.push(Math.random());
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.08, 8, 32),
    new THREE.MeshBasicMaterial({ color: 0x3ea6ff, transparent: true, opacity: 0.5 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.5;
  group.add(ring);

  return {
    group,
    meshes: [...drops, ring],
    animate(active, progress, simTime, dt) {
      group.visible = active;
      if (!active) return;
      ring.rotation.z = simTime * 0.5;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.25 + progress * 0.4;

      for (let i = 0; i < drops.length; i++) {
        const phase = (seeds[i] + simTime * 1.2) % 1;
        drops[i].position.y = 4.5 - phase * 3.5;
        drops[i].position.x = Math.sin(simTime * 2 + seeds[i] * 10) * 1.2;
        (drops[i].material as THREE.MeshBasicMaterial).opacity =
          phase < 0.85 ? 0.7 : 0.1;
      }
    },
  };
}

// ----------- Soft restart — pulso amarelo no JAW (M_SOFT_RESTART) ----------- //
function createSoftRestartVfx(): VfxSlot {
  const group = new THREE.Group();
  group.name = "VFX_SOFT_RESTART";

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(2.5, 16, 16),
    new THREE.MeshBasicMaterial({
      color: 0xf1c40f,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
  );
  glow.position.y = 2.5;
  group.add(glow);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.8, 2.4, 32),
    new THREE.MeshBasicMaterial({
      color: 0xf1c40f,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.5;
  group.add(ring);

  return {
    group,
    meshes: [glow, ring],
    animate(active, progress, simTime, dt) {
      group.visible = active;
      if (!active) return;
      const pulse = 0.5 + 0.5 * Math.sin(simTime * 6);
      glow.scale.setScalar(0.9 + pulse * 0.25);
      (glow.material as THREE.MeshBasicMaterial).opacity = 0.12 + pulse * 0.2;
      ring.scale.setScalar(0.85 + (1 - progress) * 0.3 * pulse);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + pulse * 0.35;
    },
  };
}

// ----------- Tramp release — cone abre (M_TRAMP_RELEASE) ----------- //
function createTrampReleaseVfx(): VfxSlot {
  const group = new THREE.Group();
  group.name = "VFX_TRAMP";

  const hydMat = new THREE.MeshStandardMaterial({ color: 0xffc107, metalness: 0.4, roughness: 0.5 });
  const rods: THREE.Mesh[] = [];
  for (const x of [-1.8, 1.8]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1, 10), hydMat);
    rod.position.set(x, 2.8, 0);
    group.add(rod);
    rods.push(rod);
  }

  const gapRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.06, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xff5252, transparent: true, opacity: 0.7 }),
  );
  gapRing.rotation.x = Math.PI / 2;
  gapRing.position.y = 4.2;
  group.add(gapRing);

  const debris = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.5, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.8 }),
  );
  debris.position.set(0, 4.5, 0.5);
  group.add(debris);

  return {
    group,
    meshes: [...rods, gapRing, debris],
    animate(active, progress, simTime, dt) {
      group.visible = active;
      if (!active) return;
      const open = Math.min(1, progress * 1.4) * 1.2;
      for (const r of rods) {
        r.scale.y = 0.5 + open * 1.5;
        r.position.y = 2.2 + open * 0.8;
      }
      gapRing.position.y = 3.8 + open * 0.9;
      gapRing.scale.setScalar(0.8 + open * 0.35);
      debris.position.y = 4.2 + open * 1.5;
      debris.rotation.y = simTime * 2;
      (gapRing.material as THREE.MeshBasicMaterial).opacity = 0.4 + open * 0.4;
    },
  };
}

// ------------------------------------------------------------------ //
const VFX_BY_MITIGATION: Record<MitigationActionId, (() => VfxSlot) | null> = {
  M_SCREEN_CLEAN: createWaterSprayVfx,
  M_REFILL: createSiloRefillVfx,
  M_LUBE: createLubeVfx,
  M_SOFT_RESTART: createSoftRestartVfx,
  M_TRAMP_RELEASE: createTrampReleaseVfx,
};

const EQUIP_BY_MITIGATION: Record<MitigationActionId, EquipmentId> = {
  M_SCREEN_CLEAN: "SCREEN",
  M_REFILL: "SILO",
  M_LUBE: "JAW",
  M_SOFT_RESTART: "JAW",
  M_TRAMP_RELEASE: "CONE",
};

// ------------------------------------------------------------------ //
export function createMitigationVfx(
  nodes: Record<EquipmentId, EquipmentNode>,
): MitigationVfx {
  const slots = new Map<MitigationActionId, VfxSlot>();

  for (const id of Object.keys(VFX_BY_MITIGATION) as MitigationActionId[]) {
    const factory = VFX_BY_MITIGATION[id];
    if (!factory) continue;
    const equipId = EQUIP_BY_MITIGATION[id];
    const node = nodes[equipId];
    if (!node) continue;
    const slot = factory();
    attach(node.group, slot);
    slots.set(id, slot);
  }

  return {
    update(state: SimState, simTime: number, frameDt: number) {
      for (const [mitId, slot] of slots) {
        const progress = getMitigationProgress(state, mitId);
        const active = progress !== null;
        slot.animate(active, progress ?? 0, simTime, frameDt);
      }
    },
  };
}
