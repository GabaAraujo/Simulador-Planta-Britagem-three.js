/**
 * Renderiza a UI SCADA (vanilla DOM):
 *  - Status por equipamento (badges RUN/STOP/ALARM)
 *  - Cards de tag (PV/MV) com valores ao vivo
 *  - Lista de alarmes
 *  - Botões (Start/Stop/Reset/Toggle/EStop)
 *  - Drawer detalhado de equipamento
 */

import type { EquipmentId, SimState, TagId, EquipmentState, LoopId, FaultId } from "./types";
import { EQUIPMENTS, TAG_BY_ID, FAULTS } from "./config";
import {
  start,
  stop,
  eStop,
  clearEStop,
  resetSim,
  ackAlarm,
  ackAllAlarms,
  toggleFault,
  clearAllFaults,
} from "./sim";
import { createTrendStore } from "./trends";
import {
  CAUSES,
  EFFECTS,
  CnE,
  evalCauses,
  evalActingEffects,
  type CauseId,
  type EffectId,
} from "./causeEffect";

// ------------------------------------------------------------------ //
// Tipos / handlers
// ------------------------------------------------------------------ //
export interface UIHandlers {
  onToggleReturn(): void;
  onToggleLabels(): void;
  onToggleView(): void;
  onFit(): void;
  onOpenEquipment(id: EquipmentId): void;
  onCloseDrawer(): void;
}

export interface UI {
  /** Atualiza valores dinâmicos (chamado por tick). */
  refresh(): void;
  /** Atualiza estado dos botões toggle. */
  updateToggles(): void;
  /** Sincroniza o botão de perspectiva com o modo atual da câmera. */
  setViewMode(mode: "3d" | "iso"): void;
  /** Abre drawer para um equipamento. */
  openDrawer(id: EquipmentId): void;
  closeDrawer(): void;
}

// ------------------------------------------------------------------ //
// Knobs editáveis por equipamento (setpoint de malha ou MV) — só p/ teste.
// ------------------------------------------------------------------ //
interface KnobDef {
  label: string;
  kind: "loopSetpoint" | "tagValue";
  key: LoopId | TagId;
  min: number;
  max: number;
  step: number;
  unit: string;
}

const KNOBS: Partial<Record<EquipmentId, KnobDef>> = {
  SILO: { label: "SP Nível (LIC-101)", kind: "loopSetpoint", key: "LIC-101", min: 2, max: 9, step: 0.1, unit: "m" },
  CONV: { label: "SP Vazão (FIC-105)", kind: "loopSetpoint", key: "FIC-105", min: 100, max: 320, step: 5, unit: "t/h" },
  CONE: { label: "Abertura CSS (CSS-106)", kind: "tagValue", key: "CSS-106", min: 6, max: 40, step: 1, unit: "mm" },
};

function readKnob(state: SimState, k: KnobDef): number {
  return k.kind === "loopSetpoint"
    ? state.loops[k.key as LoopId].setpoint ?? 0
    : state.values[k.key as TagId];
}
function writeKnob(state: SimState, k: KnobDef, v: number): void {
  if (k.kind === "loopSetpoint") state.loops[k.key as LoopId].setpoint = v;
  else state.values[k.key as TagId] = v;
}

// ------------------------------------------------------------------ //
// Inicialização
// ------------------------------------------------------------------ //
export function setupUI(state: SimState, handlers: UIHandlers): UI {
  // ----------- Botões da topbar ----------- //
  const $btnStart = byId<HTMLButtonElement>("btn-start");
  const $btnStop = byId<HTMLButtonElement>("btn-stop");
  const $btnReset = byId<HTMLButtonElement>("btn-reset");
  const $btnToggleReturn = byId<HTMLButtonElement>("btn-toggle-return");
  const $btnToggleLabels = byId<HTMLButtonElement>("btn-toggle-labels");
  const $btnToggleView = byId<HTMLButtonElement>("btn-toggle-view");
  const $btnFit = byId<HTMLButtonElement>("btn-fit");
  const $btnEStop = byId<HTMLButtonElement>("btn-estop");
  const $clock = byId<HTMLDivElement>("sim-clock");

  // Histórico em memória para os sparklines do drawer (~30 s @ 10 Hz).
  const trends = createTrendStore(Object.keys(TAG_BY_ID) as TagId[], 300);

  $btnStart.addEventListener("click", () => {
    if (state.eStop) clearEStop(state);
    start(state);
    flashEStopButton();
  });
  $btnStop.addEventListener("click", () => stop(state));
  $btnReset.addEventListener("click", () => resetSim(state));
  $btnToggleReturn.addEventListener("click", () => {
    handlers.onToggleReturn();
    updateToggles();
  });
  $btnToggleLabels.addEventListener("click", () => {
    handlers.onToggleLabels();
    updateToggles();
  });
  $btnToggleView.addEventListener("click", () => handlers.onToggleView());
  $btnFit.addEventListener("click", () => handlers.onFit());

  $btnEStop.addEventListener("click", () => {
    eStop(state);
    flashEStopButton();
  });

  // ----------- Atalhos de teclado ----------- //
  window.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.repeat) return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    switch (ev.key.toLowerCase()) {
      case "v":
        handlers.onToggleView();
        break;
      case " ": // Espaço: alterna Start/Stop
        ev.preventDefault();
        if (state.running) {
          stop(state);
        } else {
          if (state.eStop) clearEStop(state);
          start(state);
        }
        flashEStopButton();
        break;
      case "r":
        resetSim(state);
        break;
      case "l":
        handlers.onToggleLabels();
        updateToggles();
        break;
      case "f":
        handlers.onFit();
        break;
      case "m":
        toggleMatrix();
        break;
      case "escape":
        if (!$ceOverlay.classList.contains("hidden")) closeMatrix();
        else closeDrawer();
        break;
    }
  });

  function flashEStopButton() {
    $btnEStop.classList.toggle("btn-danger", true);
    $btnEStop.textContent = state.eStop ? "E-STOP ATIVO (clique Start)" : "EMERGENCY STOP";
  }

  // ----------- Render inicial ----------- //
  const $equipStatus = byId<HTMLDivElement>("equip-status");
  const $tagGrid = byId<HTMLDivElement>("tag-grid");
  const $alarmList = byId<HTMLUListElement>("alarm-list");
  const $btnAckAll = byId<HTMLButtonElement>("btn-ack-all");
  const $alarmCount = byId<HTMLSpanElement>("alarm-count");
  const $faultList = byId<HTMLDivElement>("fault-list");
  const $btnClearFaults = byId<HTMLButtonElement>("btn-clear-faults");
  const $btnMatrix = byId<HTMLButtonElement>("btn-matrix");
  const $ceOverlay = byId<HTMLDivElement>("ce-overlay");
  const $ceClose = byId<HTMLButtonElement>("ce-close");
  const $ceTable = byId<HTMLTableElement>("ce-table");

  // Reconhecer todos os alarmes.
  $btnAckAll.addEventListener("click", () => {
    ackAllAlarms(state);
    refresh();
  });
  // ACK individual (delegação de eventos na lista).
  $alarmList.addEventListener("click", (ev) => {
    const t = ev.target as HTMLElement;
    const id = t.getAttribute("data-ack");
    if (id) {
      ackAlarm(state, id);
      refresh();
    }
  });

  renderEquipRows($equipStatus, handlers);
  renderTagCards($tagGrid, state);
  renderFaultRows($faultList);

  // Toggle de uma falha (delegação de eventos)
  $faultList.addEventListener("click", (ev) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>(".fault-row");
    if (!row) return;
    const id = row.dataset.fault as FaultId | undefined;
    if (!id) return;
    toggleFault(state, id);
    refresh();
  });
  $btnClearFaults.addEventListener("click", () => {
    clearAllFaults(state);
    refresh();
  });

  // ----------- Matriz Causa & Efeito (overlay) ----------- //
  buildCnEMatrix($ceTable);
  function openMatrix() {
    $ceOverlay.classList.remove("hidden");
    $ceOverlay.setAttribute("aria-hidden", "false");
    updateCnEMatrix($ceTable, state);
  }
  function closeMatrix() {
    $ceOverlay.classList.add("hidden");
    $ceOverlay.setAttribute("aria-hidden", "true");
  }
  function toggleMatrix() {
    if ($ceOverlay.classList.contains("hidden")) openMatrix();
    else closeMatrix();
  }
  $btnMatrix.addEventListener("click", toggleMatrix);
  $ceClose.addEventListener("click", closeMatrix);
  // Fechar clicando no backdrop (fora do .ce-modal).
  $ceOverlay.addEventListener("click", (ev) => {
    if (ev.target === $ceOverlay) closeMatrix();
  });

  // ----------- Drawer ----------- //
  const $drawer = byId<HTMLDivElement>("drawer");
  const $drawerTitle = byId<HTMLHeadingElement>("drawer-title");
  const $drawerBody = byId<HTMLDivElement>("drawer-body");
  const $drawerClose = byId<HTMLButtonElement>("drawer-close");
  $drawerClose.addEventListener("click", closeDrawer);

  let currentDrawerId: EquipmentId | null = null;

  function openDrawer(id: EquipmentId) {
    const def = EQUIPMENTS.find((e) => e.id === id);
    if (!def) return;
    currentDrawerId = id;
    $drawerTitle.textContent = def.label;
    // Estrutura construída UMA vez (evita recriar sliders/canvas a cada refresh).
    $drawerBody.innerHTML = buildDrawerStatic(id, state);

    // Liga o slider (knob) deste equipamento, se houver.
    const knob = KNOBS[id];
    if (knob) {
      const input = $drawerBody.querySelector<HTMLInputElement>("#drawer-knob");
      const out = $drawerBody.querySelector<HTMLElement>("#drawer-knob-val");
      input?.addEventListener("input", () => {
        const v = parseFloat(input.value);
        writeKnob(state, knob, v);
        if (out) out.textContent = `${formatVal(v)} ${knob.unit}`;
      });
    }

    updateDrawerDynamic($drawerBody, id, state, trends);
    $drawer.classList.remove("hidden");
    $drawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    if (currentDrawerId === null) return;
    currentDrawerId = null;
    $drawer.classList.add("hidden");
    $drawer.setAttribute("aria-hidden", "true");
    handlers.onCloseDrawer();
  }

  function setViewMode(mode: "3d" | "iso") {
    // O rótulo mostra o modo de DESTINO (clicar leva até ele).
    $btnToggleView.textContent = mode === "3d" ? "ISO" : "3D";
    $btnToggleView.classList.toggle("is-active", mode === "iso");
  }

  function updateToggles() {
    $btnToggleReturn.textContent = `Oversize Return: ${state.oversizeReturn ? "ON" : "OFF"}`;
    $btnToggleReturn.classList.toggle("btn-ok", state.oversizeReturn);
    $btnToggleLabels.textContent = `Labels: ${state.showLabels ? "ON" : "OFF"}`;
    $btnToggleLabels.classList.toggle("btn-ok", state.showLabels);
    $btnEStop.textContent = state.eStop ? "E-STOP ATIVO (clique Start)" : "EMERGENCY STOP";
  }

  // ----------- Refresh dinâmico ----------- //
  function refresh() {
    // Clock
    $clock.textContent = `t = ${state.t.toFixed(1)}s ${state.running ? "▶" : state.eStop ? "⛔" : "⏸"}`;

    // Equipamentos (atualizar badges)
    for (const def of EQUIPMENTS) {
      const badge = document.getElementById(`equip-badge-${def.id}`);
      if (badge) {
        const st: EquipmentState = state.equipState[def.id];
        badge.className = `badge ${st}`;
        badge.textContent = st;
      }
    }

    // Tags
    for (const id of Object.keys(TAG_BY_ID) as TagId[]) {
      const card = document.getElementById(`tag-${id}`);
      if (!card) continue;
      const tag = TAG_BY_ID[id];
      const val = state.values[id];
      const valEl = card.querySelector(".val") as HTMLElement | null;
      if (valEl) valEl.firstChild!.textContent = formatVal(val);
      if (tag.hi !== undefined) {
        card.classList.toggle("high", val > tag.hi);
      }
    }

    // Alarmes (com ciclo de vida ACK)
    const unacked = state.alarms.filter((a) => !a.acknowledged).length;
    $alarmCount.textContent = state.alarms.length ? String(state.alarms.length) : "";
    $btnAckAll.disabled = unacked === 0;
    if (state.alarms.length === 0) {
      $alarmList.innerHTML = `<li class="muted">Nenhum alarme ativo.</li>`;
    } else {
      $alarmList.innerHTML = state.alarms
        .map((a) => {
          const cls = a.active ? (a.acknowledged ? "ackd" : "unack") : "rtn";
          const label = a.active ? (a.acknowledged ? "ACK" : "ALM") : "RTN";
          const ackBtn = a.acknowledged ? "" : `<button class="btn btn-ack" data-ack="${a.id}">ACK</button>`;
          return `<li class="alarm ${cls}">
            <span class="alm-state">${label}</span>
            <span class="alm-text">[${a.loop}] ${a.message} <span class="muted">(${a.equipment} · t=${a.since.toFixed(1)}s)</span></span>
            ${ackBtn}
          </li>`;
        })
        .join("");
    }

    // Drawer aberto: atualizar apenas valores + trends (sem reconstruir DOM)
    if (currentDrawerId) updateDrawerDynamic($drawerBody, currentDrawerId, state, trends);

    // Falhas: marcar linha ativa + habilitar/desabilitar "Limpar"
    let activeFaults = 0;
    for (const f of FAULTS) {
      const row = document.getElementById(`fault-${f.id}`);
      const isOn = state.faults[f.id];
      if (row) row.classList.toggle("active", isOn);
      if (isOn) activeFaults++;
    }
    $btnClearFaults.disabled = activeFaults === 0;

    // Matriz C&E: só atualiza quando visível
    if (!$ceOverlay.classList.contains("hidden")) updateCnEMatrix($ceTable, state);

    // Indicador no botão da matriz (quantas causas ativas existem)
    const activeCauseCount = Object.values(evalCauses(state)).filter(Boolean).length;
    $btnMatrix.classList.toggle("is-alarm", activeCauseCount > 0);
    $btnMatrix.textContent = activeCauseCount > 0 ? `C&E (${activeCauseCount})` : "C&E";

    // Alimenta o histórico (sparklines)
    trends.push(state.values);
  }

  // primeiro paint
  updateToggles();
  setViewMode("3d");
  refresh();

  return { refresh, updateToggles, setViewMode, openDrawer, closeDrawer };
}

// ------------------------------------------------------------------ //
// Helpers DOM
// ------------------------------------------------------------------ //
function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Elemento #${id} não encontrado no DOM.`);
  return el as T;
}

function formatVal(v: number): string {
  if (Math.abs(v) >= 100) return v.toFixed(0);
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function renderEquipRows(container: HTMLElement, handlers: UIHandlers): void {
  container.innerHTML = "";
  for (const def of EQUIPMENTS) {
    if (def.id === "RETURN") continue; // não listamos o virtual
    const row = document.createElement("div");
    row.className = "equip-row";
    row.innerHTML = `
      <span class="name">${def.displayName} <span class="muted">— ${def.label}</span></span>
      <span id="equip-badge-${def.id}" class="badge STOP">STOP</span>
    `;
    row.addEventListener("click", () => handlers.onOpenEquipment(def.id));
    container.appendChild(row);
  }
}

// ------------------------------------------------------------------ //
// Matriz Causa & Efeito (construção e atualização)
// ------------------------------------------------------------------ //
function buildCnEMatrix(table: HTMLTableElement): void {
  // Cabeçalho: 1ª coluna vazia + 1 col por efeito
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = document.createElement("th");
  corner.textContent = "Causa \\ Efeito";
  corner.className = "corner";
  headRow.appendChild(corner);
  for (const e of EFFECTS) {
    const th = document.createElement("th");
    th.className = "eff";
    th.dataset.effect = e.id;
    th.title = e.description;
    th.innerHTML = `<span>${e.label}</span>`;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  // Corpo: 1 linha por causa
  const tbody = document.createElement("tbody");
  for (const c of CAUSES) {
    const tr = document.createElement("tr");
    tr.dataset.cause = c.id;
    const th = document.createElement("th");
    th.className = "cause";
    th.title = c.description;
    th.innerHTML = `${c.label} <span class="cause-id">${c.id} · ${c.equipment}</span>`;
    tr.appendChild(th);
    const marked = new Set(CnE[c.id]);
    for (const e of EFFECTS) {
      const td = document.createElement("td");
      td.dataset.effect = e.id;
      if (marked.has(e.id)) {
        td.className = "cell-x";
        td.textContent = "X";
      } else {
        td.textContent = "";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }

  table.innerHTML = "";
  table.appendChild(thead);
  table.appendChild(tbody);
}

function updateCnEMatrix(table: HTMLTableElement, state: SimState): void {
  const causes = evalCauses(state);
  const acting = evalActingEffects(state);

  // Linhas
  for (const row of Array.from(table.tBodies[0]?.rows ?? [])) {
    const id = row.dataset.cause as CauseId | undefined;
    if (!id) continue;
    row.classList.toggle("cause-active", causes[id]);
  }
  // Colunas (cabeçalho de efeitos)
  const headerCells = table.tHead?.rows[0]?.cells ?? [];
  for (let i = 1; i < headerCells.length; i++) {
    const th = headerCells[i];
    const id = th.dataset.effect as EffectId | undefined;
    if (!id) continue;
    th.classList.toggle("acting", acting.has(id));
  }
}

function renderFaultRows(container: HTMLElement): void {
  container.innerHTML = "";
  for (const f of FAULTS) {
    const row = document.createElement("div");
    row.className = "fault-row";
    row.id = `fault-${f.id}`;
    row.dataset.fault = f.id;
    row.title = f.description;
    row.innerHTML = `
      <div class="fault-info">
        <div class="fault-label">
          <span class="fault-equip">${f.equipment}</span>
          <span>${f.label}</span>
        </div>
        <div class="fault-desc">${f.description}</div>
      </div>
      <span class="toggle" aria-label="ativar falha"></span>
    `;
    container.appendChild(row);
  }
}

function renderTagCards(container: HTMLElement, state: SimState): void {
  container.innerHTML = "";
  for (const id of Object.keys(TAG_BY_ID) as TagId[]) {
    const tag = TAG_BY_ID[id];
    const card = document.createElement("div");
    card.className = `tag-card ${tag.kind}`;
    card.id = `tag-${id}`;
    card.innerHTML = `
      <div class="id">${id} · <span class="muted">${tag.kind}</span></div>
      <div class="val">${formatVal(state.values[id])}<span class="unit"> ${tag.unit}</span></div>
    `;
    container.appendChild(card);
  }
}

/** Estrutura estática do drawer (criada uma vez por abertura). */
function buildDrawerStatic(id: EquipmentId, state: SimState): string {
  const def = EQUIPMENTS.find((e) => e.id === id);
  if (!def) return "";

  const tagsHtml = def.tags
    .map((tid) => {
      const tag = TAG_BY_ID[tid];
      return `<div class="kv">
          <span class="k">${tid} <span class="muted">(${tag.kind})</span> — ${tag.desc}</span>
          <span class="v" id="dval-${tid}">—</span>
        </div>
        <canvas class="spark" id="spark-${tid}" width="240" height="34"></canvas>`;
    })
    .join("");

  const loopsHtml = (def.loops ?? [])
    .map((lid) => {
      const l = state.loops[lid];
      const extra = l.setpoint !== undefined ? ` <span class="muted">SP=${l.setpoint}</span>` : "";
      return `<div class="kv"><span class="k">${lid}${extra}</span><span class="v">${l.description}</span></div>`;
    })
    .join("");

  // Knob (slider) editável, se este equipamento tiver
  const knob = KNOBS[id];
  let knobHtml = "";
  if (knob) {
    const cur = readKnob(state, knob);
    knobHtml = `
      <div class="section">
        <h4>Ajuste (teste)</h4>
        <div class="knob">
          <label class="k">${knob.label}</label>
          <input type="range" id="drawer-knob" min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${cur}" />
          <span class="v" id="drawer-knob-val">${formatVal(cur)} ${knob.unit}</span>
        </div>
      </div>`;
  }

  return `
    <div class="section">
      <h4>Estado</h4>
      <div class="kv"><span class="k">Status</span><span class="v"><span id="drawer-badge" class="badge STOP">STOP</span></span></div>
    </div>
    <div class="section">
      <h4>Tags & Tendência</h4>
      ${tagsHtml || `<div class="muted" style="font-size:11px;">Sem tags associadas.</div>`}
    </div>
    ${knobHtml}
    <div class="section">
      <h4>Malhas</h4>
      ${loopsHtml || `<div class="muted" style="font-size:11px;">Sem malhas associadas.</div>`}
    </div>
    <div class="section">
      <h4>Alarmes</h4>
      <div id="drawer-alarms"></div>
    </div>
  `;
}

/** Atualiza só os valores/badge/alarmes/sparklines (sem recriar DOM). */
function updateDrawerDynamic(
  container: HTMLElement,
  id: EquipmentId,
  state: SimState,
  trends: ReturnType<typeof createTrendStore>,
): void {
  const def = EQUIPMENTS.find((e) => e.id === id);
  if (!def) return;

  // badge de estado
  const badge = container.querySelector("#drawer-badge");
  if (badge) {
    const st = state.equipState[id];
    badge.className = `badge ${st}`;
    badge.textContent = st;
  }

  // valores + sparklines
  for (const tid of def.tags) {
    const tag = TAG_BY_ID[tid];
    const v = state.values[tid];
    const valEl = container.querySelector<HTMLElement>(`#dval-${tid}`);
    if (valEl) {
      const isHi = tag.hi !== undefined && v > tag.hi;
      valEl.textContent = `${formatVal(v)} ${tag.unit}`;
      valEl.style.color = isHi ? "var(--alarm)" : "var(--text)";
    }
    const canvas = container.querySelector<HTMLCanvasElement>(`#spark-${tid}`);
    if (canvas) trends.draw(canvas, tid);
  }

  // alarmes do equipamento
  const box = container.querySelector("#drawer-alarms");
  if (box) {
    const mine = state.alarms.filter((a) => a.equipment === id);
    box.innerHTML =
      mine.length === 0
        ? `<div class="muted" style="font-size:11px;">Sem alarmes ativos.</div>`
        : mine
            .map(
              (a) =>
                `<div class="kv"><span class="k" style="color:var(--alarm)">[${a.loop}] ${a.message}</span><span class="v">${a.active ? (a.acknowledged ? "ACK" : "ALM") : "RTN"}</span></div>`,
            )
            .join("");
  }
}
