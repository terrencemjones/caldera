import type { Store, Scene, ObjType, LightKind } from './scene';

export interface PreviewHandle {
  /** Re-read the scene and start the preview render again. */
  refresh(): void;
  close(): void;
}

/** What the interface can ask the application to do. */
export interface App {
  store: Store;
  mode(): 'wire' | 'render';
  setMode(m: 'wire' | 'render'): void;
  add(type: ObjType, kind?: 'water' | LightKind): void;
  del(): void;
  dup(): void;
  saveImage(): void;
  orbit(dx: number, dy: number): void;
  pan(dx: number, dy: number): void;
  lift(dy: number): void;
  zoom(dy: number): void;
  camDone(): void;
  say(text: string): void;
  /** Replace the scene with a freshly generated random one and render it. */
  randomize(): void;
  /** Ray trace a small scene into a canvas; the main views pause while any preview is open. */
  preview(canvas: HTMLCanvasElement, scene: () => Scene): PreviewHandle;
  setTime(t: number): void;
  play(): void;
  stop(): void;
  playing(): boolean;
  renderMovie(): void;
  editTerrain(): void;
  editMaterial(): void;
}
