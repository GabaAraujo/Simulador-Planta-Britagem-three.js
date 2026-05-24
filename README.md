# SCADA-3D — Britagem & Peneiramento (Circuito Fechado)

MVP rodável de visualização 3D + SCADA para uma planta de britagem e peneiramento de minério em **circuito fechado**, construído com **Vite + TypeScript + Three.js** (sem frameworks de UI).

Fluxo simulado:

```
SILO → FEEDER → JAW → CONV (TC-01) → SCREEN
                                  ├── undersize → produto
                                  └── oversize  → CONE → volta ao circuito
```

Layout **B (Linear Industrial)** ao longo do eixo X, com correia longa e retorno oversize destacado no eixo Z.

---

## 1. Como rodar

Pré-requisitos: **Node.js 18+** e **npm**.

```bash
npm install
npm run dev
```

Acesse `http://localhost:5173`.

Para gerar build de produção (TypeScript em strict mode + Vite):

```bash
npm run build
npm run preview
```

---

## 2. Estrutura

```
.
├── index.html          # shell HTML com topbar, viewport e painel SCADA
├── package.json
├── tsconfig.json       # strict: true
├── vite.config.ts
└── src/
    ├── main.ts         # bootstrap + loop de animação
    ├── scene.ts        # renderer, câmera, luzes, OrbitControls
    ├── plant.ts        # equipamentos, labels, curvas de fluxo, partículas InstancedMesh
    ├── sim.ts          # simulação + malhas LIC/CIC/FIC/VAH
    ├── ui.ts           # painel SCADA vanilla (cards, badges, alarmes, drawer)
    ├── interactions.ts # raycaster (hover/click + highlight)
    ├── types.ts        # interfaces (Tag, EquipmentDef, SimState, ControlLoop, ...)
    ├── config.ts       # IDs, tags, limites, setpoints, equipamentos, loops
    └── style.css       # tema SCADA escuro
```

---

## 3. Como cada parte funciona

### 3.1 `scene.ts`
Cria `WebGLRenderer`, `Scene`, `PerspectiveCamera` (posição inicial `(0, 20, 55)` mirando `(0, 5, 0)`), luzes (ambient + directional com sombras leves + hemisphere de preenchimento), chão, grid e `OrbitControls` com damping. Trata redimensionamento.

### 3.2 `plant.ts`
- **Equipamentos** construídos com primitivas (`BoxGeometry`, `CylinderGeometry`, `ConeGeometry`) e materiais `MeshStandardMaterial`. Cada equipamento é um `THREE.Group` posicionado conforme `config.ts`.
- **Labels**: sprites com canvas (caixinha arredondada com texto). Podem ser ligados/desligados via `setLabelsVisible`.
- **Curvas de fluxo**:
  - Correia: `LineCurve3` de `(-8, 3.1, 0)` → `(10, 3.1, 0)`.
  - Retorno oversize: `CatmullRomCurve3` de waypoints SCREEN → CONE → re-entrada no circuito.
  - Chute undersize: `CatmullRomCurve3` saindo da SCREEN para a pilha de produto.
- **Tubos guia** (`TubeGeometry`) finos e translúcidos só para indicar a rota visualmente.
- **Partículas de material**: cada rota tem um `ParticleStream` com `InstancedMesh` (60 / 80 / 35 instâncias). Cada instância tem um `progress` (0..1) que avança ao longo da curva; ao chegar em 1, dá *wrap-around*. Quando o fluxo é baixo, as instâncias têm `scale = 0` (escondidas) — **nenhuma instância é criada/destruída por frame**.

### 3.3 `sim.ts`
- `createInitialState()` cria todas as tags com seus `initial` e clona os loops.
- `stepSim(state, dt)` faz o passo da simulação:
  1. **LIC-101** (PI): erro = LT-101 − SP → manipula `FV-102`.
  2. **FIC-105** (PI): erro = WT-105 − SP → ajusta `FV-102`.
  3. **CIC-103** (override P): se `CT-103 > 150 A`, força redução de `FV-102`.
  4. **Saturação** de `FV-102` em `[0, 60]` + filtro de 1ª ordem.
  5. Dinâmica: `ST-102 ≈ FV*16`, vazão do feeder = `FV * FEED_PER_HZ * siloFactor`, balanço do silo (reposição artificial − descarga), `WT-105 = feed + recirculação`, `CT-103` cresce com vazão, `VT-104` cresce com `CT-103` (e mais quando há "entupimento"), `FT-106 = WT * TPH_TO_M3H`, `screenEff` cai um pouco com `FT` alto, `CT-106` cresce com oversize e fica pior com **CSS menor** (`cssFactor`).
  6. **Alarmes**: `VAH-104` ativa quando `VT-104 > 10 mm/s`, marcando o JAW como `ALARM`.

### 3.4 `ui.ts`
Renderiza, em DOM puro:
- Lista de equipamentos com badge `RUN | STOP | ALARM`.
- Cards de tag (PV/MV) com `id`, `valor`, `unidade`. Card fica destacado em vermelho se o valor cruzar `hi`.
- Lista de alarmes ativos.
- Botões: **Start / Stop / Reset / Toggle Oversize Return / Toggle Labels / EMERGENCY STOP**.
- **Drawer** com nome, estado, tags, malhas e alarmes do equipamento clicado.
- O `refresh()` roda a ~10 Hz (e não 60 Hz) para a UI não competir com o render.

### 3.5 `interactions.ts`
`Raycaster` rodando 1× por frame:
- **Hover**: aplica `emissive` azul claro no material do equipamento sob o cursor.
- **Click** (sem arrasto): callback que abre o drawer.
Ao perder o hover, o equipamento volta à cor de **estado** (que pode ser cinza/STOP, base/RUN ou vermelho/ALARM via `applyEquipmentStateColor`).

### 3.6 `main.ts`
Loop com `requestAnimationFrame`:
1. `stepSim(state, dt)` (dt capado em 50 ms).
2. Atualiza cor de cada equipamento conforme estado.
3. `updateStream(...)` para as 3 trilhas (CONV / UNDERSIZE / OVERSIZE). Velocidade depende de `WT-105` e `ST-105`.
4. `interactions.update()`.
5. Render Three.js.
6. UI refresh a 10 Hz.

---

## 4. Mapeamento Equipamento ↔ Tags ↔ Malhas

| Equip   | Tags                                  | Malhas                       |
| ------- | ------------------------------------- | ---------------------------- |
| SILO    | LT-101                                | LIC-101                      |
| FEEDER  | ST-102, FV-102                        | LIC-101, FIC-105, CIC-103    |
| JAW     | PT-103, CT-103, VT-104                | CIC-103, VAH-104             |
| CONV    | WT-105, ST-105                        | FIC-105                      |
| SCREEN  | FT-106                                | —                            |
| CONE    | PT-106, CT-106, CSS-106               | —                            |

---

## 5. Atalhos no console (debug)

A aplicação expõe `window.__scada3d` em runtime para inspeção:

```js
__scada3d.state.values            // valores das tags
__scada3d.state.alarms            // alarmes ativos
__scada3d.plant.flows             // streams de partículas
__scada3d.scene.camera.position   // posição da câmera
```

---

## 6. Como substituir primitivas por **glTF** (sem assets externos obrigatórios)

O projeto **não depende** de assets externos — todos os equipamentos são primitivas. Se quiser substituí-los por modelos glTF mais tarde, sem alterar a arquitetura:

```ts
// em plant.ts (novo helper)
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const gltfLoader = new GLTFLoader();

async function loadGltfEquipment(url: string): Promise<THREE.Group> {
  const gltf = await gltfLoader.loadAsync(url);
  const root = gltf.scene as THREE.Group;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).castShadow = true;
      (o as THREE.Mesh).receiveShadow = true;
    }
  });
  return root;
}
```

E, no `buildPlant`, em vez de chamar `buildJaw(def.color)` etc., faça:

```ts
const root = await loadGltfEquipment("/models/jaw.glb");
root.position.set(def.position[0], 0, def.position[2]);
const pickables: THREE.Object3D[] = [];
root.traverse((o) => { if ((o as THREE.Mesh).isMesh) pickables.push(o); });
return { group: root, pickables };
```

Observações:
- Colocar `.glb` em `public/models/` (Vite serve diretamente).
- O **raycaster** continua funcionando: basta marcar `userData.equipmentId` nos meshes filhos.
- A **simulação e a UI não mudam** — toda a lógica é desacoplada da malha 3D.

---

## 7. Extensões sugeridas

- **Trends** (gráficos com `<canvas>` simples) para PVs ao longo do tempo.
- **Histórico de alarmes** (com timestamps de entrada/saída).
- **HMI overlay** sobre o 3D (CSS2DRenderer) para placas de status flutuantes.
- **Modos de operação** (manual/auto por loop) com toggle no drawer.
- **CSS-106 ajustável** via slider no drawer do CONE (já é MV — pronto para isso).
- **PI mais refinado** com anti-windup correto e bumpless transfer.


