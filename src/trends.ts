/**
 * Histórico em memória (ring buffer) e desenho de sparklines em <canvas>.
 * Sem libs externas e sem export de arquivos — apenas visualização ao vivo.
 */

import type { TagId } from "./types";
import { TAG_BY_ID } from "./config";

export interface TrendStore {
  /** Adiciona uma amostra de cada tag (chamar no refresh ~10 Hz). */
  push(values: Record<TagId, number>): void;
  /** Desenha a série de uma tag no canvas informado. */
  draw(canvas: HTMLCanvasElement, id: TagId): void;
  readonly capacity: number;
}

export function createTrendStore(ids: TagId[], capacity = 300): TrendStore {
  // ring buffer por tag
  const buffers: Partial<Record<TagId, Float32Array>> = {};
  const heads: Partial<Record<TagId, number>> = {};
  const lens: Partial<Record<TagId, number>> = {};
  for (const id of ids) {
    buffers[id] = new Float32Array(capacity);
    heads[id] = 0;
    lens[id] = 0;
  }

  function push(values: Record<TagId, number>): void {
    for (const id of ids) {
      const buf = buffers[id]!;
      const h = heads[id]!;
      buf[h] = values[id];
      heads[id] = (h + 1) % capacity;
      lens[id] = Math.min(capacity, lens[id]! + 1);
    }
  }

  function draw(canvas: HTMLCanvasElement, id: TagId): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const buf = buffers[id];
    if (!buf) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // fundo
    ctx.fillStyle = "rgba(10, 15, 21, 0.6)";
    ctx.fillRect(0, 0, w, h);

    const tag = TAG_BY_ID[id];
    const lo = tag.min;
    const hi = tag.max;
    const span = hi - lo || 1;
    const pad = 3;
    const innerH = h - pad * 2;

    const yOf = (v: number) => {
      const norm = (v - lo) / span;
      return pad + (1 - Math.min(1, Math.max(0, norm))) * innerH;
    };

    // linha de alarme alto (se houver)
    if (tag.hi !== undefined && tag.hi <= hi && tag.hi >= lo) {
      const yHi = yOf(tag.hi);
      ctx.strokeStyle = "rgba(255, 82, 82, 0.5)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, yHi);
      ctx.lineTo(w, yHi);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const len = lens[id]!;
    const head = heads[id]!;
    if (len < 2) return;

    // ordem cronológica: o mais antigo está em (head - len)
    const start = (head - len + capacity) % capacity;
    const stepX = w / (capacity - 1);

    const lastVal = buf[(head - 1 + capacity) % capacity];
    const overHi = tag.hi !== undefined && lastVal > tag.hi;
    ctx.strokeStyle = overHi ? "#ff6b6b" : "#3ea6ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const idx = (start + i) % capacity;
      const x = i * stepX;
      const y = yOf(buf[idx]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // ponto atual
    const xLast = (len - 1) * stepX;
    const yLast = yOf(lastVal);
    ctx.fillStyle = overHi ? "#ff6b6b" : "#7fd0ff";
    ctx.beginPath();
    ctx.arc(xLast, yLast, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  return { push, draw, capacity };
}
