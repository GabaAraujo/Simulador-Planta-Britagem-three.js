/**
 * Renderiza a UI SCADA (vanilla DOM):
 *  - Status por equipamento (badges RUN/STOP/ALARM)
 *  - Cards de tag (PV/MV) com valores ao vivo
 *  - Lista de alarmes
 *  - Botões (Start/Stop/Reset/Toggle/EStop)
 *  - Drawer detalhado de equipamento
 */

import type { EquipmentId, SimState, TagId, EquipmentState } from "./types";
import { EQUIPMENTS, TAG_BY_ID } from "./config";
import { start, stop, eStop, clearEStop, resetSim } from "./sim";

// ------------------------------------------------------------------ //
// Tipos / handlers
// ------------------------------------------------------------------ //
export interface UIHandlers {
  onToggleReturn(): void;
  onToggleLabels(): void;
  onOpenEquipment(id: EquipmentId): void;
}

export interface UI {
  /** Atualiza valores dinâmicos (chamado por tick). */
  refresh(): void;
  /** Atualiza estado dos botões toggle. */
  updateToggles(): void;
  /** Abre drawer para um equipamento. */
  openDrawer(id: EquipmentId): void;
  closeDrawer(): void;
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
  const $btnEStop = byId<HTMLButtonElement>("btn-estop");
  const $clock = byId<HTMLDivElement>("sim-clock");

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
  $btnEStop.addEventListener("click", () => {
    eStop(state);
    flashEStopButton();
  });

  function flashEStopButton() {
    $btnEStop.classList.toggle("btn-danger", true);
    $btnEStop.textContent = state.eStop ? "E-STOP ATIVO (clique Start)" : "EMERGENCY STOP";
  }

  // ----------- Render inicial ----------- //
  const $equipStatus = byId<HTMLDivElement>("equip-status");
  const $tagGrid = byId<HTMLDivElement>("tag-grid");
  const $alarmList = byId<HTMLUListElement>("alarm-list");

  renderEquipRows($equipStatus, handlers);
  renderTagCards($tagGrid, state);

  // ----------- Drawer ----------- //
  const $drawer = byId<HTMLDivElement>("drawer");
  const $drawerTitle = byId<HTMLHeadingElement>("drawer-title");
  const $drawerBody = byId<HTMLDivElement>("drawer-body");
  const $drawerClose = byId<HTMLButtonElement>("drawer-close");
  $drawerClose.addEventListener("click", closeDrawer);

  let currentDrawerId: EquipmentId | null = null;

  function openDrawer(id: EquipmentId) {
    currentDrawerId = id;
    const def = EQUIPMENTS.find((e) => e.id === id);
    if (!def) return;
    $drawerTitle.textContent = def.label;
    renderDrawerBody($drawerBody, id, state);
    $drawer.classList.remove("hidden");
    $drawer.setAttribute("aria-hidden", "false");
  }

  function closeDrawer() {
    currentDrawerId = null;
    $drawer.classList.add("hidden");
    $drawer.setAttribute("aria-hidden", "true");
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

    // Alarmes
    if (state.alarms.length === 0) {
      $alarmList.innerHTML = `<li class="muted">Nenhum alarme ativo.</li>`;
    } else {
      $alarmList.innerHTML = state.alarms
        .map(
          (a) =>
            `<li class="alarm">[${a.loop}] ${a.message} <span class="muted">(${a.equipment} · t=${a.since.toFixed(
              1,
            )}s)</span></li>`,
        )
        .join("");
    }

    // Drawer aberto: atualizar conteúdo
    if (currentDrawerId) renderDrawerBody($drawerBody, currentDrawerId, state);
  }

  // primeiro paint
  updateToggles();
  refresh();

  return { refresh, updateToggles, openDrawer, closeDrawer };
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

function renderDrawerBody(container: HTMLElement, id: EquipmentId, state: SimState): void {
  const def = EQUIPMENTS.find((e) => e.id === id);
  if (!def) return;
  const st = state.equipState[id];

  const tagsHtml = def.tags
    .map((tid) => {
      const tag = TAG_BY_ID[tid];
      const v = state.values[tid];
      const isHi = tag.hi !== undefined && v > tag.hi;
      return `<div class="kv"><span class="k">${tid} <span class="muted">(${tag.kind})</span> — ${tag.desc}</span>
        <span class="v" style="color:${isHi ? "var(--alarm)" : "var(--text)"}">${formatVal(v)} ${tag.unit}</span></div>`;
    })
    .join("");

  const loopsHtml = (def.loops ?? [])
    .map((lid) => {
      const l = state.loops[lid];
      const extra = l.setpoint !== undefined ? ` <span class="muted">SP=${l.setpoint}</span>` : "";
      return `<div class="kv"><span class="k">${lid}${extra}</span><span class="v">${l.description}</span></div>`;
    })
    .join("");

  const myAlarms = state.alarms.filter((a) => a.equipment === id);
  const alarmsHtml =
    myAlarms.length === 0
      ? `<div class="muted" style="font-size:11px;">Sem alarmes ativos.</div>`
      : myAlarms
          .map(
            (a) =>
              `<div class="kv"><span class="k" style="color:var(--alarm)">[${a.loop}] ${a.message}</span><span class="v">t=${a.since.toFixed(1)}s</span></div>`,
          )
          .join("");

  container.innerHTML = `
    <div class="section">
      <h4>Estado</h4>
      <div class="kv"><span class="k">Status</span><span class="v"><span class="badge ${st}">${st}</span></span></div>
    </div>
    <div class="section">
      <h4>Tags</h4>
      ${tagsHtml || `<div class="muted" style="font-size:11px;">Sem tags associadas.</div>`}
    </div>
    <div class="section">
      <h4>Malhas</h4>
      ${loopsHtml || `<div class="muted" style="font-size:11px;">Sem malhas associadas.</div>`}
    </div>
    <div class="section">
      <h4>Alarmes</h4>
      ${alarmsHtml}
    </div>
  `;
}
