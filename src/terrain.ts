import { smoothstep } from './math';

export const HM = 512;

export type TerrainStyle = 'mountain' | 'hills' | 'mesa' | 'dunes';

export interface TerrainParams {
  seed: number;
  style: TerrainStyle;
  rough: number;
  /** Key of a hand-edited heightmap; when present it replaces the generated one. */
  map?: string;
  /** Bumped while a map is being edited in place, so views know to refresh. */
  rev?: number;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D gradient noise, roughly in [-1, 1]. */
export function makeNoise(seed: number) {
  const r = rng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
  const gy = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const g = (ix: number, iy: number, dx: number, dy: number) => {
      const h = perm[perm[ix] + iy] & 7;
      return gx[h] * dx + gy[h] * dy;
    };
    const u = fade(xf), v = fade(yf);
    const a = g(X, Y, xf, yf), b = g(X + 1, Y, xf - 1, yf);
    const c = g(X, Y + 1, xf, yf - 1), d = g(X + 1, Y + 1, xf - 1, yf - 1);
    return (a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v) * 0.7;
  };
}

export function genTerrain(p: TerrainParams, N = HM): Float32Array {
  const noise = makeNoise(p.seed);
  const out = new Float32Array(N * N);
  const gain = 0.4 + 0.25 * p.rough;
  const fbm = (x: number, y: number, oct: number) => {
    let a = 1, s = 0, n = 0;
    for (let o = 0; o < oct; o++) {
      s += a * noise(x, y);
      n += a;
      a *= gain; x = x * 2.03 + 13.7; y = y * 2.03 + 7.3;
    }
    return s / n;
  };
  const ridged = (x: number, y: number, oct: number) => {
    let a = 1, s = 0, n = 0, w = 1;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(noise(x, y));
      v = v * v * w;
      w = Math.min(1, v * 2);
      s += a * v;
      n += a;
      a *= gain; x = x * 2.07 + 5.1; y = y * 2.07 + 19.4;
    }
    return s / n;
  };
  let max = 1e-6;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1), y = j / (N - 1);
      const cx = x * 2 - 1, cy = y * 2 - 1;
      // Warp the coordinates a little so features don't follow the grid.
      const wx = x + 0.08 * noise(x * 2.3 + 40, y * 2.3);
      const wy = y + 0.08 * noise(x * 2.3, y * 2.3 + 40);
      const rr = Math.hypot(cx, cy);
      const edge = Math.max(Math.abs(cx), Math.abs(cy));
      let mask = smoothstep(1.0, 0.42, rr * 0.75 + edge * 0.25 + 0.12 * noise(x * 3 + 9, y * 3));
      let h: number;
      switch (p.style) {
        case 'hills':
          h = 0.5 + 0.5 * fbm(wx * 2.6, wy * 2.6, 5);
          h = h * h * mask;
          break;
        case 'mesa': {
          h = 0.5 + 0.5 * fbm(wx * 2.2, wy * 2.2, 7);
          h = smoothstep(0.25, 0.8, h);
          const levels = 4;
          const t = h * levels;
          const fl = Math.floor(t);
          const tier = (fl + smoothstep(0.55, 0.8, t - fl)) / levels;
          mask = smoothstep(0, 0.35, mask);
          h = (tier * 0.92 + 0.08 * h) * mask;
          break;
        }
        case 'dunes': {
          const r1 = 1 - Math.abs(noise(wx * 5.5 + 0.6 * noise(wy * 3, 3), wy * 1.6));
          h = Math.pow(r1, 1.6) * 0.75 + 0.25 * (0.5 + 0.5 * fbm(wx * 3, wy * 3, 4));
          h *= Math.sqrt(mask);
          break;
        }
        default: {
          const r1 = ridged(wx * 1.7, wy * 1.7, 9);
          const f1 = 0.5 + 0.5 * fbm(wx * 1.3 + 3, wy * 1.3, 6);
          h = (Math.pow(r1, 1.9) * 0.8 + f1 * 0.2) * mask * (0.25 + 0.75 * f1 * f1);
        }
      }
      h = Math.max(0, h - 0.015);
      out[j * N + i] = h;
      if (h > max) max = h;
    }
  }
  for (let k = 0; k < out.length; k++) out[k] /= max;
  return out;
}

const cache = new Map<number, { key: string; data: Float32Array }>();
const custom = new Map<string, Float32Array>();

export function terrainKey(p: TerrainParams): string {
  return p.map ? `${p.map}#${p.rev ?? 0}` : `${p.seed}|${p.style}|${p.rough}`;
}

export function heightmap(id: number, p: TerrainParams): Float32Array {
  if (p.map) {
    const m = custom.get(p.map);
    if (m) return m;
  }
  const key = `${p.seed}|${p.style}|${p.rough}`;
  const c = cache.get(id);
  if (c && c.key === key) return c.data;
  const data = genTerrain(p);
  cache.set(id, { key, data });
  return data;
}

// ---------------------------------------------------------------- edited maps
// Hand-edited heightmaps are immutable snapshots held by key, so undo can point
// back at an older one. They persist in IndexedDB as 16-bit data.

const DB = 'caldera';
const STORE = 'heightmaps';

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function setMap(key: string, data: Float32Array) {
  custom.set(key, data);
}

/** Store a finished heightmap and return its key. */
export function putMap(data: Float32Array): string {
  const key = `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  custom.set(key, data);
  const u = new Uint16Array(data.length);
  for (let i = 0; i < u.length; i++) u[i] = Math.round(Math.min(1, Math.max(0, data[i])) * 65535);
  db()
    .then((d) => d.transaction(STORE, 'readwrite').objectStore(STORE).put(u, key))
    .catch(() => {
      /* without IndexedDB the edit lasts for this session only */
    });
  return key;
}

/** Load saved maps for the given keys and drop any others. Resolves true if something loaded. */
export async function loadMaps(keys: string[]): Promise<boolean> {
  let loaded = false;
  try {
    const d = await db();
    const os = d.transaction(STORE, 'readwrite').objectStore(STORE);
    const all: string[] = await new Promise((res, rej) => {
      const r = os.getAllKeys();
      r.onsuccess = () => res(r.result as string[]);
      r.onerror = () => rej(r.error);
    });
    for (const k of all) {
      if (!keys.includes(k)) {
        os.delete(k);
        continue;
      }
      if (custom.has(k)) continue;
      const u: Uint16Array | undefined = await new Promise((res, rej) => {
        const r = os.get(k);
        r.onsuccess = () => res(r.result as Uint16Array | undefined);
        r.onerror = () => rej(r.error);
      });
      if (!u) continue;
      const f = new Float32Array(u.length);
      for (let i = 0; i < f.length; i++) f[i] = u[i] / 65535;
      custom.set(k, f);
      loaded = true;
    }
  } catch {
    /* ignore: terrains fall back to their generated shape */
  }
  return loaded;
}

export function sampleHeight(data: Float32Array, u: number, v: number): number {
  const i = Math.min(HM - 1, Math.max(0, Math.round(u * (HM - 1))));
  const j = Math.min(HM - 1, Math.max(0, Math.round(v * (HM - 1))));
  return data[j * HM + i];
}
