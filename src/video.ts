import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

export interface MovieEncoder {
  width: number;
  height: number;
  add(source: CanvasImageSource, index: number): Promise<void>;
  finish(): Promise<Blob>;
}

const CODECS: { codec: string; mux: 'avc' | 'vp9' | 'av1' }[] = [
  { codec: 'avc1.640033', mux: 'avc' },
  { codec: 'avc1.42003e', mux: 'avc' },
  { codec: 'vp09.00.40.08', mux: 'vp9' },
  { codec: 'av01.0.08M.08', mux: 'av1' },
];

/** Set up an MP4 encoder using whichever video codec this browser can encode, or null if none. */
export async function makeEncoder(w: number, h: number, fps: number): Promise<MovieEncoder | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  // H.264 needs even dimensions; the odd row or column is cropped off.
  const width = w & ~1, height = h & ~1;
  let pick: (typeof CODECS)[number] | null = null;
  const base = { width, height, bitrate: Math.min(40e6, width * height * fps * 0.25), framerate: fps };
  for (const c of CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec: c.codec, ...base });
      if (r.supported) {
        pick = c;
        break;
      }
    } catch {
      /* try the next one */
    }
  }
  if (!pick) return null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: pick.mux, width, height }, fastStart: 'in-memory' });
  let failed: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failed = e),
  });
  enc.configure({ codec: pick.codec, ...base });
  const frameUs = 1e6 / fps;

  return {
    width,
    height,
    async add(source, index) {
      if (failed) throw failed;
      const frame = new VideoFrame(source, { timestamp: Math.round(index * frameUs), duration: Math.round(frameUs) });
      enc.encode(frame, { keyFrame: index % 30 === 0 });
      frame.close();
      // Don't let frames pile up faster than the encoder can take them.
      while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 5));
    },
    async finish() {
      await enc.flush();
      enc.close();
      if (failed) throw failed;
      muxer.finalize();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
  };
}
