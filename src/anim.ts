import type { Scene } from './scene';
import type { Sky } from './sky';

export interface Key {
  t: number;
  v: number[];
}

export interface Anim {
  duration: number;
  fps: number;
  time: number;
  /** When on, changing something at a time other than zero records a keyframe. */
  auto: boolean;
  /** Keyed by target: "camera", "sky", or "obj:<id>". */
  tracks: Record<string, Key[]>;
}

export const newAnim = (): Anim => ({ duration: 4, fps: 15, time: 0, auto: true, tracks: {} });

const SKY_FIELDS: (keyof Sky)[] = ['sunAz', 'sunEl', 'haze', 'fog', 'fogHeight', 'cloudCover', 'cloudHeight', 'cloudScale'];

export function targets(scene: Scene): string[] {
  return ['camera', 'sky', ...scene.objects.map((o) => `obj:${o.id}`)];
}

export function targetName(scene: Scene, target: string): string {
  if (target === 'camera') return 'Camera';
  if (target === 'sky') return 'Sky';
  const o = scene.objects.find((x) => `obj:${x.id}` === target);
  return o ? o.name : target;
}

export function getState(scene: Scene, target: string): number[] | null {
  if (target === 'camera') {
    const c = scene.camera;
    return [...c.target, c.yaw, c.pitch, c.dist, c.fov];
  }
  if (target === 'sky') return SKY_FIELDS.map((f) => scene.sky[f]);
  const o = scene.objects.find((x) => `obj:${x.id}` === target);
  return o ? [...o.pos, ...o.rot, ...o.size] : null;
}

export function setState(scene: Scene, target: string, v: number[]) {
  if (target === 'camera') {
    const c = scene.camera;
    c.target = [v[0], v[1], v[2]];
    c.yaw = v[3];
    c.pitch = v[4];
    c.dist = v[5];
    c.fov = v[6];
  } else if (target === 'sky') {
    SKY_FIELDS.forEach((f, i) => (scene.sky[f] = v[i]));
  } else {
    const o = scene.objects.find((x) => `obj:${x.id}` === target);
    if (!o) return;
    o.pos = [v[0], v[1], v[2]];
    o.rot = [v[3], v[4], v[5]];
    o.size = [v[6], v[7], v[8]];
  }
}

/** Smooth interpolation through the keys (a non-uniform Catmull-Rom spline). */
export function evalTrack(keys: Key[], t: number): number[] {
  const n = keys.length;
  if (t <= keys[0].t || n === 1) return [...keys[0].v];
  if (t >= keys[n - 1].t) return [...keys[n - 1].v];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[i], k1 = keys[i + 1];
  const km = keys[Math.max(0, i - 1)], kp = keys[Math.min(n - 1, i + 2)];
  const h = k1.t - k0.t;
  const s = (t - k0.t) / h;
  const s2 = s * s, s3 = s2 * s;
  const out: number[] = [];
  for (let c = 0; c < k0.v.length; c++) {
    const m0 = (k1.v[c] - km.v[c]) / (k1.t - km.t);
    const m1 = (kp.v[c] - k0.v[c]) / (kp.t - k0.t);
    out.push(
      (2 * s3 - 3 * s2 + 1) * k0.v[c] + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * k1.v[c] + (s3 - s2) * h * m1,
    );
  }
  return out;
}

export function snapTime(a: Anim, t: number): number {
  return Math.min(a.duration, Math.max(0, Math.round(t * a.fps) / a.fps));
}

/** Move every animated thing to where it is at time t. */
export function applyTime(scene: Scene, t: number) {
  scene.anim.time = t;
  for (const [target, keys] of Object.entries(scene.anim.tracks)) {
    if (keys.length) setState(scene, target, evalTrack(keys, t));
  }
}

export function setKey(scene: Scene, target: string, t: number, v: number[]) {
  const a = scene.anim;
  const keys = (a.tracks[target] ??= []);
  const eps = 0.5 / a.fps;
  const hit = keys.find((k) => Math.abs(k.t - t) < eps);
  if (hit) hit.v = [...v];
  else {
    keys.push({ t, v: [...v] });
    keys.sort((p, q) => p.t - q.t);
  }
}

export function removeKey(scene: Scene, target: string, t: number): boolean {
  const a = scene.anim;
  const keys = a.tracks[target];
  if (!keys) return false;
  const eps = 0.5 / a.fps;
  const i = keys.findIndex((k) => Math.abs(k.t - t) < eps);
  if (i < 0) return false;
  keys.splice(i, 1);
  if (!keys.length) delete a.tracks[target];
  return true;
}

export function snapshot(scene: Scene): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const t of targets(scene)) {
    const s = getState(scene, t);
    if (s) m.set(t, s);
  }
  return m;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);

/**
 * Record keyframes for whatever changed since the baseline. A target with no
 * track only starts one if the change happened away from time zero; the state
 * it had before the change becomes its key at zero.
 */
export function autoKey(scene: Scene, baseline: Map<string, number[]>): boolean {
  const a = scene.anim;
  // Drop tracks whose object has been deleted.
  const live = new Set(targets(scene));
  for (const k of Object.keys(a.tracks)) if (!live.has(k)) delete a.tracks[k];
  let keyed = false;
  for (const target of live) {
    const cur = getState(scene, target);
    const was = baseline.get(target);
    if (!cur || !was || same(cur, was)) continue;
    const has = !!a.tracks[target];
    if (has) {
      // An animated target always takes edits as keys, or the edit would be lost on the next scrub.
      setKey(scene, target, a.time, cur);
      keyed = true;
    } else if (a.auto && a.time > 0) {
      setKey(scene, target, 0, was);
      setKey(scene, target, a.time, cur);
      keyed = true;
    }
  }
  return keyed;
}
