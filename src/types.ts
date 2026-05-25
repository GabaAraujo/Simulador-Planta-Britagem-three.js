/**
 * Tipos centrais do projeto.
 * Sem `any` — todas as estruturas usadas pela UI/sim/cena estão tipadas aqui.
 */

import type { Object3D } from "three";

// ----------- IDs ----------- //
export type EquipmentId =
  | "SILO"
  | "FEEDER"
  | "JAW"
  | "CONV"
  | "SCREEN"
  | "CONE"
  | "RETURN";

export type TagId =
  | "LT-101"
  | "ST-102"
  | "FV-102"
  | "PT-103"
  | "CT-103"
  | "VT-104"
  | "WT-105"
  | "ST-105"
  | "FT-106"
  | "PT-106"
  | "CT-106"
  | "CSS-106";

export type LoopId = "LIC-101" | "CIC-103" | "FIC-105" | "VAH-104";

export type TagKind = "PV" | "MV";
export type EquipmentState = "RUN" | "STOP" | "ALARM";

// ----------- Tag ----------- //
export interface Tag {
  id: TagId;
  kind: TagKind;
  unit: string;
  /** Valor inicial e/ou normal. */
  initial: number;
  /** Limites operacionais (clamp). */
  min: number;
  max: number;
  /** Limite de alarme alto (opcional). */
  hi?: number;
  /** Descrição curta (para drawer). */
  desc: string;
  /** Equipamento associado (para drawer/scada). */
  equipment: EquipmentId;
}

// ----------- Equipamento ----------- //
export interface EquipmentDef {
  id: EquipmentId;
  /** Nome curto em PT-BR exibido no sprite 3D e na lista lateral. */
  displayName: string;
  /** Descrição completa em PT-BR (mostrada no cabeçalho do drawer). */
  label: string;
  position: [number, number, number];
  /** Cor base do equipamento (em hex). */
  color: number;
  /** Tags associadas (mapeamento UI/drawer). */
  tags: TagId[];
  /** Loops onde este equipamento participa. */
  loops?: LoopId[];
}

export interface EquipmentNode {
  def: EquipmentDef;
  /** Grupo raiz no scene graph. */
  group: Object3D;
  /** Meshes selecionáveis pelo raycaster. */
  pickables: Object3D[];
  /** Estado dinâmico. */
  state: EquipmentState;
  /** Cor base salva (para restaurar do highlight). */
  baseColor: number;
}

// ----------- Alarmes ----------- //
export interface Alarm {
  id: string;
  loop: LoopId;
  tag: TagId;
  equipment: EquipmentId;
  message: string;
  active: boolean;
  /** Timestamp de ativação (s na sim). */
  since: number;
}

// ----------- Loops ----------- //
export interface ControlLoop {
  id: LoopId;
  description: string;
  /** Setpoint principal (quando aplicável). */
  setpoint?: number;
  /** Ganhos PI simplificados. */
  kp?: number;
  ki?: number;
  /** Estado integrador interno. */
  integral?: number;
  /** Tag de entrada (PV). */
  inputTag?: TagId;
  /** Tag de saída (MV). */
  outputTag?: TagId;
}

// ----------- Estado da simulação ----------- //
export interface SimState {
  running: boolean;
  eStop: boolean;
  oversizeReturn: boolean;
  showLabels: boolean;
  t: number;
  /** Valores atuais de todas as tags. */
  values: Record<TagId, number>;
  /** Estado por equipamento. */
  equipState: Record<EquipmentId, EquipmentState>;
  /** Alarmes ativos. */
  alarms: Alarm[];
  /** Loops com integradores etc. */
  loops: Record<LoopId, ControlLoop>;
  /** Eficiência da peneira (0..1). Dinâmica. */
  screenEff: number;
}
