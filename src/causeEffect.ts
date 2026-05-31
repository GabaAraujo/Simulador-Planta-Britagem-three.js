/**
 * Matriz Causa & Efeito (estilo ISA-84 simplificado).
 *
 * - Causas: condições anormais (alarmes / E-STOP / nível baixo).
 * - Efeitos: ações de intertravamento que DEVERIAM atuar quando a causa está ativa.
 * - Matriz: para cada causa, lista os efeitos marcados (relação "X").
 *
 * MODO 1 (atual): apenas visualização. A matriz informa o operador, mas NÃO
 * altera a simulação. As ações já existentes (override CIC-103, oversizeReturn,
 * E-STOP) continuam sendo as únicas que efetivamente atuam.
 *
 * MODO 2 (futuro): aplicar `evalActingEffects()` no `stepSim` para que as
 * células marcadas se transformem em intertravamentos reais.
 */

import type { SimState, EquipmentId } from "./types";

export type CauseId = "VAH-104" | "IAH-103" | "IAH-106" | "LAL-101" | "ESTOP";
export type EffectId =
  | "RED_FV"
  | "STOP_FEEDER"
  | "STOP_JAW"
  | "STOP_CONE"
  | "BLOCK_RETURN"
  | "ANNUNCIATE";

export interface CauseDef {
  id: CauseId;
  label: string;
  description: string;
  equipment: EquipmentId | "PLANT";
}

export interface EffectDef {
  id: EffectId;
  label: string;
  description: string;
}

// ----------- Causas (linhas) ----------- //
export const CAUSES: CauseDef[] = [
  { id: "VAH-104", label: "Vibração Alta JAW",  description: "VT-104 > 10 mm/s",      equipment: "JAW" },
  { id: "IAH-103", label: "Corrente Alta JAW",  description: "CT-103 > 160 A",        equipment: "JAW" },
  { id: "IAH-106", label: "Corrente Alta CONE", description: "CT-106 > 170 A",        equipment: "CONE" },
  { id: "LAL-101", label: "Nível Baixo SILO",   description: "LT-101 < 1.5 m",        equipment: "SILO" },
  { id: "ESTOP",   label: "E-STOP Acionado",    description: "Parada de emergência",  equipment: "PLANT" },
];

// ----------- Efeitos (colunas) ----------- //
export const EFFECTS: EffectDef[] = [
  { id: "RED_FV",       label: "Reduzir FV-102",     description: "Override no alimentador (vazão)" },
  { id: "STOP_FEEDER",  label: "Parar Feeder",       description: "Bloqueia o alimentador" },
  { id: "STOP_JAW",     label: "Parar JAW",          description: "Bloqueia o britador de mandíbulas" },
  { id: "STOP_CONE",    label: "Parar CONE",         description: "Bloqueia o britador cônico" },
  { id: "BLOCK_RETURN", label: "Bloquear Retorno",   description: "Inibe retorno do oversize" },
  { id: "ANNUNCIATE",   label: "Sinalizar Alarme",   description: "Notifica o operador" },
];

// ----------- Matriz (causa → efeitos marcados) ----------- //
export const CnE: Record<CauseId, EffectId[]> = {
  "VAH-104": ["RED_FV", "STOP_FEEDER", "STOP_JAW", "ANNUNCIATE"],
  "IAH-103": ["RED_FV", "ANNUNCIATE"],
  "IAH-106": ["STOP_CONE", "BLOCK_RETURN", "ANNUNCIATE"],
  "LAL-101": ["RED_FV", "STOP_FEEDER", "ANNUNCIATE"],
  "ESTOP":   ["RED_FV", "STOP_FEEDER", "STOP_JAW", "STOP_CONE", "BLOCK_RETURN", "ANNUNCIATE"],
};

// ----------- Avaliação em tempo real ----------- //
/** Quais causas estão presentes (condição ativa) agora. */
export function evalCauses(s: SimState): Record<CauseId, boolean> {
  const isActive = (id: string) => s.alarms.some((a) => a.id === id && a.active);
  return {
    "VAH-104": isActive("VAH-104:JAW"),
    "IAH-103": isActive("IAH-103:JAW"),
    "IAH-106": isActive("IAH-106:CONE"),
    "LAL-101": s.values["LT-101"] < 1.5,
    ESTOP: s.eStop,
  };
}

/** Conjunto de efeitos que estariam atuando agora (união das causas ativas). */
export function evalActingEffects(s: SimState): Set<EffectId> {
  const acting = new Set<EffectId>();
  const causes = evalCauses(s);
  for (const c of CAUSES) {
    if (!causes[c.id]) continue;
    for (const eff of CnE[c.id]) acting.add(eff);
  }
  return acting;
}
