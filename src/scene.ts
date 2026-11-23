import type { V3 } from './math';
import { Material, preset } from './materials';
import { Sky, SKY_PRESETS } from './sky';
import type { TerrainParams } from './terrain';
import { Anim, autoKey, snapshot, newAnim } from './anim';
import { projectName } from './names';

export type ObjType = 'plane' | 'sphere' | 'cube' | 'cylinder' | 'cone' | 'terrain' | 'light';
export type BoolMode = 'neutral' | 'positive' | 'negative' | 'intersect';
export type LightKind = 'radial' | 'spot' | 'parallel';

export interface LightParams {
  kind: LightKind;
  color: V3;
  power: number;
  /** Distance at which the light has fallen to half strength. */
  range: number;
  /** Spotlight cone half-angle in degrees. */
  cone: number;
  /** Softness of the spotlight edge, 0..1. */
  soft: number;
  /** 0 none, 1 linear, 2 squared. */
  falloff: number;
  shadows: boolean;
}

export interface SceneObject {
  id: number;
  name: string;
  type: ObjType;
  pos: V3;
  rot: V3;
  size: V3;
  mat: Material;
  /** Objects with the same non-zero group combine by their boolean mode. */
  bool: BoolMode;
  group: number;
  terrain?: TerrainParams;
  light?: LightParams;
}

export interface Camera {
  target: V3;
  yaw: number;
  pitch: number;
  dist: number;
  fov: number;
}

export interface Scene {
  /** The project's name, generated when the scene is created. */
  name: string;
  objects: SceneObject[];
  sky: Sky;
  camera: Camera;
  views: (Camera | null)[];
  anim: Anim;
  nextId: number;
}

export const MAX_OBJECTS = 12;
export const MAX_TERRAINS = 4;
export const MAX_LIGHTS = 6;

/** Per-axis scale that maps the unit primitive onto the object's size. */
export function objScale(o: SceneObject): V3 {
  if (o.type === 'plane') return [o.size[0] / 2, 1, o.size[2] / 2];
  if (o.type === 'terrain') return [o.size[0] / 2, Math.max(0.01, o.size[1]), o.size[2] / 2];
  return [Math.max(0.01, o.size[0] / 2), Math.max(0.01, o.size[1] / 2), Math.max(0.01, o.size[2] / 2)];
}

export function makeObject(scene: Scene, type: ObjType, kind?: 'water' | LightKind): SceneObject {
  const id = scene.nextId++;
  const t = scene.camera.target;
  const label = type === 'light' ? `${kind} light` : type;
  const count = scene.objects.filter((o) => o.type === type).length + 1;
  const o: SceneObject = {
    id,
    type,
    name: `${label[0].toUpperCase()}${label.slice(1)} ${count}`,
    pos: [Math.round(t[0]), 10, Math.round(t[2])],
    rot: [0, 0, 0],
    size: [20, 20, 20],
    mat: preset('Matte White'),
    bool: 'neutral',
    group: 0,
  };
  if (type === 'plane') {
    o.pos = [0, kind === 'water' ? 3 : 0, 0];
    o.size = [300, 0, 300];
    o.mat = preset(kind === 'water' ? 'Deep Water' : 'Sand');
    o.name = kind === 'water' ? `Water ${count}` : `Ground ${count}`;
  } else if (type === 'terrain') {
    o.pos = [Math.round(t[0]), 0, Math.round(t[2])];
    o.size = [140, 42, 140];
    o.mat = preset('Alpine');
    o.terrain = { seed: Math.floor(Math.random() * 1e6), style: 'mountain', rough: 0.5 };
  } else if (type === 'light') {
    const k = (kind as LightKind) ?? 'radial';
    o.pos = [Math.round(t[0]), 40, Math.round(t[2])];
    o.size = [8, 8, 8];
    o.light = { kind: k, color: [1, 0.9, 0.75], power: 3, range: 40, cone: 25, soft: 0.3, falloff: k === 'parallel' ? 0 : 2, shadows: true };
  }
  return o;
}

export function defaultScene(): Scene {
  const scene: Scene = {
    name: projectName(),
    objects: [],
    sky: { ...structuredClone(SKY_PRESETS[1].sky), sunAz: 285, sunEl: 24, haze: 0.28 },
    camera: { target: [0, 13, 0], yaw: 0.35, pitch: 0.1, dist: 175, fov: 50 },
    views: [null, null, null, null, null],
    anim: newAnim(),
    nextId: 1,
  };
  const ground = makeObject(scene, 'plane');
  const water = makeObject(scene, 'plane', 'water');
  const land = makeObject(scene, 'terrain');
  land.terrain = { seed: 4242, style: 'mountain', rough: 0.5 };
  const ball = makeObject(scene, 'sphere');
  ball.pos = [34, 13, 66];
  ball.size = [13, 13, 13];
  ball.mat = preset('Chrome');
  scene.objects.push(ground, water, land, ball);
  return scene;
}

export type Change = 'scene' | 'camera' | 'select' | 'structure' | 'time';

const KEY = 'caldera.scene.v2';

export class Store {
  scene: Scene;
  selected: number | null = null;
  private subs: ((c: Change) => void)[] = [];
  private undoStack: string[] = [];
  /** Undo steps that replaced the whole scene, so undoing them restores the camera too. */
  private wholeScene = new Set<string>();
  private last: string;
  /** Animatable state as of the last commit or time change, for auto-keying. */
  private baseline = new Map<string, number[]>();

  constructor() {
    let s: Scene | null = null;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(KEY);
      if (raw) s = JSON.parse(raw) as Scene;
    } catch {
      s = null;
    }
    this.scene = s && Array.isArray(s.objects) && s.anim ? s : defaultScene();
    // Scenes saved before projects had names get one now.
    if (!this.scene.name) this.scene.name = projectName();
    this.last = JSON.stringify(this.scene);
    // Save straight away so a new project keeps its name even if it is closed unedited.
    if (this.last !== raw) this.save();
    this.rebase();
  }

  on(fn: (c: Change) => void) {
    this.subs.push(fn);
  }

  /** Announce a change so views redraw. Does not record undo or save. */
  touch(c: Change) {
    for (const f of this.subs) f(c);
  }

  /** Forget pending differences, e.g. after the timeline moved everything. */
  rebase() {
    this.baseline = snapshot(this.scene);
  }

  /** Save, and record an undo step unless the change was only a camera move. */
  commit(undoable = true) {
    const keyed = autoKey(this.scene, this.baseline);
    this.rebase();
    const s = JSON.stringify(this.scene);
    if (s === this.last) return;
    if (undoable || keyed) {
      this.undoStack.push(this.last);
      if (this.undoStack.length > 80) this.undoStack.shift();
    }
    this.last = s;
    this.save();
    if (keyed) this.touch('time');
  }

  private save() {
    try {
      localStorage.setItem(KEY, this.last);
    } catch {
      /* storage unavailable: the scene just won't persist */
    }
  }

  undo(): boolean {
    const s = this.undoStack.pop();
    if (!s) return false;
    const cam = this.wholeScene.has(s) ? null : this.scene.camera;
    const hadCamTrack = !!this.scene.anim.tracks.camera;
    this.scene = JSON.parse(s) as Scene;
    // Camera moves aren't undo steps, unless the camera is animated.
    if (cam && !hadCamTrack && !this.scene.anim.tracks.camera) this.scene.camera = cam;
    this.last = JSON.stringify(this.scene);
    this.save();
    this.rebase();
    if (!this.sel) this.selected = null;
    this.touch('structure');
    return true;
  }

  reset() {
    this.load(defaultScene());
  }

  /** Replace the whole scene as one undoable step. */
  load(scene: Scene) {
    this.undoStack.push(this.last);
    this.wholeScene.add(this.last);
    if (this.wholeScene.size > 200) this.wholeScene.clear();
    this.scene = scene;
    this.selected = null;
    this.rebase();
    this.last = JSON.stringify(this.scene);
    this.save();
    this.touch('structure');
  }

  get sel(): SceneObject | undefined {
    return this.scene.objects.find((o) => o.id === this.selected);
  }

  select(id: number | null) {
    if (this.selected === id) return;
    this.selected = id;
    this.touch('select');
  }
}
