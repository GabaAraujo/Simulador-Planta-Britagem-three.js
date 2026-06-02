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

export type LoopId = "LIC-101" | "CIC-103" | "FIC-105" | "VAH-104" | "IAH-106";

// ----------- Falhas (injeção manual para testar SCADA) ----------- //
export type FaultId =
  | "JAW_BEARING"     // desgaste de mancal → eleva vibração no JAW
  | "JAW_OVERLOAD"    // sobrecarga no JAW → eleva corrente no JAW
  | "SCREEN_BLIND"    // peneira cega → eficiência cai, mais oversize
  | "CONE_JAM"        // britador cônico travado → eleva corrente no CONE
  | "SILO_LOW";       // falha de alimentação → silo drena

// ----------- Ações de mitigação (operador atua via HMI) ----------- //
export type MitigationActionId =
  | "M_LUBE"           // lubrificação e troca de mancal do JAW
  | "M_SOFT_RESTART"   // soft restart do motor do JAW
  | "M_SCREEN_CLEAN"   // limpeza das telas da peneira
  | "M_TRAMP_RELEASE"  // tramp release hidráulico do cone
  | "M_REFILL";        // solicitar carregamento do silo

/** Definição estática de uma ação de mitigação (catálogo). */
export interface MitigationDef {
  id: MitigationActionId;
  /** Falha que esta ação resolve. */
  faultId: FaultId;
  /** Equipamento alvo (para etiqueta visual). */
  equipment: EquipmentId;
  /** Nome curto exibido no botão. */
  label: string;
  /** Descrição detalhada (mostrada em tooltip / drawer). */
  description: string;
  /** Duração da ação em segundos da simulação. */
  durationS: number;
}

/** Instância em andamento de uma mitigação. */
export interface RunningMitigation {
  id: MitigationActionId;
  faultId: FaultId;
  /** Tempo da simulação (s) em que a ação foi iniciada. */
  startedAt: number;
  /** Duração total prevista (s) — cópia da MitigationDef. */
  durationS: number;
}

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
  /** Condição de alarme está presente agora. */
  active: boolean;
  /** Operador reconheceu (ACK). */
  acknowledged: boolean;
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
  /** Falhas ativas injetadas pelo operador (para teste). */
  faults: Record<FaultId, boolean>;
  /** Ações de mitigação em andamento (operador executando). */
  runningMitigations: RunningMitigation[];
}
