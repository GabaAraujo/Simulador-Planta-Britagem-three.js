/**
 * Simulação simplificada do processo + malhas PI/P.
 *
 * Dinâmica (de alto nível):
 *  - LT-101 sobe quando a alimentação ao silo > descarga, e cai com a descarga (FV).
 *  - FV-102 (MV) é manipulado pelos loops (LIC, CIC override, FIC).
 *  - ST-102 ≈ função(FV-102) com filtro de 1ª ordem.
 *  - WT-105 (vazão mássica) ≈ taxa de descarga do FEEDER convertida via FEED_PER_HZ.
 *  - CT-103 (corrente JAW) cresce com WT-105 (+ ruído).
 *  - VT-104 (vibração) cresce com CT-103 e com "entupimento" simulado quando vazão alta.
 *  - FT-106 = WT-105 * TPH_TO_M3H.
 *  - SCREEN separa: undersize = FT*eff (produto); oversize = FT*(1-eff) (retorno se ativo).
 *  - CONE: corrente ~ função(oversize, CSS-106). CSS menor → mais carga.
 *  - Realimentação: oversize devolve `CONE_REINSERT*oversize` no balanço de WT-105.
 *
 * Os controladores são simples — não pretendem ser uma planta real, e sim demonstrar
 * malhas SCADA típicas (LIC, CIC, FIC, VAH).
 */

import type {
  SimState,
  EquipmentId,
  EquipmentState,
  TagId,
  Alarm,
  ControlLoop,
} from "./types";
import { TAGS, LOOPS, SETPOINTS, SIM } from "./config";

// ------------------------------------------------------------------ //
// Estado inicial
// ------------------------------------------------------------------ //
export function createInitialState(): SimState {
  const values = {} as Record<TagId, number>;
  for (const t of TAGS) values[t.id] = t.initial;

  const equipState: Record<EquipmentId, EquipmentState> = {
    SILO: "STOP",
    FEEDER: "STOP",
    JAW: "STOP",
    CONV: "STOP",
    SCREEN: "STOP",
    CONE: "STOP",
    RETURN: "STOP",
  };

  // clonar os loops (para não mutar config)
  const loops: Record<string, ControlLoop> = {};
  for (const k of Object.keys(LOOPS) as Array<keyof typeof LOOPS>) {
    loops[k] = { ...LOOPS[k], integral: 0 };
  }

  return {
    running: false,
    eStop: false,
    oversizeReturn: true,
    showLabels: true,
    t: 0,
    values,
    equipState,
    alarms: [],
    loops: loops as SimState["loops"],
    screenEff: SIM.EFF_BASE,
  };
}

// ------------------------------------------------------------------ //
// Utilitários
// ------------------------------------------------------------------ //
function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Filtro de 1ª ordem: y' = y + (target - y) * (dt/tau). */
function lp(y: number, target: number, dt: number, tau: number): number {
  if (tau <= 0) return target;
  const a = Math.min(1, dt / tau);
  return y + (target - y) * a;
}

function pickRunningState(active: boolean, alarm: boolean): EquipmentState {
  if (alarm) return "ALARM";
  return active ? "RUN" : "STOP";
}

// ------------------------------------------------------------------ //
// Controladores
// ------------------------------------------------------------------ //
/** PI simples; retorna delta para acumular no MV. */
function piStep(loop: ControlLoop, pv: number, dt: number): number {
  const sp = loop.setpoint ?? 0;
  const err = sp - pv;
  const kp = loop.kp ?? 0;
  const ki = loop.ki ?? 0;
  loop.integral = (loop.integral ?? 0) + err * dt;
  // anti-windup grosseiro
  loop.integral = clamp(loop.integral, -200, 200);
  return kp * err + ki * loop.integral;
}

// ------------------------------------------------------------------ //
// Reset
// ------------------------------------------------------------------ //
export function resetSim(s: SimState): void {
  const fresh = createInitialState();
  s.t = 0;
  s.values = fresh.values;
  s.equipState = fresh.equipState;
  s.alarms = [];
  s.loops = fresh.loops;
  s.screenEff = fresh.screenEff;
  s.eStop = false;
  // mantém running, oversizeReturn, showLabels conforme estavam
}

// ------------------------------------------------------------------ //
// Tick principal
// ------------------------------------------------------------------ //
export function stepSim(s: SimState, dt: number): void {
  if (!s.running || s.eStop) {
    // Mesmo parado, deixar o nível drenar lentamente seria estranho — mantemos congelado.
    return;
  }
  s.t += dt;
  const v = s.values;

  // ----------- Controladores ----------- //
  // LIC-101 (manter nível). Se nível alto → aumenta descarga (FV).
  // Aqui invertemos o sinal: erro = SP - PV; se SP > PV (silo baixo), deveria reduzir descarga.
  // Mas no contexto, "manter nível" significa modular a descarga; vamos manter intuitivo:
  //   se PV > SP (silo cheio), aumenta FV; se PV < SP, reduz FV.
  const licErr = v["LT-101"] - (s.loops["LIC-101"].setpoint ?? 6);
  s.loops["LIC-101"].integral = (s.loops["LIC-101"].integral ?? 0) + licErr * dt;
  s.loops["LIC-101"].integral = clamp(s.loops["LIC-101"].integral, -50, 50);
  const licMV =
    (s.loops["LIC-101"].kp ?? 0) * licErr +
    (s.loops["LIC-101"].ki ?? 0) * (s.loops["LIC-101"].integral ?? 0);

  // FIC-105 (manter WT setpoint). Aumenta FV se vazão abaixo do alvo.
  const ficDelta = piStep(s.loops["FIC-105"], v["WT-105"], dt);

  // Combine LIC + FIC com pesos
  let fvTarget = 30 + licMV + ficDelta;

  // CIC-103 override: se corrente JAW excede limite, força redução de FV
  if (v["CT-103"] > (s.loops["CIC-103"].setpoint ?? SETPOINTS.JAW_I_MAX)) {
    const overCurrent = v["CT-103"] - (s.loops["CIC-103"].setpoint ?? SETPOINTS.JAW_I_MAX);
    fvTarget -= (s.loops["CIC-103"].kp ?? 0.35) * overCurrent * 2;
  }

  // Saturar e suavizar FV-102
  fvTarget = clamp(fvTarget, 0, 60);
  v["FV-102"] = lp(v["FV-102"], fvTarget, dt, 1.2);

  // ----------- Dinâmica de processo ----------- //
  // ST-102 ≈ FV * 16 (rpm), com lag
  v["ST-102"] = lp(v["ST-102"], v["FV-102"] * 16, dt, 1.5);

  // Vazão alvo do feeder (t/h) ~ FV * FEED_PER_HZ; limitada pelo nível do silo
  const noiseFlow = (Math.sin(s.t * 1.7) + Math.sin(s.t * 0.6)) * 1.2;
  const siloFactor = clamp(v["LT-101"] / 0.5, 0, 1); // silo vazio → vazão cai
  const feedTph = v["FV-102"] * SIM.FEED_PER_HZ * siloFactor + noiseFlow * siloFactor;

  // Balanço do silo: enchimento "contínuo" suposto (ex.: caminhão / alimentação externa)
  // Para deixar o setpoint atingível, fornecemos refill proporcional ao consumo médio.
  const refillRate = 0.05; // m / s (taxa de reposição artificial)
  const drainRate = feedTph / 800; // converte t/h em m/s de queda no nível (escala fictícia)
  v["LT-101"] = clamp(v["LT-101"] + (refillRate - drainRate) * dt, 0, SIM.SILO_CAPACITY_M);

  // Velocidade da correia (varia pouco)
  v["ST-105"] = lp(v["ST-105"], 2.5 + Math.sin(s.t * 0.2) * 0.1, dt, 4);

  // Recirculação: na iteração anterior, o oversize que voltou contribui aqui
  const oversizePrev = (v["FT-106"] / Math.max(0.01, SIM.TPH_TO_M3H)) * (1 - s.screenEff);
  const recirc = s.oversizeReturn ? oversizePrev * SIM.CONE_REINSERT : 0;

  // Vazão mássica na correia (t/h) — soma alimentação fresca + retorno
  const wtTarget = feedTph + recirc;
  v["WT-105"] = lp(v["WT-105"], wtTarget, dt, 2.5);

  // Pressão hidráulica jaw (varia com vazão e ruído)
  v["PT-103"] = lp(v["PT-103"], 60 + v["WT-105"] * 0.35 + Math.sin(s.t * 1.1) * 4, dt, 2);

  // Corrente JAW (A) — proporcional à vazão e c/ ruído
  const ctTarget = SIM.CT_OFFSET + v["WT-105"] * SIM.K_CT_FROM_FLOW + Math.sin(s.t * 0.8) * 3;
  v["CT-103"] = lp(v["CT-103"], ctTarget, dt, 1.8);

  // Vibração JAW — sobe se CT alto; "entupimento" se WT muito alto
  const overload = Math.max(0, v["CT-103"] - SETPOINTS.JAW_I_MAX) * 0.12;
  const choke = Math.max(0, v["WT-105"] - 320) * 0.06;
  const vibTarget = 1.2 + v["CT-103"] * SIM.K_VIB * 0.4 + overload + choke + Math.sin(s.t * 2.3) * 0.4;
  v["VT-104"] = lp(v["VT-104"], vibTarget, dt, 1.2);

  // Vazão volumétrica para peneira
  v["FT-106"] = lp(v["FT-106"], v["WT-105"] * SIM.TPH_TO_M3H, dt, 1.5);

  // Eficiência peneira: cai um pouco com vazão alta
  s.screenEff = clamp(
    SIM.EFF_BASE - Math.max(0, v["FT-106"] - 120) * 0.0015,
    0.45,
    0.92,
  );

  // CONE: corrente e pressão dependem do oversize que chega + CSS
  const oversize_tph = (v["WT-105"]) * (1 - s.screenEff);
  const css = v["CSS-106"];
  const cssFactor = clamp(40 / Math.max(6, css), 0.5, 3.0); // CSS pequeno → factor alto
  const coneCurrentTarget = 25 + oversize_tph * 0.35 * SIM.K_CONE_CSS * cssFactor;
  v["CT-106"] = lp(v["CT-106"], coneCurrentTarget, dt, 2);
  v["PT-106"] = lp(v["PT-106"], 55 + oversize_tph * 0.4 + cssFactor * 6, dt, 2);

  // ----------- Estados / Alarmes ----------- //
  // Alarme alta vibração (VAH-104)
  const vibAlarm = v["VT-104"] > SETPOINTS.VIB_HI;
  setAlarm(s, {
    id: "VAH-104:JAW",
    loop: "VAH-104",
    tag: "VT-104",
    equipment: "JAW",
    message: `Alta vibração no JAW: ${v["VT-104"].toFixed(2)} mm/s (limite ${SETPOINTS.VIB_HI})`,
    active: vibAlarm,
    since: vibAlarm ? s.t : 0,
  });

  // Estados de equipamentos
  s.equipState.SILO   = pickRunningState(v["LT-101"] > 0.1, false);
  s.equipState.FEEDER = pickRunningState(v["FV-102"] > 1, false);
  s.equipState.JAW    = pickRunningState(v["CT-103"] > SIM.CT_OFFSET + 1, vibAlarm);
  s.equipState.CONV   = pickRunningState(v["WT-105"] > 1, false);
  s.equipState.SCREEN = pickRunningState(v["FT-106"] > 1, false);
  s.equipState.CONE   = pickRunningState(s.oversizeReturn && oversize_tph > 1, false);
  s.equipState.RETURN = pickRunningState(s.oversizeReturn && oversize_tph > 1, false);
}

// ------------------------------------------------------------------ //
// Alarmes (manutenção da lista)
// ------------------------------------------------------------------ //
function setAlarm(s: SimState, candidate: Alarm): void {
  const existing = s.alarms.find((a) => a.id === candidate.id);
  if (candidate.active) {
    if (existing) {
      existing.message = candidate.message;
      existing.active = true;
    } else {
      s.alarms.push({ ...candidate });
    }
  } else if (existing) {
    s.alarms = s.alarms.filter((a) => a.id !== candidate.id);
  }
}

// ------------------------------------------------------------------ //
// Controle externo (botões)
// ------------------------------------------------------------------ //
export function start(s: SimState): void {
  if (s.eStop) return;
  s.running = true;
}
export function stop(s: SimState): void {
  s.running = false;
}
export function eStop(s: SimState): void {
  s.eStop = true;
  s.running = false;
  // zera vazões instantaneamente
  s.values["FV-102"] = 0;
  s.values["WT-105"] = 0;
  s.values["FT-106"] = 0;
  s.values["ST-102"] = 0;
  s.values["ST-105"] = 0;
  for (const id of Object.keys(s.equipState) as EquipmentId[]) {
    s.equipState[id] = "STOP";
  }
}
export function clearEStop(s: SimState): void {
  s.eStop = false;
}
