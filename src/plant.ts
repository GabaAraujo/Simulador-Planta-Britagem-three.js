/**
 * Cria os equipamentos a partir de primitivas, posiciona o layout linear (B)
 * e prepara os streams de partículas (material) com InstancedMesh.
 *
 * Convencao:
 *  - eixo X = direção da produção (esquerda → direita)
 *  - eixo Y = altura
 *  - eixo Z = profundidade (retorno desloca-se em -Z)
 *  - 1 unidade ≈ 1 metro.
 */

import * as THREE from "three";
import type { EquipmentId, EquipmentNode } from "./types";
import { EQUIPMENTS } from "./config";

// ------------------------------------------------------------------ //
// Tipos do módulo
// ------------------------------------------------------------------ //
export interface ParticleStream {
  mesh: THREE.InstancedMesh;
  curve: THREE.Curve<THREE.Vector3>;
  /** Progresso 0..1 de cada instância. */
  progress: Float32Array;
  /** Quantidade de instâncias reservadas. */
  count: number;
  /** Velocidade base (frações da curva por segundo). */
  baseSpeed: number;
  /** Visível. */
  enabled: boolean;
}

export interface PlantCtx {
  root: THREE.Group;
  nodes: Record<EquipmentId, EquipmentNode>;
  /** Meshes que o raycaster pode selecionar (com `userData.equipmentId`). */
  pickables: THREE.Object3D[];
  /** Sprites de label (toggle). */
  labels: THREE.Sprite[];
  flows: {
    conv: ParticleStream;
    oversize: ParticleStream;
    undersize: ParticleStream;
  };
  /** Linhas guia (setas) do fluxo. */
  flowLines: THREE.Object3D[];
  setLabelsVisible(v: boolean): void;
  setOversizeReturnVisible(v: boolean): void;
}

// ------------------------------------------------------------------ //
// Helpers de label (sprite com canvas)
// ------------------------------------------------------------------ //
function makeLabelSprite(text: string): THREE.Sprite {
  const padding = 16;
  const fontSize = 44;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
  const textW = Math.ceil(ctx.measureText(text).width);
  canvas.width = textW + padding * 2;
  canvas.height = fontSize + padding * 2;

  const ctx2 = canvas.getContext("2d")!;
  // fundo arredondado
  ctx2.fillStyle = "rgba(15, 22, 32, 0.85)";
  roundRect(ctx2, 0, 0, canvas.width, canvas.height, 14);
  ctx2.fill();
  ctx2.strokeStyle = "rgba(62, 166, 255, 0.65)";
  ctx2.lineWidth = 2;
  roundRect(ctx2, 1, 1, canvas.width - 2, canvas.height - 2, 14);
  ctx2.stroke();

  ctx2.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
  ctx2.fillStyle = "#e4ecf7";
  ctx2.textAlign = "center";
  ctx2.textBaseline = "middle";
  ctx2.fillText(text, canvas.width / 2, canvas.height / 2 + 2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;

  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  // Escala mantendo aspecto. 4 unidades de altura aprox.
  const aspect = canvas.width / canvas.height;
  const h = 1.8;
  sprite.scale.set(h * aspect, h, 1);
  sprite.renderOrder = 999;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ------------------------------------------------------------------ //
// Materiais padrão (compartilhados)
// ------------------------------------------------------------------ //
const matSteel = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.55 });

const matRubber = (color: number) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0.05 });

// ------------------------------------------------------------------ //
// Builders de equipamento
// ------------------------------------------------------------------ //
function buildSilo(color: number): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const g = new THREE.Group();

  // skirt (base estrutural)
  const skirtGeo = new THREE.CylinderGeometry(3.2, 3.2, 1.5, 24);
  const skirt = new THREE.Mesh(skirtGeo, matSteel(0x445469));
  skirt.position.y = 0.75;
  skirt.castShadow = skirt.receiveShadow = true;
  g.add(skirt);

  // corpo cilíndrico
  const bodyGeo = new THREE.CylinderGeometry(3, 3, 8, 24);
  const body = new THREE.Mesh(bodyGeo, matSteel(color));
  body.position.y = 1.5 + 4;
  body.castShadow = body.receiveShadow = true;
  g.add(body);

  // funil cônico
  const funnelGeo = new THREE.CylinderGeometry(3, 0.6, 2.5, 24, 1, true);
  const funnel = new THREE.Mesh(funnelGeo, matSteel(0x4a5b73));
  funnel.position.y = 1.5;
  funnel.castShadow = true;
  g.add(funnel);

  // chute de saída
  const chuteGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12);
  const chute = new THREE.Mesh(chuteGeo, matSteel(0x37445b));
  chute.position.set(0, 0.3, 0);
  g.add(chute);

  // tampa superior
  const lidGeo = new THREE.CylinderGeometry(3.0, 3.0, 0.3, 24);
  const lid = new THREE.Mesh(lidGeo, matSteel(0x2f3a4a));
  lid.position.y = 1.5 + 8 + 0.15;
  g.add(lid);

  return { group: g, pickables: [body, funnel, skirt] };
}

function buildFeeder(color: number): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const g = new THREE.Group();

  // estrutura
  const baseGeo = new THREE.BoxGeometry(5, 0.4, 3);
  const base = new THREE.Mesh(baseGeo, matSteel(0x394456));
  base.position.y = 0.6;
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  // calha vibratória
  const trayGeo = new THREE.BoxGeometry(5.4, 0.6, 2.6);
  const tray = new THREE.Mesh(trayGeo, matSteel(color));
  tray.position.y = 1.2;
  tray.castShadow = tray.receiveShadow = true;
  g.add(tray);

  // motores laterais
  const motorGeo = new THREE.CylinderGeometry(0.4, 0.4, 1.0, 16);
  const motorMat = matSteel(0xff9a3c);
  const motorL = new THREE.Mesh(motorGeo, motorMat);
  motorL.rotation.z = Math.PI / 2;
  motorL.position.set(0, 1.2, 1.7);
  g.add(motorL);
  const motorR = motorL.clone();
  motorR.position.z = -1.7;
  g.add(motorR);

  return { group: g, pickables: [tray, base] };
}

function buildJaw(color: number): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const g = new THREE.Group();

  // bloco principal
  const blockGeo = new THREE.BoxGeometry(4, 4.5, 4);
  const block = new THREE.Mesh(blockGeo, matSteel(color));
  block.position.y = 2.5;
  block.castShadow = block.receiveShadow = true;
  g.add(block);

  // tremonha (hopper)
  const hopperGeo = new THREE.CylinderGeometry(2.4, 1.0, 1.6, 4, 1, true);
  const hopper = new THREE.Mesh(hopperGeo, matSteel(0x37445b));
  hopper.rotation.y = Math.PI / 4;
  hopper.position.y = 5.5;
  g.add(hopper);

  // mandíbula móvel (representação)
  const jawGeo = new THREE.BoxGeometry(0.4, 3, 3.6);
  const jaw = new THREE.Mesh(jawGeo, matSteel(0x6b7c93));
  jaw.position.set(1.6, 2.6, 0);
  g.add(jaw);

  // base de concreto
  const padGeo = new THREE.BoxGeometry(5.5, 0.4, 5.5);
  const pad = new THREE.Mesh(padGeo, matRubber(0x3a4250));
  pad.position.y = 0.2;
  pad.receiveShadow = true;
  g.add(pad);

  return { group: g, pickables: [block, hopper, jaw] };
}

function buildConveyor(color: number): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const g = new THREE.Group();

  // Comprimento total: de -8 a +10 em torno do centro (1).
  // Em coords locais: -9 a +9 (length=18).
  const length = 18;
  const beltHeight = 3;
  const beltWidth = 1.5;

  // Esteira (correia)
  const beltGeo = new THREE.BoxGeometry(length, 0.1, beltWidth);
  const belt = new THREE.Mesh(beltGeo, matRubber(color));
  belt.position.y = beltHeight;
  belt.castShadow = belt.receiveShadow = true;
  g.add(belt);

  // Roletes nas pontas
  const rollerGeo = new THREE.CylinderGeometry(0.4, 0.4, beltWidth + 0.2, 16);
  const rollerMat = matSteel(0xcfd4dc);
  const r1 = new THREE.Mesh(rollerGeo, rollerMat);
  r1.rotation.x = Math.PI / 2;
  r1.position.set(-length / 2, beltHeight, 0);
  g.add(r1);
  const r2 = r1.clone();
  r2.position.x = length / 2;
  g.add(r2);

  // Estrutura/pernas
  const legMat = matSteel(0x2a3340);
  const numLegs = 6;
  for (let i = 0; i < numLegs; i++) {
    const x = -length / 2 + (i + 0.5) * (length / numLegs);
    const legGeo = new THREE.BoxGeometry(0.2, beltHeight, 0.2);
    const lLeft = new THREE.Mesh(legGeo, legMat);
    lLeft.position.set(x, beltHeight / 2, beltWidth / 2 + 0.1);
    g.add(lLeft);
    const lRight = lLeft.clone();
    lRight.position.z = -(beltWidth / 2 + 0.1);
    g.add(lRight);
  }

  // Cobertura lateral (corrimões)
  const railGeo = new THREE.BoxGeometry(length, 0.06, 0.06);
  const railMat = matSteel(0xffb02f);
  const railTop1 = new THREE.Mesh(railGeo, railMat);
  railTop1.position.set(0, beltHeight + 0.9, beltWidth / 2 + 0.15);
  g.add(railTop1);
  const railTop2 = railTop1.clone();
  railTop2.position.z = -(beltWidth / 2 + 0.15);
  g.add(railTop2);

  return { group: g, pickables: [belt, r1, r2] };
}

function buildScreen(color: number): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const g = new THREE.Group();

  // base com molas (representativo)
  const padGeo = new THREE.BoxGeometry(5, 0.3, 4);
  const pad = new THREE.Mesh(padGeo, matSteel(0x3a4250));
  pad.position.y = 0.15;
  g.add(pad);

  // caixa inclinada (deck superior)
  const screenGeo = new THREE.BoxGeometry(5.5, 1.0, 3.5);
  const screen = new THREE.Mesh(screenGeo, matSteel(color));
  screen.position.set(0, 3, 0);
  screen.rotation.z = -0.18; // inclinação típica
  screen.castShadow = screen.receiveShadow = true;
  g.add(screen);

  // deck inferior (undersize)
  const deck2 = screen.clone();
  deck2.material = matSteel(0x357a3a);
  deck2.position.set(0, 2, 0);
  g.add(deck2);

  // molas (cilindros laranjas)
  const springMat = matRubber(0xff7e2f);
  for (const dx of [-2, 2]) {
    for (const dz of [-1.5, 1.5]) {
      const sp = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 1.5, 12),
        springMat,
      );
      sp.position.set(dx, 1.05, dz);
      g.add(sp);
    }
  }

  // chute oversize (lateral alta, lado +X)
  const overChute = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.6, 1.5),
    matSteel(0x444d5e),
  );
  overChute.position.set(3.0, 3.5, 0);
  g.add(overChute);

  // chute undersize (lateral baixa, saída em diagonal frontal)
  const underChute = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.5, 1.4),
    matSteel(0x3d6b3f),
  );
  underChute.position.set(2.5, 1.4, 1.6);
  g.add(underChute);

  return { group: g, pickables: [screen, deck2, overChute, underChute] };
}

function buildCone(color: number): { group: THREE.Group; pickables: THREE.Object3D[] } {
  const g = new THREE.Group();

  // base de concreto
  const padGeo = new THREE.BoxGeometry(5, 0.4, 5);
  const pad = new THREE.Mesh(padGeo, matSteel(0x3a4250));
  pad.position.y = 0.2;
  g.add(pad);

  // corpo cilíndrico baixo
  const bodyGeo = new THREE.CylinderGeometry(2.2, 2.2, 2.2, 24);
  const body = new THREE.Mesh(bodyGeo, matSteel(0x5b6a82));
  body.position.y = 1.5;
  g.add(body);

  // cabeça cônica (parte superior — o "cone")
  const headGeo = new THREE.ConeGeometry(2.0, 2.5, 24);
  const head = new THREE.Mesh(headGeo, matSteel(color));
  head.position.y = 3.6;
  head.castShadow = true;
  g.add(head);

  // tremonha superior
  const hopperGeo = new THREE.CylinderGeometry(2.6, 1.6, 1.2, 24, 1, true);
  const hopper = new THREE.Mesh(hopperGeo, matSteel(0x4a5b73));
  hopper.position.y = 5.5;
  g.add(hopper);

  // motor lateral
  const motor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 1.5, 16),
    matSteel(0xff9a3c),
  );
  motor.position.set(2.6, 1.6, 0);
  motor.rotation.z = Math.PI / 2;
  g.add(motor);

  return { group: g, pickables: [body, head, hopper] };
}

// ------------------------------------------------------------------ //
// Curvas de fluxo (waypoints)
// ------------------------------------------------------------------ //

/** Curva da correia (linear: saída do FEEDER/JAW → chute SCREEN). */
function buildConvCurve(): THREE.Curve<THREE.Vector3> {
  // Em coords mundiais (não locais): a correia vai de x=-8 até x=+10, y=3.1
  const start = new THREE.Vector3(-8, 3.1, 0);
  const end = new THREE.Vector3(10, 3.1, 0);
  return new THREE.LineCurve3(start, end);
}

/** Curva do retorno oversize: SCREEN (alto) → CONE → volta perto da entrada da SCREEN. */
function buildReturnCurve(): THREE.CatmullRomCurve3 {
  const pts = [
    new THREE.Vector3(16, 4.0, 0.5),   // saída lateral alta da SCREEN (oversize)
    new THREE.Vector3(19, 5.5, -2.5),
    new THREE.Vector3(23, 6.5, -6.0),
    new THREE.Vector3(28, 6.5, -10),   // topo do CONE (entrada)
    new THREE.Vector3(28, 1.0, -10),   // base do CONE (saída material recirculado)
    new THREE.Vector3(23, 1.0, -8),
    new THREE.Vector3(18, 2.0, -3),
    new THREE.Vector3(13, 3.1, 0),     // re-entra perto da entrada da SCREEN / fim da CONV
  ];
  const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
  return curve;
}

/** Curva do undersize: do chute da SCREEN até pilha de produto. */
function buildUndersizeCurve(): THREE.Curve<THREE.Vector3> {
  const pts = [
    new THREE.Vector3(18.5, 1.4, 1.6),
    new THREE.Vector3(20, 0.9, 4),
    new THREE.Vector3(22, 0.3, 8),
  ];
  return new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.4);
}

// ------------------------------------------------------------------ //
// Stream de partículas (InstancedMesh recyclable)
// ------------------------------------------------------------------ //
function makeParticleStream(
  curve: THREE.Curve<THREE.Vector3>,
  count: number,
  size: number,
  color: number,
  baseSpeed: number,
): ParticleStream {
  const geo = new THREE.BoxGeometry(size, size, size);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0.15,
    flatShading: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.castShadow = false;
  mesh.frustumCulled = false;

  const progress = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    progress[i] = i / count; // espalhar uniformemente
  }

  return { mesh, curve, progress, count, baseSpeed, enabled: true };
}

/** Atualiza posições das partículas. `flowFactor` 0..1+ controla velocidade e densidade. */
export function updateStream(stream: ParticleStream, dt: number, flowFactor: number): void {
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const speed = stream.baseSpeed * Math.max(0, flowFactor);
  // densidade: se flow ≈ 0, esconde a maioria das partículas
  const visibleFrac = stream.enabled ? Math.min(1, flowFactor * 1.2) : 0;

  for (let i = 0; i < stream.count; i++) {
    let p = stream.progress[i] + speed * dt;
    if (p >= 1) p -= Math.floor(p);
    stream.progress[i] = p;

    const visible = stream.enabled && i / stream.count < visibleFrac;
    if (!visible) {
      // "esconder" colapsando escala para 0
      m.makeScale(0, 0, 0);
      stream.mesh.setMatrixAt(i, m);
      continue;
    }
    stream.curve.getPointAt(p, pos);
    m.makeTranslation(pos.x, pos.y, pos.z);
    stream.mesh.setMatrixAt(i, m);
  }
  stream.mesh.instanceMatrix.needsUpdate = true;
}

// ------------------------------------------------------------------ //
// Linhas-guia do fluxo (TubeGeometry)
// ------------------------------------------------------------------ //
function buildFlowTube(curve: THREE.Curve<THREE.Vector3>, color: number, radius: number): THREE.Mesh {
  const tubeGeo = new THREE.TubeGeometry(curve, 80, radius, 8, false);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.35,
  });
  return new THREE.Mesh(tubeGeo, mat);
}

// ------------------------------------------------------------------ //
// Função principal
// ------------------------------------------------------------------ //
export function buildPlant(scene: THREE.Scene): PlantCtx {
  const root = new THREE.Group();
  root.name = "PLANT_ROOT";
  scene.add(root);

  const nodes = {} as Record<EquipmentId, EquipmentNode>;
  const pickables: THREE.Object3D[] = [];
  const labels: THREE.Sprite[] = [];

  for (const def of EQUIPMENTS) {
    if (def.id === "RETURN") continue; // RETURN é virtual (curva); tratado abaixo

    let built: { group: THREE.Group; pickables: THREE.Object3D[] };
    switch (def.id) {
      case "SILO":   built = buildSilo(def.color); break;
      case "FEEDER": built = buildFeeder(def.color); break;
      case "JAW":    built = buildJaw(def.color); break;
      case "CONV":   built = buildConveyor(def.color); break;
      case "SCREEN": built = buildScreen(def.color); break;
      case "CONE":   built = buildCone(def.color); break;
      default:
        // pula equipamentos desconhecidos
        continue;
    }

    built.group.position.set(def.position[0], def.position[1], def.position[2]);
    built.group.name = def.id;
    root.add(built.group);

    // Anotação para o raycaster
    for (const p of built.pickables) {
      p.userData.equipmentId = def.id;
      pickables.push(p);
    }

    // Label sprite acima do equipamento (nome curto em PT-BR)
    const label = makeLabelSprite(def.displayName);
    // posicionar de acordo com tipo:
    const labelOffsetY: Record<EquipmentId, number> = {
      SILO: 12.5,
      FEEDER: 3.0,
      JAW: 8.5,
      CONV: 5.0,
      SCREEN: 6.0,
      CONE: 8.0,
      RETURN: 0,
    };
    label.position.set(def.position[0], labelOffsetY[def.id], def.position[2]);
    scene.add(label);
    labels.push(label);

    nodes[def.id] = {
      def,
      group: built.group,
      pickables: built.pickables,
      state: "STOP",
      baseColor: def.color,
    };
  }

  // RETURN como equipamento "lógico" — sem mesh próprio
  const returnDef = EQUIPMENTS.find((e) => e.id === "RETURN")!;
  nodes["RETURN"] = {
    def: returnDef,
    group: new THREE.Group(),
    pickables: [],
    state: "STOP",
    baseColor: returnDef.color,
  };

  // ----------- Curvas de fluxo e tubos guia ----------- //
  const convCurve = buildConvCurve();
  const returnCurve = buildReturnCurve();
  const undersizeCurve = buildUndersizeCurve();

  const flowLines: THREE.Object3D[] = [];
  const tubeConv = buildFlowTube(convCurve, 0xffb02f, 0.05);
  const tubeReturn = buildFlowTube(returnCurve, 0xe67e22, 0.12);
  const tubeUnder = buildFlowTube(undersizeCurve, 0x2ecc71, 0.10);
  scene.add(tubeConv, tubeReturn, tubeUnder);
  flowLines.push(tubeConv, tubeReturn, tubeUnder);

  // ----------- Streams de partículas ----------- //
  const convStream = makeParticleStream(convCurve, 60, 0.22, 0xd1a36b, 0.18);
  const oversizeStream = makeParticleStream(returnCurve, 80, 0.26, 0xe67e22, 0.10);
  const undersizeStream = makeParticleStream(undersizeCurve, 35, 0.18, 0xa0e75a, 0.30);

  scene.add(convStream.mesh, oversizeStream.mesh, undersizeStream.mesh);

  const ctx: PlantCtx = {
    root,
    nodes,
    pickables,
    labels,
    flows: {
      conv: convStream,
      oversize: oversizeStream,
      undersize: undersizeStream,
    },
    flowLines,
    setLabelsVisible(v: boolean) {
      for (const s of labels) s.visible = v;
    },
    setOversizeReturnVisible(v: boolean) {
      tubeReturn.visible = v;
      oversizeStream.enabled = v;
    },
  };

  return ctx;
}

// ------------------------------------------------------------------ //
// Helpers de coloração (para o sim atualizar estados)
// ------------------------------------------------------------------ //
const STATE_COLORS: Record<EquipmentNode["state"], number | null> = {
  RUN: null,        // mantém a cor base
  STOP: 0x4a5566,   // cinza desligado
  ALARM: 0xff4040,  // vermelho alarme
};

/** Aplica a cor correspondente ao estado em todos os pickables de um equipamento. */
export function applyEquipmentStateColor(node: EquipmentNode): void {
  const override = STATE_COLORS[node.state];
  const target = override ?? node.baseColor;
  for (const obj of node.pickables) {
    const mesh = obj as THREE.Mesh;
    if (!(mesh.material instanceof THREE.MeshStandardMaterial)) continue;
    mesh.material.color.setHex(target);
    if (node.state === "ALARM") {
      mesh.material.emissive.setHex(0x661010);
      mesh.material.emissiveIntensity = 0.6;
    } else {
      mesh.material.emissive.setHex(0x000000);
      mesh.material.emissiveIntensity = 0;
    }
  }
}
