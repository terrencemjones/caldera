import { clamp, V3 } from './math';

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k) e.append(k);
  return e;
}

export function svg(body: string): HTMLElement {
  const s = h('span', 'ico');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`;
  return s;
}

/** Report pointer drags as deltas. */
export function dragPad(el: HTMLElement, onMove: (dx: number, dy: number, e: PointerEvent) => void, onEnd?: () => void) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    let lx = e.clientX, ly = e.clientY;
    const move = (ev: PointerEvent) => {
      onMove(ev.clientX - lx, ev.clientY - ly, ev);
      lx = ev.clientX; ly = ev.clientY;
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      onEnd?.();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}

/**
 * What a group of widgets reports to: `changed` while a value is moving,
 * `commit` when the gesture ends. Each widget adds a function to `sync` that
 * redraws it from the current value.
 */
export interface Ctx {
  changed(): void;
  commit(): void;
  sync: (() => void)[];
}

export interface NumOpts {
  step?: number;
  digits?: number;
  min?: number;
  max?: number;
}

export function num(ctx: Ctx, label: string, get: () => number, set: (v: number) => void, o: NumOpts = {}) {
  const { step = 0.5, digits = 1, min = -1e6, max = 1e6 } = o;
  const val = h('span', 'num-val');
  const el = h('div', 'num', h('span', 'num-label', label), val);
  el.title = 'Drag sideways to change, double-click to type';
  const sync = () => { val.textContent = get().toFixed(digits); };
  dragPad(el, (dx, _dy, e) => {
    set(clamp(get() + dx * step * (e.shiftKey ? 0.1 : 1), min, max));
    ctx.changed();
  }, ctx.commit);
  el.addEventListener('dblclick', () => {
    const inp = h('input', 'num-input');
    inp.value = get().toFixed(digits);
    val.replaceWith(inp);
    inp.focus();
    inp.select();
    let finished = false;
    const done = (apply: boolean) => {
      if (finished) return;
      finished = true;
      const v = parseFloat(inp.value);
      if (apply && Number.isFinite(v)) { set(clamp(v, min, max)); ctx.changed(); ctx.commit(); }
      inp.replaceWith(val);
      sync();
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
      e.stopPropagation();
    });
    inp.addEventListener('blur', () => done(true));
  });
  ctx.sync.push(sync);
  sync();
  return el;
}

export function slider(ctx: Ctx, label: string, get: () => number, set: (v: number) => void, min = 0, max = 1) {
  const fill = h('div', 'sl-fill');
  const track = h('div', 'sl-track', fill);
  const el = h('div', 'slider', label ? h('span', 'sl-label', label) : null, track);
  const sync = () => { fill.style.width = `${clamp((get() - min) / (max - min), 0, 1) * 100}%`; };
  const at = (e: PointerEvent) => {
    const r = track.getBoundingClientRect();
    set(min + clamp((e.clientX - r.left) / r.width, 0, 1) * (max - min));
    ctx.changed();
  };
  track.addEventListener('pointerdown', at);
  dragPad(track, (_dx, _dy, e) => at(e), ctx.commit);
  ctx.sync.push(sync);
  sync();
  return el;
}

export function button(label: string, fn: () => void, cls = 'btn', title = '') {
  const b = h('button', cls, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', fn);
  return b;
}

/** A row of mutually exclusive buttons. */
export function seg(ctx: Ctx, options: string[], get: () => number, set: (i: number) => void, cls = '') {
  const btns = options.map((o, i) => button(o, () => { set(i); ctx.changed(); ctx.commit(); }, 'btn small'));
  ctx.sync.push(() => btns.forEach((b, i) => b.classList.toggle('on', get() === i)));
  const el = h('div', 'seg ' + cls, ...btns);
  btns.forEach((b, i) => b.classList.toggle('on', get() === i));
  return el;
}

export function choice(ctx: Ctx, options: string[], get: () => number, set: (i: number) => void) {
  const s = h('select', 'choice');
  options.forEach((o, i) => {
    const op = h('option', '', o);
    op.value = String(i);
    s.append(op);
  });
  s.addEventListener('change', () => { set(Number(s.value)); ctx.changed(); ctx.commit(); });
  s.addEventListener('keydown', (e) => e.stopPropagation());
  const sync = () => { s.value = String(get()); };
  ctx.sync.push(sync);
  sync();
  return s;
}

const toHex = (c: V3) =>
  '#' + c.map((x) => Math.round(clamp(Math.pow(x, 1 / 2.2), 0, 1) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (s: string): V3 => [1, 3, 5].map((i) => Math.pow(parseInt(s.slice(i, i + 2), 16) / 255, 2.2)) as V3;

/** Colour well. Values are linear light; the picker works in display colour. */
export function color(ctx: Ctx, get: () => V3, set: (c: V3) => void, title = '') {
  const inp = h('input', 'well');
  inp.type = 'color';
  if (title) inp.title = title;
  inp.addEventListener('input', () => { set(fromHex(inp.value)); ctx.changed(); });
  inp.addEventListener('change', () => ctx.commit());
  const sync = () => { inp.value = toHex(get()); };
  ctx.sync.push(sync);
  sync();
  return inp;
}

export const css3 = (c: V3, k = 1) =>
  `rgb(${c.map((x) => Math.round(clamp(Math.pow(x * k, 1 / 2.2), 0, 1) * 255)).join(',')})`;

export interface Modal {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
}

/** A full-window editor. `onClose` runs however it is dismissed. */
export function modal(title: string, onAccept: (() => void) | null, onClose: () => void): Modal {
  const body = h('div', 'modal-body');
  const foot = h('div', 'modal-foot');
  const win = h('div', 'modal-win', h('div', 'modal-head', title), body, foot);
  const el = h('div', 'modal', win);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    window.removeEventListener('keydown', key, true);
    el.remove();
    onClose();
  };
  const key = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'SELECT'))) {
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', key, true);
  foot.append(button(onAccept ? 'Cancel' : 'Close', close, 'btn'));
  if (onAccept) foot.append(button('Accept', () => { onAccept(); close(); }, 'btn accept'));
  document.body.append(el);
  return { el, body, close };
}

export const modalOpen = () => !!document.querySelector('.modal');
