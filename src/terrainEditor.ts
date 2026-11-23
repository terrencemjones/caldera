import type { App } from './app';
import { Scene, SceneObject, defaultScene } from './scene';
import { HM, heightmap, genTerrain, setMap, putMap, TerrainStyle } from './terrain';
import { OPS, stamp, fromImage, BrushMode } from './terrainOps';
import { Ctx, h, slider, button, seg, modal, dragPad } from './widgets';
import { clamp } from './math';

const WORK = 'editing';
const MODES: BrushMode[] = ['raise', 'lower', 'flatten', 'smooth'];
const STYLES: [TerrainStyle, string][] = [['mountain', 'Peaks'], ['hills', 'Hills'], ['mesa', 'Mesa'], ['dunes', 'Dunes']];

/** The terrain editor: a height canvas to paint on, filters, and a live 3D preview. */
export function openTerrainEditor(app: App, target: SceneObject) {
  const tp = target.terrain!;
  const map = heightmap(target.id, tp).slice();
  setMap(WORK, map);
  let rev = 1;
  const undo: Float32Array[] = [];
  let amount = 0.4, size = 0.25, strength = 0.5, mode = 0;

  // Preview: this terrain alone, under the scene's own sky.
  const pscene: Scene = defaultScene();
  const tObj: SceneObject = structuredClone(target);
  tObj.id = -2;
  tObj.pos = [0, 0, 0];
  tObj.rot = [0, 0, 0];
  tObj.terrain = { ...tp, map: WORK, rev };
  pscene.objects = [tObj];
  pscene.sky = { ...structuredClone(app.store.scene.sky), fog: 0 };
  const span = Math.max(tObj.size[0], tObj.size[2]);
  pscene.camera = { target: [0, tObj.size[1] * 0.3, 0], yaw: 0.6, pitch: 0.45, dist: span * 1.5, fov: 40 };

  const pcanvas = h('canvas', 'te-preview');
  pcanvas.width = 360;
  pcanvas.height = 270;
  const canvas = h('canvas', 'te-map');
  canvas.width = HM;
  canvas.height = HM;
  const c2d = canvas.getContext('2d')!;
  const img = c2d.createImageData(HM, HM);

  let pv: ReturnType<App['preview']> | null = null;

  const paint = () => {
    const d = img.data;
    for (let i = 0; i < map.length; i++) {
      const v = map[i];
      // Grey with a little warmth in the highlights, so shapes read at a glance.
      d[i * 4] = Math.min(255, v * 262);
      d[i * 4 + 1] = v * 250;
      d[i * 4 + 2] = v * 236 + 8;
      d[i * 4 + 3] = 255;
    }
    c2d.putImageData(img, 0, 0);
  };
  const changed = () => {
    tObj.terrain!.rev = ++rev;
    paint();
    pv?.refresh();
  };
  const checkpoint = () => {
    undo.push(map.slice());
    if (undo.length > 24) undo.shift();
  };
  const apply = (fn: () => void) => {
    checkpoint();
    fn();
    changed();
  };

  const ctx: Ctx = { changed: () => {}, commit: () => {}, sync: [] };

  const win = modal('Terrain', () => {
    tp.map = putMap(map.slice());
    delete tp.rev;
    app.store.touch('structure');
    app.store.commit();
  }, () => {
    pv?.close();
    window.removeEventListener('keydown', key, true);
  });
  win.el.classList.add('te');

  const key = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      undoOnce();
    }
  };
  window.addEventListener('keydown', key, true);
  const undoOnce = () => {
    const u = undo.pop();
    if (!u) return;
    map.set(u);
    changed();
  };

  // ---- painting
  let level = 0;
  let last: [number, number] | null = null;
  const at = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * (HM - 1), ((e.clientY - r.top) / r.height) * (HM - 1)];
  };
  const dab = (x: number, y: number) => stamp(map, x, y, 4 + size * 90, 0.15 + strength, MODES[mode], level);
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    checkpoint();
    const [x, y] = at(e);
    level = map[clamp(Math.round(y), 0, HM - 1) * HM + clamp(Math.round(x), 0, HM - 1)];
    last = [x, y];
    dab(x, y);
    changed();
  });
  dragPad(canvas, (_dx, _dy, e) => {
    const [x, y] = at(e);
    if (!last) last = [x, y];
    // Stamp along the stroke so fast strokes don't leave gaps.
    const dist = Math.hypot(x - last[0], y - last[1]);
    const gap = Math.max(1.5, (4 + size * 90) * 0.25);
    const n = Math.max(1, Math.floor(dist / gap));
    for (let i = 1; i <= n; i++) dab(last[0] + ((x - last[0]) * i) / n, last[1] + ((y - last[1]) * i) / n);
    last = [x, y];
    changed();
  }, () => (last = null));

  dragPad(pcanvas, (dx, dy) => {
    const c = pscene.camera;
    c.yaw -= dx * 0.01;
    c.pitch = clamp(c.pitch + dy * 0.01, 0.05, 1.5);
    pv?.refresh();
  });
  pcanvas.title = 'Drag to turn the preview';

  // ---- controls
  const filters = h('div', 'te-ops', ...Object.keys(OPS).map((name) => button(name, () => apply(() => OPS[name](map, amount)), 'btn small')));
  const file = h('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      const data = await fromImage(f);
      apply(() => map.set(data));
    } catch {
      app.say('That file could not be read as an image.');
    }
    file.value = '';
  });

  const left = h('div', 'te-col',
    h('div', 'cap head', 'New shape'),
    h('div', 'row2', ...STYLES.map(([s, label]) =>
      button(label, () => apply(() => map.set(genTerrain({ seed: Math.floor(Math.random() * 1e6), style: s, rough: tp.rough }))), 'btn small'))),
    button('From a picture…', () => file.click(), 'btn small'), file,
    h('div', 'cap head', 'Filters'),
    slider(ctx, 'Amount', () => amount, (v) => (amount = v)),
    filters,
    h('div', 'hint block', 'Each click applies the filter once at the chosen amount. Erode runs simulated rain over the surface.'),
  );
  const right = h('div', 'te-col',
    h('div', 'nano-frame', pcanvas),
    h('div', 'cap head', 'Brush'),
    seg(ctx, ['Raise', 'Lower', 'Flatten', 'Smooth'], () => mode, (i) => (mode = i)),
    slider(ctx, 'Size', () => size, (v) => (size = v)),
    slider(ctx, 'Strength', () => strength, (v) => (strength = v)),
    h('div', 'hint block', 'Paint on the height map: white is high, black is low. Flatten levels to the height where the stroke starts.'),
    button('Undo', undoOnce, 'btn small', 'Ctrl+Z'),
  );
  win.body.append(left, h('div', 'te-mapwrap', canvas), right);

  paint();
  pv = app.preview(pcanvas, () => pscene);
}
