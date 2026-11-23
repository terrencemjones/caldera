// Scene randomizer: picks one of several hand-tuned scene recipes and varies its
// terrain, sky, materials, props and camera within ranges known to look good.
import type { V3 } from './math';
import { Scene, SceneObject, ObjType, LightKind, LightParams, defaultScene, makeObject } from './scene';
import { Material, preset } from './materials';
import type { Sky } from './sky';
import { TerrainStyle, genTerrain, putMap, rng, sampleHeight } from './terrain';
import { erode, OPS } from './terrainOps';
import { basis } from './camera';

const D = Math.PI / 180;

type Mood = 'day' | 'afternoon' | 'golden' | 'sunset' | 'mist' | 'storm' | 'moon';
const MOOD_NAMES: Record<Mood, string> = {
  day: 'midday', afternoon: 'afternoon', golden: 'golden hour', sunset: 'sunset', mist: 'misty dawn', storm: 'overcast', moon: 'moonlight',
};

interface LandOpts {
  pos: V3;
  size: V3;
  style?: TerrainStyle;
  mat?: string | Material;
  rough?: number;
  drops?: number;
  smooth?: number;
}

type Props = Partial<Omit<SceneObject, 'mat'>> & { mat?: string | Material };

class Builder {
  scene: Scene;
  mood: Mood = 'day';
  private lands: { o: SceneObject; data: Float32Array }[] = [];
  private floorY = 0;
  private waterY = -Infinity;

  constructor(private rand: () => number) {
    this.scene = defaultScene();
    this.scene.objects = [];
  }

  r(a: number, b: number) { return a + (b - a) * this.rand(); }
  ri(a: number, b: number) { return Math.floor(this.r(a, b + 1)); }
  chance(p: number) { return this.rand() < p; }
  sign() { return this.rand() < 0.5 ? -1 : 1; }
  pick<T>(list: readonly T[]): T { return list[Math.floor(this.rand() * list.length)]; }
  /** Scale a vector by a random factor per axis, within ±amount. */
  jit(v: V3, amount: number): V3 { return [v[0] * this.r(1 - amount, 1 + amount), v[1] * this.r(1 - amount, 1 + amount), v[2] * this.r(1 - amount, 1 + amount)]; }

  add(type: ObjType, kind?: 'water' | LightKind, props: Props = {}): SceneObject {
    const o = makeObject(this.scene, type, kind);
    const { mat, ...rest } = props;
    Object.assign(o, rest);
    if (mat) o.mat = typeof mat === 'string' ? preset(mat) : mat;
    this.scene.objects.push(o);
    return o;
  }

  floor(mat: string | Material, y = 0) {
    this.floorY = y;
    return this.add('plane', undefined, { pos: [0, y, 0], mat });
  }

  water(y = 3, mat: string | Material = 'Deep Water') {
    this.waterY = y;
    return this.add('plane', 'water', { pos: [0, y, 0], mat });
  }

  land(l: LandOpts): SceneObject {
    const seed = Math.floor(this.rand() * 1e6);
    const p = { seed, style: l.style ?? 'mountain', rough: l.rough ?? this.r(0.4, 0.6) };
    const data = genTerrain(p);
    const drops = l.drops ?? 30000;
    if (drops > 0) erode(data, drops, seed + 1);
    if (l.smooth) OPS['Smooth'](data, l.smooth);
    const o = this.add('terrain', undefined, { pos: l.pos, size: l.size, mat: l.mat ?? 'Alpine', terrain: { ...p, map: putMap(data) } });
    this.lands.push({ o, data });
    return o;
  }

  /** Height of solid ground (floor and terrains) under a point. */
  solid(x: number, z: number): number {
    let y = this.floorY;
    for (const { o, data } of this.lands) {
      const u = (x - o.pos[0]) / o.size[0] + 0.5, v = (z - o.pos[2]) / o.size[2] + 0.5;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      y = Math.max(y, o.pos[1] + sampleHeight(data, u, v) * o.size[1]);
    }
    return y;
  }

  /** Height of whatever an object would rest on: ground or the water surface. */
  surface(x: number, z: number): number {
    return Math.max(this.solid(x, z), this.waterY);
  }

  /** A point on the ground plane, `dist` from `c`, at `deg` measured from the camera's side. */
  toward(c: V3, yawDeg: number, deg: number, dist: number): [number, number] {
    const a = (yawDeg + deg) * D;
    return [c[0] + Math.sin(a) * dist, c[2] + Math.cos(a) * dist];
  }

  /** Aim the camera, then tilt it up until terrain no longer blocks the near part of the view. */
  cam(target: V3, yawDeg: number, pitchDeg: number, dist: number, fov = 50) {
    const c = (this.scene.camera = { target, yaw: yawDeg * D, pitch: pitchDeg * D, dist, fov });
    for (let n = 0; n < 40; n++) {
      const pos = basis(c).pos;
      let blocked = false;
      for (let t = 0; t <= 0.5 && !blocked; t += 0.025) {
        const x = pos[0] + (target[0] - pos[0]) * t, y = pos[1] + (target[1] - pos[1]) * t, z = pos[2] + (target[2] - pos[2]) * t;
        blocked = y < Math.max(this.solid(x, z), this.waterY) + (t === 0 ? 5 : 2.5);
      }
      if (!blocked) break;
      c.pitch += 1.5 * D;
    }
  }

  /** Set the sky for a mood. Low suns sit in front of the camera, high suns light from the side. */
  sky(mood: Mood, yawDeg: number) {
    this.mood = mood;
    const ahead = yawDeg + 180;
    const front = ahead + this.sign() * this.r(12, 34);
    const side = ahead + this.sign() * this.r(70, 130);
    const base: Sky = { sunAz: side, sunEl: 40, haze: 0.25, fog: 0, fogHeight: 10, cloudCover: 0.4, cloudHeight: 500, cloudScale: 1 };
    const moods: Record<Mood, Partial<Sky>> = {
      day: { sunEl: this.r(36, 54), haze: this.r(0.15, 0.3), cloudCover: this.r(0.25, 0.5), cloudHeight: this.r(480, 900) },
      afternoon: { sunEl: this.r(19, 32), haze: this.r(0.25, 0.36), cloudCover: this.r(0.3, 0.55), cloudHeight: this.r(420, 650) },
      golden: { sunAz: front, sunEl: this.r(8, 14), haze: this.r(0.22, 0.32), cloudCover: this.r(0.4, 0.6), cloudHeight: this.r(360, 480), cloudScale: this.r(1.05, 1.4) },
      sunset: { sunAz: front, sunEl: this.r(3.5, 7), haze: this.r(0.28, 0.38), fog: this.r(0, 0.06), fogHeight: 8, cloudCover: this.r(0.45, 0.6), cloudHeight: this.r(350, 430), cloudScale: this.r(1.1, 1.4) },
      mist: { sunAz: front, sunEl: this.r(8, 14), haze: this.r(0.48, 0.6), fog: this.r(0.5, 0.75), fogHeight: this.r(9, 18), cloudCover: this.r(0.2, 0.35), cloudHeight: this.r(550, 750) },
      storm: { sunEl: this.r(20, 32), haze: this.r(0.3, 0.4), fog: this.r(0, 0.08), fogHeight: 10, cloudCover: this.r(0.86, 0.95), cloudHeight: this.r(300, 350), cloudScale: this.r(1.4, 1.7) },
      // Below the horizon the light is a moon on the opposite side of the sky from the sun.
      moon: { sunAz: front + 180, sunEl: -14, haze: this.r(0.24, 0.3), fog: this.r(0.08, 0.15), fogHeight: 6, cloudCover: this.r(0.2, 0.35) },
    };
    this.scene.sky = { ...base, ...moods[mood] };
    this.scene.sky.sunAz = ((this.scene.sky.sunAz % 360) + 360) % 360;
  }

  light(kind: LightKind, pos: V3, color: V3, power: number, range: number, more: Partial<LightParams> = {}) {
    return this.add('light', kind, { pos, light: { kind, color, power, range, cone: 25, soft: 0.3, falloff: 2, shadows: true, ...more } });
  }

  /** A shiny material for a showpiece object. */
  jewel(): Material {
    const name = this.pick(['Chrome', 'Chrome', 'Gold', 'Gold', 'Glass', 'Glass', 'Hammered Copper', 'Ice', 'Marble', 'Plastic'] as const);
    if (name !== 'Plastic') return preset(name);
    const hue = this.pick<V3>([[0.8, 0.08, 0.06], [0.05, 0.3, 0.75], [0.9, 0.55, 0.05], [0.1, 0.55, 0.25], [0.5, 0.1, 0.6], [0.9, 0.9, 0.88]]);
    return { ...preset('Red Plastic'), color: hue };
  }
}

const WARM: V3 = [1, 0.55, 0.2];

// ------------------------------------------------------------------ recipes

function island(b: Builder) {
  const yaw = b.r(0, 360);
  b.sky(b.pick<Mood>(['golden', 'golden', 'sunset', 'afternoon', 'day', 'moon', 'storm']), yaw);
  b.floor('Sand');
  b.water(3, b.chance(0.3) ? 'Lagoon' : 'Deep Water');
  const h = b.r(46, 66);
  b.land({ pos: [0, 0, 0], size: [b.r(150, 190), h, b.r(150, 190)], mat: b.pick(['Alpine', 'Alpine', 'Granite', 'Red Strata']) });
  // Smaller islands behind and beside the main one.
  for (let i = b.ri(0, 2); i > 0; i--) {
    const [x, z] = b.toward([0, 0, 0], yaw, b.r(110, 250), b.r(150, 230));
    const s = b.r(60, 110);
    b.land({ pos: [x, 0, z], size: [s, s * b.r(0.25, 0.4), s], mat: 'Alpine', drops: 25000 });
  }
  let prop: SceneObject | null = null;
  if (b.chance(0.65)) {
    const s = b.r(12, 18);
    const [x, z] = b.toward([0, 0, 0], yaw, b.r(-35, 35), b.r(72, 92));
    prop = b.add('sphere', undefined, { pos: [x, b.surface(x, z) + s * b.r(0.5, 0.75), z], size: [s, s, s], mat: b.pick(['Chrome', 'Gold', 'Glass']) });
  }
  if (b.mood === 'moon') {
    const [x, z] = prop ? [prop.pos[0] + 8, prop.pos[2] + 8] : b.toward([0, 0, 0], yaw, 20, 80);
    b.light('radial', [x, b.surface(x, z) + 6, z], WARM, 7, 22);
  }
  b.cam([0, h * 0.3, 0], yaw, b.r(3, 8), b.r(190, 215), 48);
  return 'Island';
}

function lake(b: Builder) {
  const yaw = b.r(-9, 9);
  b.sky(b.pick<Mood>(['day', 'afternoon', 'afternoon', 'golden', 'mist', 'moon']), yaw);
  b.floor('Granite');
  b.water(b.r(4, 8), b.chance(0.6) ? 'Lagoon' : 'Deep Water');
  const peak = b.pick(['Alpine', 'Alpine', 'Snow']);
  b.land({ pos: [b.r(-50, 30), 0, -190], size: b.jit([330, 120, 260], 0.12), mat: peak });
  b.land({ pos: [-190, 0, b.r(-10, 30)], size: b.jit([220, 80, 260], 0.12), mat: 'Alpine' });
  b.land({ pos: [185, 0, b.r(-40, 0)], size: b.jit([230, 90, 280], 0.12), mat: 'Alpine' });
  const pick = b.r(0, 1);
  if (pick < 0.35) {
    const s = b.r(45, 70);
    b.land({ pos: [b.r(-35, 35), 0, b.r(-30, 40)], size: [s, s * 0.4, s], mat: 'Alpine', drops: 20000 });
  } else if (pick < 0.6) {
    const s = b.r(14, 22), x = b.r(-30, 30), z = b.r(0, 60);
    b.add('sphere', undefined, { pos: [x, b.surface(x, z) + s * 0.5, z], size: [s, s, s], mat: b.pick(['Chrome', 'Gold']) });
  }
  b.cam([0, 24, -60], yaw, b.r(2, 5), b.r(240, 260), 52);
  return 'Mountain lake';
}

function mesas(b: Builder) {
  const river = b.chance(0.45);
  const yaw = river ? b.r(-4, 6) : b.r(6, 20);
  b.sky(b.pick<Mood>(['afternoon', 'afternoon', 'day', 'golden', 'sunset']), yaw);
  b.floor('Sand');
  if (river) {
    b.water(5, 'Lagoon');
    b.land({ style: 'mesa', mat: 'Red Strata', drops: 36000, pos: [-150, 0, -60], size: b.jit([250, 100, 420], 0.1) });
    b.land({ style: 'mesa', mat: 'Red Strata', drops: 36000, pos: [150, 0, -100], size: b.jit([250, 115, 420], 0.1) });
    b.land({ style: 'mesa', mat: 'Red Strata', drops: 36000, pos: [20, 0, -430], size: b.jit([320, 140, 260], 0.1) });
    b.cam([0, 30, -80], yaw, b.r(1, 4), 230, 55);
    return 'Canyon river';
  }
  b.land({ style: 'mesa', mat: 'Red Strata', pos: [10, 0, -90], size: b.jit([230, 82, 180], 0.15) });
  b.land({ style: 'mesa', mat: 'Red Strata', pos: [-185, 0, 0], size: b.jit([170, 60, 170], 0.15) });
  b.land({ style: 'mesa', mat: 'Red Strata', pos: [190, 0, -190], size: b.jit([220, 96, 220], 0.15) });
  if (b.chance(0.4)) {
    const [x, z] = b.toward([0, 0, -60], yaw, b.r(-25, 25), b.r(110, 140));
    const s = b.r(12, 18);
    b.add('sphere', undefined, { pos: [x, b.surface(x, z) + s / 2, z], size: [s, s, s], mat: b.pick(['Chrome', 'Gold', 'Glass']) });
  }
  b.cam([0, 30, -60], yaw, b.r(2, 5), b.r(205, 225), 50);
  return 'Mesas';
}

function dunes(b: Builder) {
  const yaw = b.r(4, 20);
  b.sky(b.pick<Mood>(['sunset', 'sunset', 'golden', 'golden', 'afternoon', 'moon']), yaw);
  b.floor('Sand');
  b.land({ style: 'dunes', mat: 'Sand', drops: 0, smooth: 0.2, pos: [0, 0, -120], size: [620, b.r(30, 42), 620] });
  b.land({ style: 'dunes', mat: 'Sand', drops: 0, smooth: 0.2, pos: [120, 0, 300], size: [520, b.r(24, 32), 420] });
  const target: V3 = [0, 11, -70];
  const what = b.r(0, 1);
  if (what < 0.3) {
    // A row of monoliths marching into the distance.
    const m = b.pick(['Chrome', 'Gold', 'Granite']);
    for (let i = 0; i < 4; i++) {
      const x = -30 + i * 14, z = -20 - i * 55, hgt = b.r(44, 60);
      b.add('cube', undefined, { pos: [x, b.solid(x, z) + hgt / 2 - 3, z], size: [11, hgt, 11], rot: [0, b.r(0, 30), 0], mat: m });
    }
  } else if (what < 0.6) {
    const s = b.r(26, 40), x = b.r(-25, 25), z = b.r(-110, -60);
    b.add('sphere', undefined, { pos: [x, b.solid(x, z) + s * 0.42, z], size: [s, s, s], mat: b.pick(['Chrome', 'Gold', 'Glass']) });
  } else if (what < 0.8) {
    const x = b.r(-20, 20), z = b.r(-120, -70), s = b.r(36, 50);
    b.add('cone', undefined, { pos: [x, b.solid(x, z) + s * 0.4, z], size: [s * 1.3, s, s * 1.3], mat: b.pick(['Sand', 'Gold', 'Granite']) });
  }
  if (b.mood === 'moon') b.light('radial', [20, b.solid(20, 0) + 9, 0], WARM, 8, 30);
  b.cam(target, yaw, b.r(4, 7), b.r(160, 180), 55);
  return 'Dunes';
}

function peaks(b: Builder) {
  const yaw = b.r(0, 16);
  b.sky(b.pick<Mood>(['mist', 'mist', 'mist', 'golden', 'afternoon']), yaw);
  if (b.mood !== 'mist') Object.assign(b.scene.sky, { fog: b.r(0.35, 0.55), fogHeight: b.r(10, 16) });
  b.floor(b.pick(['Meadow', 'Meadow', 'Granite']));
  const m = b.pick(['Alpine', 'Alpine', 'Snow']);
  b.land({ pos: [0, 0, -60], size: b.jit([200, 105, 200], 0.12), mat: m });
  b.land({ pos: [-190, 0, -160], size: b.jit([220, 130, 220], 0.12), mat: m });
  b.land({ pos: [200, 0, -230], size: b.jit([260, 150, 260], 0.12), mat: m });
  b.land({ pos: [-110, 0, 90], size: b.jit([150, 60, 150], 0.12), mat: 'Alpine' });
  b.cam([0, 46, -60], yaw, b.r(5, 8), b.r(290, 310), 48);
  return 'Peaks in the mist';
}

function monoliths(b: Builder) {
  const yaw = b.r(3, 9);
  b.sky(b.pick<Mood>(['sunset', 'sunset', 'golden', 'golden', 'storm', 'afternoon', 'moon']), yaw);
  b.floor('Sand', -40);
  b.water(3);
  b.land({ pos: [b.r(-260, -200), 0, b.r(-320, -260)], size: b.jit([240, 70, 220], 0.15) });
  b.land({ pos: [b.r(230, 290), 0, b.r(-400, -340)], size: b.jit([300, 95, 240], 0.15) });
  const mats = [b.pick(['Chrome', 'Gold', 'Glass']), b.pick(['Chrome', 'Gold', 'Hammered Copper', 'Marble'])];
  if (b.mood === 'moon') b.light('radial', [b.r(-30, 30), 16, b.r(30, 60)], WARM, 9, 40);
  const layout = b.r(0, 1);
  if (layout < 0.4) {
    const n = b.ri(5, 6), w = b.r(13, 16), hgt = b.r(60, 76), turn = b.r(4, 20);
    const slab = [b.pick(['Chrome', 'Gold']), b.pick(['Chrome', 'Gold', 'Hammered Copper'])];
    for (let i = 0; i < n; i++) b.add('cube', undefined, { pos: [-33 + i * 13, 3 + hgt / 2 - 3, 8 - i * 62], size: [w, hgt, w], rot: [0, turn, 0], mat: slab[i % 2] });
    b.cam([-14, 26, -30], yaw, b.r(1, 4), 150, 46);
    return 'Monoliths';
  }
  if (layout < 0.7) {
    const s = b.r(46, 60);
    b.add('sphere', undefined, { pos: [0, 3 + s * b.r(0.55, 0.7), 0], size: [s, s, s], mat: mats[0] });
    for (let i = b.ri(0, 4); i > 0; i--) {
      const q = b.r(7, 13), [x, z] = b.toward([0, 0, 0], yaw, b.r(-70, 70), b.r(36, 60));
      b.add('sphere', undefined, { pos: [x, 3 + q * 0.5, z], size: [q, q, q], mat: mats[1] });
    }
    b.cam([0, 28, 0], yaw, b.r(1, 3), b.r(140, 160), 46);
    return 'Floating orb';
  }
  // A ring of pillars standing in the water around a centrepiece.
  const n = b.ri(5, 7), rad = b.r(38, 46), hgt = b.r(46, 62), shape = b.pick<ObjType>(['cylinder', 'cube', 'cone']), a0 = b.r(0, 6);
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    b.add(shape, undefined, { pos: [Math.cos(a) * rad, 3 + hgt / 2 - 3, Math.sin(a) * rad], size: [10, hgt, 10], mat: mats[1] });
  }
  b.add('sphere', undefined, { pos: [0, 3 + 13, 0], size: [22, 22, 22], mat: mats[0] });
  b.cam([0, 22, 0], yaw, b.r(4, 9), b.r(150, 170), 46);
  return 'Pillars in the sea';
}

function ice(b: Builder) {
  const yaw = b.r(-20, 20);
  b.sky(b.pick<Mood>(['afternoon', 'afternoon', 'golden', 'day', 'sunset']), yaw);
  b.scene.sky.haze = Math.max(b.scene.sky.haze, 0.34);
  b.floor('Granite', -60);
  b.water(3);
  b.land({ pos: [b.r(-80, 40), 0, -420], size: b.jit([700, 150, 300], 0.1), mat: 'Snow' });
  const placed: [number, number, number][] = [];
  for (let tries = 0; placed.length < 7 && tries < 80; tries++) {
    const x = b.r(-80, 80), z = b.r(-75, 75), w = b.r(14, 34);
    if (placed.some(([px, pz, pw]) => Math.hypot(px - x, pz - z) < (pw + w) * 0.75)) continue;
    placed.push([x, z, w]);
    const hgt = w * b.r(0.45, 0.7);
    b.add('cube', undefined, { pos: [x, 3 + hgt * 0.22, z], size: [w, hgt, w * b.r(0.75, 1.2)], rot: [b.r(-8, 8), b.r(0, 90), b.r(-8, 8)], mat: 'Ice' });
  }
  if (b.chance(0.6)) b.add('cone', undefined, { pos: [b.r(30, 55) * b.sign(), 14, b.r(-90, -60)], size: [26, 34, 26], rot: [4, 0, -6], mat: 'Ice' });
  b.cam([0, 8, 0], yaw, b.r(4, 8), b.r(140, 160), 50);
  return 'Ice field';
}

function gallery(b: Builder) {
  const yaw = b.r(0, 360);
  const night = b.chance(0.3);
  b.sky(night ? 'moon' : b.pick<Mood>(['day', 'day', 'afternoon', 'golden']), yaw);
  if (!night) b.scene.sky.haze = b.r(0.12, 0.2);
  const floors: Material[] = [
    { ...preset('Checker'), reflect: 0.28 },
    { ...preset('Marble'), reflect: 0.25 },
    { ...preset('Granite'), reflect: 0.2, specular: 0.5 },
    preset('Matte White'),
  ];
  b.floor(night ? floors[3] : b.pick(floors.slice(0, 3)));
  const shapes: ObjType[] = ['sphere', 'sphere', 'sphere', 'cube', 'cylinder', 'cone'];
  const allSpheres = b.chance(0.35);
  const placed: [number, number, number][] = [];
  const n = b.ri(4, 7);
  for (let tries = 0; placed.length < n && tries < 200; tries++) {
    // Big pieces first near the middle, small ones around them; the ring widens if it gets crowded.
    const s = placed.length < 3 ? b.r(18, 28) : b.r(8, 14);
    const [x, z] = b.toward([0, 0, 0], yaw, b.r(-180, 180), (placed.length < 3 ? b.r(0, 24) : b.r(20, night ? 30 : 40)) + tries * 0.15);
    if (placed.some(([px, pz, ps]) => Math.hypot(px - x, pz - z) < (ps + s) * 0.62)) continue;
    placed.push([x, z, s]);
    const type = allSpheres ? 'sphere' : b.pick(shapes);
    const tall = type === 'cylinder' || type === 'cone' ? b.r(1, 1.6) : 1;
    const mat = night && b.chance(0.7) ? preset('Matte White') : b.jewel();
    b.add(type, undefined, { pos: [x, (s * tall) / 2, z], size: [s, s * tall, s], rot: [0, type === 'cube' ? b.r(0, 90) : 0, 0], mat });
  }
  if (night) {
    const cols: V3[] = b.pick<V3[]>([
      [[1, 0.08, 0.05], [0.05, 1, 0.1], [0.08, 0.15, 1]],
      [[1, 0.5, 0.1], [0.1, 0.5, 1], [1, 0.1, 0.6]],
      [[1, 0.85, 0.6], [0.3, 0.6, 1], [1, 0.3, 0.15]],
    ]);
    const a0 = b.r(0, 6);
    cols.forEach((c, i) => {
      const a = a0 + (i / 3) * Math.PI * 2;
      b.light('spot', [Math.cos(a) * 15, 62, Math.sin(a) * 15], c, 16, 70, { cone: 27, soft: 0.25 });
    });
  }
  b.cam([0, 9, 0], yaw, night ? b.r(26, 34) : b.r(12, 22), b.r(92, 110), 41);
  return night ? 'Spotlit studio' : 'Still life';
}

function temple(b: Builder) {
  const yaw = b.r(-32, 32);
  b.sky(b.pick<Mood>(['golden', 'golden', 'afternoon', 'sunset', 'day', 'mist']), yaw);
  const desert = b.chance(0.3);
  b.floor(desert ? 'Sand' : 'Meadow');
  b.land({ pos: [b.r(-80, 80), 0, -430], size: b.jit([900, 170, 380], 0.1), mat: desert ? 'Red Strata' : b.pick(['Alpine', 'Snow']), style: desert ? 'mesa' : 'mountain' });
  const stone = (): Material => {
    if (desert) return preset('Granite');
    const m = preset('Marble');
    if (m.texA) Object.assign(m.texA.comps[0], { colors: [[0.9, 0.88, 0.84], [0.84, 0.82, 0.79], [0.55, 0.56, 0.6]], phase: 0.9, fa: 5 });
    return m;
  };
  const roof = b.chance(0.6);
  const n = roof ? 6 : b.ri(6, 8), rad = b.r(30, 36), hgt = b.r(34, 44), a0 = b.r(0, 6);
  b.add('cylinder', undefined, { pos: [0, 2.5, 0], size: [rad * 2 + 20, 5, rad * 2 + 20], mat: stone() });
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    b.add('cylinder', undefined, { pos: [Math.cos(a) * rad, 5 + hgt / 2, Math.sin(a) * rad], size: [7.5, hgt, 7.5], mat: stone() });
  }
  if (roof) {
    const y = 5 + hgt + 2.5;
    b.add('cylinder', undefined, { pos: [0, y, 0], size: [rad * 2 + 16, 5, rad * 2 + 16], mat: stone(), bool: 'positive', group: 1 });
    b.add('cylinder', undefined, { pos: [0, y, 0], size: [rad * 2 - 10, 12, rad * 2 - 10], mat: stone(), bool: 'negative', group: 1 });
  }
  const s = b.r(16, 24);
  b.add('sphere', undefined, { pos: [0, 5 + s * b.r(0.5, 0.8), 0], size: [s, s, s], mat: b.pick(['Gold', 'Gold', 'Chrome', 'Glass']) });
  b.cam([0, 21, 0], yaw, b.r(2, 5), b.r(128, 145), 44);
  return desert ? 'Desert shrine' : 'Temple';
}

const RECIPES = [island, island, lake, mesas, dunes, peaks, monoliths, monoliths, ice, gallery, gallery, temple];
let last: unknown = null;

/** Build a new random scene. The same seed always gives the same scene. */
export function randomScene(seed = Math.floor(Math.random() * 0xffffffff)): { scene: Scene; name: string } {
  const rand = rng(seed);
  let recipe = RECIPES[Math.floor(rand() * RECIPES.length)];
  // Don't serve the same kind of scene twice in a row.
  while (recipe === last) recipe = RECIPES[Math.floor(rand() * RECIPES.length)];
  last = recipe;
  const b = new Builder(rand);
  const kind = recipe(b);
  return { scene: b.scene, name: `${kind}, ${MOOD_NAMES[b.mood]}` };
}
