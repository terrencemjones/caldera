import { V3, xform, xfPoint, xfDir, add, mul } from './math';
import { Scene, SceneObject, objScale } from './scene';
import { Basis, basis, screenRay, toCam } from './camera';
import { heightmap, sampleHeight } from './terrain';

type Line = V3[];

function circle(axis: 0 | 1 | 2, r: number, off: number, n = 32): Line {
  const pts: Line = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a) * r, s = Math.sin(a) * r;
    pts.push(axis === 1 ? [c, off, s] : axis === 0 ? [off, c, s] : [c, s, off]);
  }
  return pts;
}

const CUBE: Line[] = (() => {
  const L: Line[] = [];
  for (const a of [-1, 1])
    for (const b of [-1, 1]) {
      L.push([[-1, a, b], [1, a, b]]);
      L.push([[a, -1, b], [a, 1, b]]);
      L.push([[a, b, -1], [a, b, 1]]);
    }
  return L;
})();

const SPHERE: Line[] = [circle(0, 1, 0), circle(1, 1, 0), circle(2, 1, 0), circle(1, 0.866, 0.5), circle(1, 0.866, -0.5)];

const CYL: Line[] = (() => {
  const L: Line[] = [circle(1, 1, 1), circle(1, 1, -1)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    L.push([[Math.cos(a), -1, Math.sin(a)], [Math.cos(a), 1, Math.sin(a)]]);
  }
  return L;
})();

const CONE: Line[] = (() => {
  const L: Line[] = [circle(1, 1, -1), circle(1, 0.5, 0)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    L.push([[Math.cos(a), -1, Math.sin(a)], [0, 1, 0]]);
  }
  return L;
})();

const PLANE: Line[] = (() => {
  const L: Line[] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 - 1;
    L.push([[t, 0, -1], [t, 0, 1]]);
    L.push([[-1, 0, t], [1, 0, t]]);
  }
  return L;
})();

function terrainLines(o: SceneObject): Line[] {
  const data = heightmap(o.id, o.terrain!);
  const L: Line[] = [];
  const lines = 22, seg = 44;
  for (let i = 0; i <= lines; i++) {
    const u = i / lines;
    const a: Line = [], b: Line = [];
    for (let j = 0; j <= seg; j++) {
      const v = j / seg;
      a.push([u * 2 - 1, sampleHeight(data, u, v), v * 2 - 1]);
      b.push([v * 2 - 1, sampleHeight(data, v, u), u * 2 - 1]);
    }
    L.push(a, b);
  }
  return L;
}

const ray = (x: number, y: number, z: number, l = 1.7): Line => [[x, y, z], [x * l, y * l, z * l]];
const RADIAL: Line[] = [circle(0, 0.6, 0, 16), circle(1, 0.6, 0, 16), circle(2, 0.6, 0, 16),
  ray(1, 0, 0), ray(-1, 0, 0), ray(0, 1, 0), ray(0, -1, 0), ray(0, 0, 1), ray(0, 0, -1)];
const PARALLEL: Line[] = (() => {
  const L: Line[] = [circle(1, 1, 0, 16)];
  for (const [x, z] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) {
    L.push([[x, 0, z], [x, -3, z]], [[x - 0.2, -2.6, z], [x, -3, z], [x + 0.2, -2.6, z]]);
  }
  return L;
})();
function spotLines(coneDeg: number): Line[] {
  const r = Math.tan((Math.min(80, coneDeg) * Math.PI) / 180) * 4;
  const L: Line[] = [circle(1, r, -4, 24), circle(1, r / 2, -2, 24)];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    L.push([[0, 0, 0], [Math.cos(a) * r, -4, Math.sin(a) * r]]);
  }
  return L;
}

const terrainCache = new Map<number, { key: string; lines: Line[] }>();

function shape(o: SceneObject): Line[] {
  switch (o.type) {
    case 'cube': return CUBE;
    case 'sphere': return SPHERE;
    case 'cylinder': return CYL;
    case 'cone': return CONE;
    case 'plane': return PLANE;
    case 'light':
      return o.light?.kind === 'spot' ? spotLines(o.light.cone) : o.light?.kind === 'parallel' ? PARALLEL : RADIAL;
    case 'terrain': {
      const key = JSON.stringify(o.terrain);
      const c = terrainCache.get(o.id);
      if (c && c.key === key) return c.lines;
      const lines = terrainLines(o);
      terrainCache.set(o.id, { key, lines });
      return lines;
    }
  }
}

const NEAR = 0.5;

export function drawWire(ctx: CanvasRenderingContext2D, scene: Scene, selected: number | null) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const b = basis(scene.camera);
  const fx = h / 2 / b.tan, cx = w / 2, cy = h / 2;
  ctx.clearRect(0, 0, w, h);
  const px = Math.max(1, w / 1100);

  const stroke = (lines: Line[], m: Float32Array, style: string, width: number) => {
    ctx.beginPath();
    for (const line of lines) {
      let prev: V3 | null = null;
      for (const p of line) {
        const c = toCam(b, xfPoint(m, p));
        if (prev) {
          let a = prev, q = c;
          if (a[2] < NEAR && q[2] < NEAR) { prev = c; continue; }
          if (a[2] < NEAR) a = clip(q, a);
          else if (q[2] < NEAR) q = clip(a, q);
          ctx.moveTo(cx + (a[0] / a[2]) * fx, cy - (a[1] / a[2]) * fx);
          ctx.lineTo(cx + (q[0] / q[2]) * fx, cy - (q[1] / q[2]) * fx);
        }
        prev = c;
      }
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.stroke();
  };

  // Planes first so solid objects draw over them.
  const order = [...scene.objects].sort((p, q) => Number(q.type === 'plane') - Number(p.type === 'plane'));
  for (const o of order) {
    const m = xform(o.pos, o.rot, objScale(o)).m;
    const sel = o.id === selected;
    const style = sel
      ? 'rgba(255,150,70,0.95)'
      : o.type === 'plane'
        ? 'rgba(120,140,165,0.28)'
        : o.type === 'light'
          ? 'rgba(255,224,130,0.8)'
          : 'rgba(176,196,216,0.6)';
    // Objects that cut away from others are drawn dashed.
    const cutter = o.group > 0 && o.bool === 'negative';
    if (cutter) ctx.setLineDash([2 * px, 4 * px]);
    stroke(shape(o), m, style, (sel ? 1.3 : 1) * px);
    if (cutter) ctx.setLineDash([]);
    if (sel && o.type !== 'plane' && o.type !== 'light') {
      const box = o.type === 'terrain' ? CUBE.map((l) => l.map((p) => [p[0], (p[1] + 1) / 2, p[2]] as V3)) : CUBE;
      ctx.setLineDash([4 * px, 5 * px]);
      stroke(box, m, 'rgba(255,150,70,0.45)', px);
      ctx.setLineDash([]);
    }
  }
}

function clip(inside: V3, outside: V3): V3 {
  const t = (NEAR - inside[2]) / (outside[2] - inside[2]);
  return [inside[0] + (outside[0] - inside[0]) * t, inside[1] + (outside[1] - inside[1]) * t, NEAR];
}

export interface Pick {
  id: number;
  t: number;
  point: V3;
}

/** Nearest object under a pixel. Infinite planes are only picked if nothing else is hit. */
export function pick(scene: Scene, w: number, h: number, x: number, y: number): Pick | null {
  const b: Basis = basis(scene.camera);
  const ray = screenRay(b, w, h, x, y);
  let best: Pick | null = null;
  let bestPlane: Pick | null = null;
  for (const o of scene.objects) {
    const inv = xform(o.pos, o.rot, objScale(o)).inv;
    const ro = xfPoint(inv, ray.o);
    const rd = xfDir(inv, ray.d);
    if (o.type === 'plane') {
      if (Math.abs(rd[1]) < 1e-9) continue;
      const t = -ro[1] / rd[1];
      if (t <= 0) continue;
      const px = ro[0] + rd[0] * t, pz = ro[2] + rd[2] * t;
      if (Math.abs(px) > 1 || Math.abs(pz) > 1) continue;
      if (!bestPlane || t < bestPlane.t) bestPlane = { id: o.id, t, point: add(ray.o, mul(ray.d, t)) };
      continue;
    }
    const lo: V3 = [-1, o.type === 'terrain' ? 0 : -1, -1];
    let tn = -Infinity, tf = Infinity;
    for (let k = 0; k < 3; k++) {
      const d = rd[k] === 0 ? 1e-12 : rd[k];
      const t0 = (lo[k] - ro[k]) / d, t1 = (1 - ro[k]) / d;
      tn = Math.max(tn, Math.min(t0, t1));
      tf = Math.min(tf, Math.max(t0, t1));
    }
    if (tn > tf || tf < 0) continue;
    const t = Math.max(tn, 0);
    if (!best || t < best.t) best = { id: o.id, t, point: add(ray.o, mul(ray.d, t)) };
  }
  return best ?? bestPlane;
}
