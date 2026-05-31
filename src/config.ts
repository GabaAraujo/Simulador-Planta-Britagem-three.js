/**
 * Configuração central da planta: equipamentos, tags, limites, setpoints e malhas.
 * Layout B (Linear Industrial) ao longo do eixo X.
 */

import type {
  EquipmentDef,
  EquipmentId,
  Tag,
  TagId,
  ControlLoop,
  LoopId,
  FaultId,
} from "./types";

// ----------- Equipamentos (layout linear) ----------- //
export const EQUIPMENTS: EquipmentDef[] = [
  {
    id: "SILO",
    displayName: "SILO",
    label: "Silo de Estocagem",
    position: [-30, 8, 0],
    color: 0x6b7c93,
    tags: ["LT-101"],
    loops: ["LIC-101"],
  },
  {
    id: "FEEDER",
    displayName: "ALIMENTADOR",
    label: "Alimentador Vibratório",
    position: [-22, 5.5, 0],
    color: 0xc97b3a,
    tags: ["ST-102", "FV-102"],
    loops: ["LIC-101", "FIC-105", "CIC-103"],
  },
  {
    id: "JAW",
    displayName: "BRIT. MANDÍBULAS",
    label: "Britador de Mandíbulas",
    position: [-14, 0, 0],
    color: 0x9aa5b1,
    tags: ["PT-103", "CT-103", "VT-104"],
    loops: ["CIC-103", "VAH-104"],
  },
  {
    id: "CONV",
    displayName: "CORREIA TC-01",
    label: "Correia Transportadora TC-01",
    position: [1, 0, 0],
    color: 0x3b424c,
    tags: ["WT-105", "ST-105"],
    loops: ["FIC-105"],
  },
  {
    id: "SCREEN",
    displayName: "PENEIRA",
    label: "Peneira Vibratória",
    position: [16, 0, 0],
    color: 0x4caf50,
    tags: ["FT-106"],
  },
  {
    id: "CONE",
    displayName: "BRIT. CÔNICO",
    label: "Britador Cônico Secundário",
    position: [28, 0, -10],
    color: 0x8e44ad,
    tags: ["PT-106", "CT-106", "CSS-106"],
  },
  {
    id: "RETURN",
    displayName: "RETORNO",
    label: "Retorno de Oversize",
    position: [22, 0, -5],
    color: 0xe67e22,
    tags: [],
  },
];

export const EQUIPMENT_BY_ID: Record<EquipmentId, EquipmentDef> = EQUIPMENTS.reduce(
  (acc, e) => {
    acc[e.id] = e;
    return acc;
  },
  {} as Record<EquipmentId, EquipmentDef>,
);

// ----------- Tags ----------- //
export const TAGS: Tag[] = [
  // SILO
  { id: "LT-101", kind: "PV", unit: "m",   initial: 6.0, min: 0, max: 10, hi: 9.5, desc: "Nível do silo",                     equipment: "SILO" },
  // FEEDER
  { id: "ST-102", kind: "PV", unit: "rpm", initial: 0,   min: 0, max: 1000, desc: "Velocidade do alimentador",                 equipment: "FEEDER" },
  { id: "FV-102", kind: "MV", unit: "Hz",  initial: 30,  min: 0, max: 60,  desc: "Amplitude/Frequência alimentador (MV)",      equipment: "FEEDER" },
  // JAW
  { id: "PT-103", kind: "PV", unit: "bar", initial: 80,  min: 0, max: 250, hi: 200, desc: "Pressão hidráulica jaw",            equipment: "JAW" },
  { id: "CT-103", kind: "PV", unit: "A",   initial: 30,  min: 0, max: 200, hi: 160, desc: "Corrente motor jaw",                equipment: "JAW" },
  { id: "VT-104", kind: "PV", unit: "mm/s",initial: 2.0, min: 0, max: 20,  hi: 10,  desc: "Vibração jaw (alarme VAH-104)",     equipment: "JAW" },
  // CONV
  { id: "WT-105", kind: "PV", unit: "t/h", initial: 0,   min: 0, max: 400, desc: "Vazão mássica na correia (WT)",              equipment: "CONV" },
  { id: "ST-105", kind: "PV", unit: "m/s", initial: 2.5, min: 0, max: 4,   desc: "Velocidade da correia",                      equipment: "CONV" },
  // SCREEN
  { id: "FT-106", kind: "PV", unit: "m³/h",initial: 0,   min: 0, max: 200, desc: "Vazão volumétrica entrada peneira",          equipment: "SCREEN" },
  // CONE
  { id: "PT-106", kind: "PV", unit: "bar", initial: 60,  min: 0, max: 250, hi: 200, desc: "Pressão hidráulica cone",           equipment: "CONE" },
  { id: "CT-106", kind: "PV", unit: "A",   initial: 25,  min: 0, max: 200, hi: 170, desc: "Corrente motor cone",               equipment: "CONE" },
  { id: "CSS-106",kind: "MV", unit: "mm",  initial: 22,  min: 6, max: 40,            desc: "Abertura CSS cone (Close Side Set)", equipment: "CONE" },
];

export const TAG_BY_ID: Record<TagId, Tag> = TAGS.reduce((acc, t) => {
  acc[t.id] = t;
  return acc;
}, {} as Record<TagId, Tag>);

// ----------- Setpoints de processo ----------- //
export const SETPOINTS = {
  /** LIC-101: setpoint de nível do silo (m). Tenta manter próximo. */
  SILO_LEVEL: 6.0,
  /** FIC-105: setpoint de vazão mássica (t/h). */
  WT_PROD: 220,
  /** CIC-103: corrente máxima permitida no jaw (A). Acima → override reduz FV. */
  JAW_I_MAX: 150,
  /** VAH-104: limite de vibração (mm/s) p/ alarme alta. */
  VIB_HI: 10,
} as const;

// ----------- Loops de controle ----------- //
export const LOOPS: Record<LoopId, ControlLoop> = {
  "LIC-101": {
    id: "LIC-101",
    description: "Controle de nível do silo via FV-102 (alimentador).",
    setpoint: SETPOINTS.SILO_LEVEL,
    kp: 1.8,
    ki: 0.15,
    integral: 0,
    inputTag: "LT-101",
    outputTag: "FV-102",
  },
  "CIC-103": {
    id: "CIC-103",
    description: "Limite de corrente no JAW; reduz FV-102 se CT-103 > limite.",
    setpoint: SETPOINTS.JAW_I_MAX,
    kp: 0.35,
    ki: 0.0,
    integral: 0,
    inputTag: "CT-103",
    outputTag: "FV-102",
  },
  "FIC-105": {
    id: "FIC-105",
    description: "Controle de vazão (WT-105) via FV-102 (saturação).",
    setpoint: SETPOINTS.WT_PROD,
    kp: 0.12,
    ki: 0.04,
    integral: 0,
    inputTag: "WT-105",
    outputTag: "FV-102",
  },
  "VAH-104": {
    id: "VAH-104",
    description: "Alarme de alta vibração no JAW.",
    setpoint: SETPOINTS.VIB_HI,
    inputTag: "VT-104",
  },
  "IAH-106": {
    id: "IAH-106",
    description: "Alarme de alta corrente no britador cônico.",
    setpoint: 170,
    inputTag: "CT-106",
  },
};

// ----------- Catálogo de falhas (para o painel "Simular falhas") ----------- //
export interface FaultDef {
  id: FaultId;
  equipment: EquipmentId;
  label: string;
  description: string;
}
export const FAULTS: FaultDef[] = [
  {
    id: "JAW_BEARING",
    equipment: "JAW",
    label: "Desgaste de mancal (JAW)",
    description: "Eleva a vibração do britador → dispara VAH-104.",
  },
  {
    id: "JAW_OVERLOAD",
    equipment: "JAW",
    label: "Sobrecarga (JAW)",
    description: "Eleva a corrente do motor → dispara IAH-103.",
  },
  {
    id: "SCREEN_BLIND",
    equipment: "SCREEN",
    label: "Peneira cega",
    description: "Eficiência cai; mais oversize volta ao circuito.",
  },
  {
    id: "CONE_JAM",
    equipment: "CONE",
    label: "Britador cônico travado",
    description: "Eleva a corrente do cone → dispara IAH-106.",
  },
  {
    id: "SILO_LOW",
    equipment: "SILO",
    label: "Falha de alimentação (silo)",
    description: "Reposição zerada; nível e vazão caem.",
  },
];

// ----------- Parâmetros físicos da simulação ----------- //
export const SIM = {
  /** Capacidade nominal do silo (não usada para clamp visual, só referência). */
  SILO_CAPACITY_M: 10,
  /** Taxa máxima do feeder em t/h por unidade de FV (Hz). */
  FEED_PER_HZ: 7.0,           // 60Hz → ~420 t/h máximo teórico
  /** Coeficiente que converte t/h em corrente extra no JAW. */
  K_CT_FROM_FLOW: 0.4,        // 1 t/h ≈ 0.4 A acima do offset
  /** Offset (sem carga) da corrente do JAW. */
  CT_OFFSET: 25,
  /** Coeficiente vibração ~ corrente. */
  K_VIB: 0.045,
  /** Conversão t/h → m³/h na entrada da peneira. */
  TPH_TO_M3H: 0.55,
  /** Eficiência base da peneira. */
  EFF_BASE: 0.72,
  /** Recirculação real: fração que volta ao circuito após o CONE. */
  CONE_REINSERT: 0.85,
  /** Quanto a abertura CSS afeta a corrente do CONE (CSS menor → mais carga). */
  K_CONE_CSS: 1.6,
} as const;
