import './style.css';
import { Store, Scene, makeObject, MAX_OBJECTS, MAX_TERRAINS, MAX_LIGHTS } from './scene';
import { Renderer, View } from './render/renderer';
import { drawWire, pick } from './wire';
import { basis, screenRay } from './camera';
import { buildUI } from './ui';
import type { App, PreviewHandle } from './app';
import { V3, add, mul, clamp, norm } from './math';
import { applyTime, snapTime } from './anim';
import { loadMaps } from './terrain';
import { randomScene } from './random';
import { openMaterialLab } from './lab';
import { openTerrainEditor } from './terrainEditor';
import { makeEncoder } from './video';
import { modalOpen } from './widgets';

const store = new Store();
const stage = document.getElementById('stage') as HTMLCanvasElement;
const nano = document.getElementById('nano') as HTMLCanvasElement;
const wrap = document.getElementById('stagewrap')!;
const sctx = stage.getContext('2d')!;
const nctx = nano.getContext('2d')!;

let renderer: Renderer;
try {
  renderer = new Renderer();
} catch (e) {
  const box = document.createElement('div');
  box.className = 'fatal';
  box.textContent = String(e instanceof Error ? e.message : e);
  document.body.append(box);
  throw e;
}

// The tracing shader builds in the background; nothing is ray traced until it is ready.
let ready = false;
renderer.ready().then(
  () => {
    ready = true;
    invalidate();
  },
  (e) => {
    const box = document.createElement('div');
    box.className = 'fatal';
    box.textContent = String(e instanceof Error ? e.message : e);
    document.body.append(box);
  },
);

let mode: 'wire' | 'render' = 'wire';
let mainView: View | null = null;
let nanoView: View | null = null;
let wireDirty = true;
let flash = '';
let flashUntil = 0;
let playing = false;
/** Set while a movie is rendering; the frame loop leaves the main view alone. */
let movie: { cancel: boolean; text: string } | null = null;

interface Preview {
  ctx: CanvasRenderingContext2D;
  view: View;
  scene: () => Scene;
  dirty: boolean;
}
const previews: Preview[] = [];

function say(text: string) {
  flash = text;
  flashUntil = performance.now() + 3500;
}

const cam = () => store.scene.camera;
const count = (pred: (t: string) => boolean) => store.scene.objects.filter((o) => pred(o.type)).length;

/** Explain and refuse if the scene has no room for another object of this type. */
function roomFor(type: string): boolean {
  if (type === 'light') {
    if (count((t) => t === 'light') >= MAX_LIGHTS) return say(`A scene can hold ${MAX_LIGHTS} lights for now.`), false;
    return true;
  }
  if (count((t) => t !== 'light') >= MAX_OBJECTS) return say(`A scene can hold ${MAX_OBJECTS} objects for now.`), false;
  if (type === 'terrain' && count((t) => t === 'terrain') >= MAX_TERRAINS) return say(`A scene can hold ${MAX_TERRAINS} terrains for now.`), false;
  return true;
}

const app: App = {
  store,
  say,
  randomize() {
    if (movie) return;
    if (playing) app.stop();
    say('Generating a scene…');
    // Let the message paint before the terrain work blocks for a moment.
    setTimeout(() => {
      const { scene, name } = randomScene();
      store.selected = null;
      store.load(scene);
      app.setMode('render');
      say(`Random scene: ${name}. Press G for another, Ctrl+Z to go back.`);
    }, 30);
  },
  mode: () => mode,
  setMode(m) {
    if (movie) return;
    mode = m;
    if (m === 'render' && mainView) renderer.show(mainView, store.scene);
    wireDirty = true;
    ui.modeChanged();
  },
  add(type, kind) {
    if (!roomFor(type)) return;
    const o = makeObject(store.scene, type, kind);
    store.scene.objects.push(o);
    store.selected = o.id;
    store.touch('structure');
    store.commit();
  },
  del() {
    const o = store.sel;
    if (!o) return;
    store.scene.objects = store.scene.objects.filter((x) => x !== o);
    store.selected = null;
    store.touch('structure');
    store.commit();
  },
  dup() {
    const o = store.sel;
    if (!o || !roomFor(o.type)) return;
    const c = structuredClone(o);
    c.id = store.scene.nextId++;
    c.name = o.name + ' copy';
    if (c.type !== 'plane') c.pos = [c.pos[0] + c.size[0] * 0.6, c.pos[1], c.pos[2] + c.size[2] * 0.3];
    else c.pos = [c.pos[0], c.pos[1] + 2, c.pos[2]];
    store.scene.objects.push(c);
    store.selected = c.id;
    store.touch('structure');
    store.commit();
  },
  saveImage() {
    if (mode !== 'render') return say('Render the scene first, then save the image.');
    stage.toBlob((blob) => blob && download(blob, 'render.png'), 'image/png');
  },
  orbit(dx, dy) {
    const c = cam();
    c.yaw -= dx * 0.006;
    c.pitch = clamp(c.pitch + dy * 0.006, -0.35, 1.55);
    store.touch('camera');
  },
  pan(dx, dy) {
    const c = cam();
    const b = basis(c);
    const k = c.dist * 0.0016;
    const f = norm([b.fwd[0], 0, b.fwd[2]]);
    c.target = add(add(c.target, mul([b.right[0], 0, b.right[2]], -dx * k)), mul(f, dy * k));
    store.touch('camera');
  },
  lift(dy) {
    const c = cam();
    c.target = [c.target[0], c.target[1] - dy * c.dist * 0.0016, c.target[2]];
    store.touch('camera');
  },
  zoom(dy) {
    const c = cam();
    c.dist = clamp(c.dist * Math.exp(dy * 0.005), 4, 3000);
    store.touch('camera');
  },
  camDone() {
    store.commit(false);
  },
  preview(canvas, scene): PreviewHandle {
    const p: Preview = {
      ctx: canvas.getContext('2d')!,
      view: renderer.createView(canvas.width, canvas.height, [8, 4, 2], 4, 140),
      scene,
      dirty: true,
    };
    p.view.rows = canvas.height;
    previews.push(p);
    return {
      refresh: () => (p.dirty = true),
      close: () => {
        const i = previews.indexOf(p);
        if (i >= 0) previews.splice(i, 1);
        renderer.destroyView(p.view);
        // The main views were paused; pick them back up.
        invalidate();
      },
    };
  },
  setTime(t) {
    applyTime(store.scene, t);
    store.rebase();
    store.touch('time');
  },
  play() {
    if (movie) return;
    if (store.scene.anim.time >= store.scene.anim.duration - 1e-6) app.setTime(0);
    playing = true;
    store.touch('time');
  },
  stop() {
    if (!playing) return;
    playing = false;
    app.setTime(snapTime(store.scene.anim, store.scene.anim.time));
    store.commit(false);
  },
  playing: () => playing,
  renderMovie,
  editTerrain() {
    const o = store.sel;
    if (!o || o.type !== 'terrain') return say('Select a terrain to edit it.');
    app.stop();
    openTerrainEditor(app, o);
  },
  editMaterial() {
    const o = store.sel;
    if (!o || o.type === 'light') return say('Select an object to edit its material.');
    app.stop();
    openMaterialLab(app, o);
  },
};

const ui = buildUI(app);

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function invalidate() {
  if (nanoView) renderer.show(nanoView, store.scene);
  if (mode === 'render' && mainView && !movie) renderer.show(mainView, store.scene);
  wireDirty = true;
}

store.on((c) => {
  if (c !== 'select') invalidate();
  else wireDirty = true;
  ui.sync(c);
});

// Hand-edited terrains load a moment after the page does.
const mapKeys = () => store.scene.objects.map((o) => o.terrain?.map).filter((k): k is string => !!k);
loadMaps(mapKeys()).then((loaded) => loaded && store.touch('structure'));

// ---------------------------------------------------------------- sizing
function resize() {
  if (movie) return;
  const r = wrap.getBoundingClientRect();
  const cw = Math.max(64, Math.floor(r.width)), ch = Math.max(64, Math.floor(r.height));
  let scale = Math.min(window.devicePixelRatio || 1, 2);
  const maxPixels = 2.4e6;
  if (cw * ch * scale * scale > maxPixels) scale = Math.sqrt(maxPixels / (cw * ch));
  const w = Math.round(cw * scale), h = Math.round(ch * scale);
  if (mainView && mainView.w === w && mainView.h === h) return;
  stage.width = w;
  stage.height = h;
  if (mainView) renderer.destroyView(mainView);
  mainView = renderer.createView(w, h, [32, 16, 8, 4, 2], 12, 220);

  const nw = 416, nh = Math.max(40, Math.round((nw * h) / w));
  nano.width = nw;
  nano.height = nh;
  if (nanoView) renderer.destroyView(nanoView);
  nanoView = renderer.createView(nw, nh, [8, 4, 2], 3, 110);
  nanoView.rows = nh;
  invalidate();
}
new ResizeObserver(resize).observe(wrap);
resize();

// ---------------------------------------------------------------- pointer
type Drag =
  | { kind: 'orbit' }
  | { kind: 'pan' }
  | { kind: 'move'; id: number; start: V3; grab: V3; planeY: number; moved: boolean };

let drag: Drag | null = null;
let downAt = [0, 0];

function canvasXY(e: PointerEvent | WheelEvent): [number, number] {
  const r = stage.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * stage.width, ((e.clientY - r.top) / r.height) * stage.height];
}

/** Where the ray through a pixel meets a horizontal plane, if it does in front of the camera. */
function groundPoint(x: number, y: number, planeY: number): V3 | null {
  const ray = screenRay(basis(cam()), stage.width, stage.height, x, y);
  if (Math.abs(ray.d[1]) < 1e-4) return null;
  const t = (planeY - ray.o[1]) / ray.d[1];
  if (t <= 0 || t > 5000) return null;
  return add(ray.o, mul(ray.d, t));
}

stage.addEventListener('contextmenu', (e) => e.preventDefault());

stage.addEventListener('pointerdown', (e) => {
  if (movie) return;
  stage.setPointerCapture(e.pointerId);
  const [x, y] = canvasXY(e);
  downAt = [e.clientX, e.clientY];
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    drag = { kind: 'pan' };
    return;
  }
  if (e.button === 2 || mode === 'render') {
    drag = { kind: 'orbit' };
    return;
  }
  const hit = pick(store.scene, stage.width, stage.height, x, y);
  if (hit) {
    store.select(hit.id);
    const o = store.sel!;
    drag = { kind: 'move', id: o.id, start: [...o.pos] as V3, grab: hit.point, planeY: hit.point[1], moved: false };
  } else {
    drag = { kind: 'orbit' };
  }
});

stage.addEventListener('pointermove', (e) => {
  const d = drag;
  if (!d) return;
  const dx = e.movementX, dy = e.movementY;
  if (d.kind === 'orbit') return app.orbit(dx, dy);
  if (d.kind === 'pan') return app.pan(dx, dy);
  const o = store.scene.objects.find((q) => q.id === d.id);
  if (!o) return;
  if (!d.moved && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4) return;
  d.moved = true;
  if (o.type === 'plane' || e.altKey) {
    o.pos[1] -= dy * cam().dist * 0.0016;
  } else {
    const [x, y] = canvasXY(e);
    const p = groundPoint(x, y, d.planeY);
    if (p) {
      o.pos[0] = d.start[0] + p[0] - d.grab[0];
      o.pos[2] = d.start[2] + p[2] - d.grab[2];
    }
  }
  store.touch('scene');
});

const endDrag = (e: PointerEvent) => {
  if (!drag) return;
  const still = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 4;
  if (drag.kind === 'move') store.commit();
  else {
    if (still && drag.kind === 'orbit' && mode === 'wire' && e.button === 0) store.select(null);
    store.commit(false);
  }
  drag = null;
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

let wheelTimer = 0;
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (movie) return;
  app.zoom(e.deltaY * 0.25);
  clearTimeout(wheelTimer);
  wheelTimer = window.setTimeout(() => store.commit(false), 300);
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (movie) {
    if (e.key === 'Escape') movie.cancel = true;
    return;
  }
  if (modalOpen()) return;
  const t = e.target as HTMLElement;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); store.undo(); }
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); app.dup(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); app.del(); }
  else if (e.key === ' ') { e.preventDefault(); if (playing) app.stop(); else app.play(); }
  else if (e.key.toLowerCase() === 'r' && !mod) app.setMode(mode === 'render' ? 'wire' : 'render');
  else if (e.key.toLowerCase() === 'g' && !mod) app.randomize();
  else if (e.key === 'Escape') { if (mode === 'render') app.setMode('wire'); else store.select(null); }
});

// ---------------------------------------------------------------- movie
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

async function renderMovie() {
  if (movie || !mainView) return;
  app.stop();
  const a = store.scene.anim;
  const v = mainView;
  const enc = await makeEncoder(v.w, v.h, a.fps);
  if (!enc) return say('This browser cannot encode video, so the movie cannot be made here.');
  const frames = Math.round(a.duration * a.fps) + 1;
  const startTime = a.time;
  movie = { cancel: false, text: '' };
  mode = 'render';
  ui.modeChanged();
  // Frames are cropped to even dimensions for the encoder.
  const crop = document.createElement('canvas');
  crop.width = enc.width;
  crop.height = enc.height;
  const cctx = crop.getContext('2d')!;
  try {
    for (let i = 0; i < frames && !movie.cancel; i++) {
      movie.text = `Rendering movie: frame ${i + 1} of ${frames}. Press Esc to cancel.`;
      ui.progress(i / frames);
      applyTime(store.scene, i / a.fps);
      renderer.show(v, store.scene);
      while (!v.done && !movie.cancel) {
        renderer.step(v);
        renderer.present(v, sctx);
        await nextFrame();
      }
      if (movie.cancel) break;
      renderer.present(v, sctx);
      cctx.drawImage(stage, 0, 0);
      await enc.add(crop, i);
    }
    if (movie.cancel) say('Movie cancelled.');
    else {
      download(await enc.finish(), 'movie.mp4');
      say('Movie saved as movie.mp4.');
    }
  } catch (e) {
    say('The movie could not be encoded: ' + (e instanceof Error ? e.message : String(e)));
  } finally {
    movie = null;
    app.setTime(startTime);
  }
}

// ---------------------------------------------------------------- frame loop
let lastT = performance.now();

function frame(now: number) {
  const dt = now - lastT;
  lastT = now;
  requestAnimationFrame(frame);

  if (!ready) {
    if (wireDirty) {
      drawWire(sctx, store.scene, store.selected);
      wireDirty = false;
    }
    ui.status('Preparing the renderer. The first launch can take a little while…');
    return;
  }

  // Editor previews take over the renderer while they are open.
  if (previews.length) {
    for (const p of previews) {
      if (p.dirty) {
        renderer.show(p.view, p.scene());
        p.dirty = false;
      }
      if (!p.view.done) {
        for (let i = 0; i < 2 && renderer.step(p.view); i++);
        renderer.present(p.view, p.ctx);
      }
    }
    return;
  }
  if (movie) {
    ui.status(movie.text);
    return;
  }

  if (playing) {
    const a = store.scene.anim;
    let t = a.time + Math.min(dt, 100) / 1000;
    if (t >= a.duration) t = 0;
    app.setTime(t);
  }

  if (nanoView && !nanoView.done) {
    for (let i = 0; i < 2 && renderer.step(nanoView); i++);
    renderer.present(nanoView, nctx);
  }

  let status = '';
  if (mode === 'render' && mainView) {
    const v = mainView;
    if (!v.done) {
      // Keep the page responsive: shrink the band when frames run long, grow it when there is headroom.
      if (v.stage >= v.blocks.length) {
        if (dt > 70) v.rows = Math.max(8, Math.floor(v.rows / 2));
        else if (dt < 30) v.rows = Math.min(v.h, Math.ceil(v.rows * 1.25));
      }
      renderer.step(v);
      renderer.present(v, sctx);
    }
    const total = renderer.stages(v);
    const k = v.stage - v.blocks.length;
    ui.progress(v.done ? 1 : (v.stage + v.row / v.h) / total);
    status = v.done
      ? 'Render complete'
      : k < 0
        ? `Rendering: coarse pass ${v.stage + 1} of ${v.blocks.length}`
        : k === 0
          ? 'Rendering: full resolution'
          : `Rendering: smoothing pass ${k} of ${v.aa}`;
    if (v.packed?.overflow) status += ' (too many different textures; some are shown plain)';
  } else {
    ui.progress(0);
    if (wireDirty) {
      drawWire(sctx, store.scene, store.selected);
      wireDirty = false;
    }
    const o = store.sel;
    status = o ? `${o.name} selected` : 'Wireframe view';
  }
  ui.status(now < flashUntil ? flash : status);
}
requestAnimationFrame(frame);

// Handy for poking at things from the console.
(window as unknown as { app: App }).app = app;
