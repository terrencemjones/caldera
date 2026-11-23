import { HM, makeNoise, rng } from './terrain';
import { smoothstep, clamp } from './math';

const N = HM;

/** Height filters. Each edits the map in place; amount runs 0..1. */
export const OPS: Record<string, (h: Float32Array, amount: number) => void> = {
  Erode: (h, a) => erode(h, Math.round(15000 + a * 90000), (Math.random() * 1e9) | 0),
  Smooth: (h, a) => {
    const passes = 1 + Math.round(a * 5);
    for (let p = 0; p < passes; p++) blur(h, 1);
  },
  Sharpen: (h, a) => {
    const b = h.slice();
    blur(b, 2);
    for (let i = 0; i < h.length; i++) h[i] = clamp(h[i] + (h[i] - b[i]) * (0.5 + a * 2), 0, 1);
  },
  Roughen: (h, a) => addNoise(h, 24, 5, 0.01 + a * 0.06, true),
  Mounds: (h, a) => addNoise(h, 4, 3, 0.05 + a * 0.3, false),
  Raise: (h, a) => {
    for (let i = 0; i < h.length; i++) h[i] = Math.min(1, h[i] + 0.02 + a * 0.15);
  },
  Lower: (h, a) => {
    for (let i = 0; i < h.length; i++) h[i] = Math.max(0, h[i] - 0.02 - a * 0.15);
  },
  Steepen: (h, a) => {
    for (let i = 0; i < h.length; i++) h[i] = Math.pow(h[i], 1.1 + a);
  },
  Soften: (h, a) => {
    for (let i = 0; i < h.length; i++) h[i] = Math.pow(h[i], 1 / (1.1 + a));
  },
  Terrace: (h, a) => {
    const levels = Math.round(12 - a * 9);
    for (let i = 0; i < h.length; i++) {
      const t = h[i] * levels;
      const f = Math.floor(t);
      h[i] = (f + smoothstep(0.6, 0.9, t - f)) / levels;
    }
  },
  Invert: (h) => {
    for (let i = 0; i < h.length; i++) h[i] = 1 - h[i];
  },
  'Round edges': (h, a) => edgeMask(h, a, true),
  'Square edges': (h, a) => edgeMask(h, a, false),
  Normalize: (h) => {
    let lo = Infinity, hi = -Infinity;
    for (const v of h) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const r = hi - lo || 1;
    for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) / r;
  },
  Flatten: (h) => h.fill(0),
};

function blur(h: Float32Array, r: number) {
  const tmp = new Float32Array(h.length);
  const w = 2 * r + 1;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += h[j * N + clamp(i + k, 0, N - 1)];
      tmp[j * N + i] = s / w;
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[clamp(j + k, 0, N - 1) * N + i];
      h[j * N + i] = s / w;
    }
  }
}

function addNoise(h: Float32Array, freq: number, oct: number, amp: number, scaleByHeight: boolean) {
  const noise = makeNoise((Math.random() * 1e9) | 0);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let x = (i / N) * freq, y = (j / N) * freq, a = 1, s = 0;
      for (let o = 0; o < oct; o++) {
        s += a * noise(x, y);
        a *= 0.5; x = x * 2.03 + 11.3; y = y * 2.03 + 4.7;
      }
      const k = j * N + i;
      const gate = scaleByHeight ? smoothstep(0, 0.08, h[k]) : 1;
      h[k] = clamp(h[k] + s * amp * gate, 0, 1);
    }
  }
}

function edgeMask(h: Float32Array, a: number, round: boolean) {
  const inner = 0.85 - a * 0.6;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const cx = (i / (N - 1)) * 2 - 1, cy = (j / (N - 1)) * 2 - 1;
      const d = round ? Math.hypot(cx, cy) : Math.max(Math.abs(cx), Math.abs(cy));
      h[j * N + i] *= smoothstep(1, inner, d);
    }
  }
}

/**
 * Droplet erosion: simulated raindrops run downhill, picking up soil where
 * they speed up and dropping it where they slow, which carves gullies and
 * builds fans at their feet.
 */
export function erode(h: Float32Array, drops: number, seed: number) {
  const rand = rng(seed);
  const K = 150; // turns 0..1 heights into roughly cell-sized units
  const inertia = 0.06, capacity = 4, minSlope = 0.01;
  const erodeRate = 0.3, depositRate = 0.3, evaporate = 0.02, gravity = 4;
  const R = 3;
  const brush: [number, number, number][] = [];
  let wsum = 0;
  for (let y = -R; y <= R; y++)
    for (let x = -R; x <= R; x++) {
      const d = Math.hypot(x, y);
      if (d <= R) {
        brush.push([x, y, 1 - d / R]);
        wsum += 1 - d / R;
      }
    }
  for (const b of brush) b[2] /= wsum;

  for (let n = 0; n < drops; n++) {
    let x = rand() * (N - 2), y = rand() * (N - 2);
    let dx = 0, dy = 0, speed = 1, water = 1, sed = 0;
    for (let step = 0; step < 48; step++) {
      const xi = Math.floor(x), yi = Math.floor(y);
      const u = x - xi, v = y - yi;
      const k = yi * N + xi;
      const h00 = h[k], h10 = h[k + 1], h01 = h[k + N], h11 = h[k + N + 1];
      const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v;
      const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u;
      const hOld = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v;
      dx = dx * inertia - gx * K * (1 - inertia);
      dy = dy * inertia - gy * K * (1 - inertia);
      const l = Math.hypot(dx, dy);
      if (l < 1e-9) break;
      dx /= l; dy /= l;
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= N - 1 || y >= N - 1) break;
      const xj = Math.floor(x), yj = Math.floor(y);
      const u2 = x - xj, v2 = y - yj;
      const k2 = yj * N + xj;
      const hNew = h[k2] * (1 - u2) * (1 - v2) + h[k2 + 1] * u2 * (1 - v2) + h[k2 + N] * (1 - u2) * v2 + h[k2 + N + 1] * u2 * v2;
      const dh = (hNew - hOld) * K;
      const cap = Math.max(-dh * speed * water * capacity, minSlope);
      if (sed > cap || dh > 0) {
        const dep = dh > 0 ? Math.min(dh, sed) : (sed - cap) * depositRate;
        sed -= dep;
        const d = dep / K;
        h[k] += d * (1 - u) * (1 - v);
        h[k + 1] += d * u * (1 - v);
        h[k + N] += d * (1 - u) * v;
        h[k + N + 1] += d * u * v;
      } else {
        const amt = Math.min((cap - sed) * erodeRate, -dh);
        for (const [bx, by, bw] of brush) {
          const px = xi + bx, py = yi + by;
          if (px < 0 || py < 0 || px >= N || py >= N) continue;
          const idx = py * N + px;
          const take = Math.min(h[idx], (amt * bw) / K);
          h[idx] -= take;
          sed += take * K;
        }
      }
      speed = Math.sqrt(Math.max(0, speed * speed - dh * gravity));
      water *= 1 - evaporate;
    }
  }
  for (let i = 0; i < h.length; i++) h[i] = clamp(h[i], 0, 1);
}

export type BrushMode = 'raise' | 'lower' | 'flatten' | 'smooth';

/** Stamp the brush once at map coordinates (cx, cy), in cells. */
export function stamp(h: Float32Array, cx: number, cy: number, radius: number, strength: number, mode: BrushMode, level: number) {
  const r = Math.max(1, radius);
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N - 1, Math.ceil(cy + r));
  for (let j = y0; j <= y1; j++) {
    for (let i = x0; i <= x1; i++) {
      const d = Math.hypot(i - cx, j - cy) / r;
      if (d >= 1) continue;
      const w = (1 - d * d) * (1 - d * d) * strength;
      const k = j * N + i;
      if (mode === 'raise') h[k] = Math.min(1, h[k] + w * 0.05);
      else if (mode === 'lower') h[k] = Math.max(0, h[k] - w * 0.05);
      else if (mode === 'flatten') h[k] += (level - h[k]) * Math.min(1, w * 0.5);
      else {
        const a = h[j * N + Math.max(0, i - 2)] + h[j * N + Math.min(N - 1, i + 2)] + h[Math.max(0, j - 2) * N + i] + h[Math.min(N - 1, j + 2) * N + i];
        h[k] += (a / 4 - h[k]) * Math.min(1, w * 0.6);
      }
    }
  }
}

/** Turn an image into a heightmap using its brightness. */
export async function fromImage(file: File): Promise<Float32Array> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = N;
  c.height = N;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, N, N);
  const px = ctx.getImageData(0, 0, N, N).data;
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) out[i] = (0.21 * px[i * 4] + 0.72 * px[i * 4 + 1] + 0.07 * px[i * 4 + 2]) / 255;
  return out;
}
