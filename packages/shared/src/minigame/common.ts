/** Shared helpers for deterministic mini-games. All physics uses integer math so client and server agree. */

export const FPS = 30;
export const SCREEN_W = 320;
export const SCREEN_H = 200;
export const TILE = 8;
export const COLS = SCREEN_W / TILE;
export const ROWS = SCREEN_H / TILE;
/** Sub-pixel units per pixel. */
export const SUB = 256;

export const KEY_UP = 1;
export const KEY_DOWN = 2;
export const KEY_LEFT = 4;
export const KEY_RIGHT = 8;

/** 32 compass directions as [cos, sin] * 256; index 0 = east, 8 = south (screen down), 24 = north. */
export const DIRS: [number, number][] = [
  [256, 0],
  [251, 50],
  [237, 98],
  [213, 142],
  [181, 181],
  [142, 213],
  [98, 237],
  [50, 251],
  [0, 256],
  [-50, 251],
  [-98, 237],
  [-142, 213],
  [-181, 181],
  [-213, 142],
  [-237, 98],
  [-251, 50],
  [-256, 0],
  [-251, -50],
  [-237, -98],
  [-213, -142],
  [-181, -181],
  [-142, -213],
  [-98, -237],
  [-50, -251],
  [0, -256],
  [50, -251],
  [98, -237],
  [142, -213],
  [181, -181],
  [213, -142],
  [237, -98],
  [251, -50],
];

/** Run-length encodes per-frame input bitmasks as [bits, count, bits, count, ...]. */
export function encodeInputs(frames: number[]): number[] {
  const out: number[] = [];
  for (const f of frames) {
    const n = out.length;
    if (n && out[n - 2] === f && out[n - 1] < 65535) out[n - 1]++;
    else out.push(f, 1);
  }
  return out;
}

export function decodeInputs(rle: number[], maxFrames: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < rle.length && out.length < maxFrames; i += 2) {
    const bits = rle[i] & 15;
    const count = Math.max(0, Math.min(rle[i + 1] | 0, maxFrames - out.length));
    for (let k = 0; k < count; k++) out.push(bits);
  }
  return out;
}

export const idiv = (a: number, b: number) => Math.trunc(a / b);
