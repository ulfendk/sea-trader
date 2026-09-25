import { useMemo, useRef, useState } from 'preact/hooks';
import {
  COLS,
  DIRS,
  HARBOR_MAX_COLLISIONS,
  HARBOR_MAX_FRAMES,
  FPS,
  KEY_DOWN,
  KEY_LEFT,
  KEY_RIGHT,
  KEY_UP,
  ROWS,
  SCREEN_H,
  SCREEN_W,
  SUB,
  TILE,
  T_BERTH,
  T_BOAT,
  T_LAND,
  T_ROCK,
  encodeInputs,
  harborInit,
  harborLayout,
  harborStep,
  hullPoints,
} from '@sea-trader/shared';
import { Modal } from '../ui';
import { useGameLoop } from './useGameLoop';

const THROTTLE = ['ASTERN', 'STOP', 'SLOW', 'HALF', 'FULL'];

export function HarborGame({
  seed,
  title,
  onDone,
}: {
  seed: number;
  title: string;
  onDone: (inputs: number[] | null) => void;
}) {
  const layout = useMemo(() => harborLayout(seed), [seed]);
  const state = useRef(harborInit(layout));
  const frames = useRef<number[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'intro' | 'play' | 'done'>('intro');
  const tick = useRef(0);

  const { bindTouch } = useGameLoop(
    phase === 'play',
    (keys) => {
      const s = state.current;
      frames.current.push(keys);
      harborStep(layout, s, keys);
      if (s.result !== 'playing') {
        setPhase('done');
        return false;
      }
      return true;
    },
    () => draw(),
  );

  function draw() {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const s = state.current;
    tick.current++;
    // water
    ctx.fillStyle = '#2a4d8f';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const t = layout.tiles[y * COLS + x];
        const px = x * TILE;
        const py = y * TILE;
        if (t === T_LAND) {
          ctx.fillStyle = y < 4 || y >= ROWS - 2 ? '#7a7a7a' : '#5aa04a';
          ctx.fillRect(px, py, TILE, TILE);
          ctx.fillStyle = y < 4 || y >= ROWS - 2 ? '#9a9a9a' : '#3f7f3a';
          ctx.fillRect(px, py, TILE, 1);
          ctx.fillRect(px, py, 1, TILE);
        } else if (t === T_ROCK) {
          ctx.fillStyle = '#404040';
          ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          ctx.fillStyle = '#808080';
          ctx.fillRect(px + 2, py + 2, 3, 2);
        } else if (t === T_BOAT) {
          ctx.fillStyle = '#6a3a1a';
          ctx.fillRect(px, py + 1, TILE, TILE - 2);
          ctx.fillStyle = '#d0d0d0';
          if (x % 3 === 0) ctx.fillRect(px + 2, py + 2, 4, 3);
        } else if (t === T_BERTH) {
          ctx.fillStyle = '#3a64b0';
          ctx.fillRect(px, py, TILE, TILE);
        } else if ((x * 7 + y * 3 + Math.floor(tick.current / 20)) % 13 === 0) {
          ctx.fillStyle = '#3a64b0';
          ctx.fillRect(px + 2, py + 3, 4, 1);
        }
      }
    // berth outline
    const b = layout.berth;
    ctx.strokeStyle = tick.current % 30 < 15 ? '#f0d040' : '#f8f8f8';
    ctx.lineWidth = 1;
    ctx.strokeRect(b.x * TILE + 0.5, b.y * TILE + 0.5, b.w * TILE - 1, b.h * TILE - 1);
    // wake
    const [dx, dy] = DIRS[s.heading];
    const cx = s.x / SUB;
    const cy = s.y / SUB;
    if (Math.abs(s.speed) > 8) {
      ctx.fillStyle = '#d8e8f8';
      for (let i = 0; i < 4; i++) {
        const back = 12 + i * 4 + ((tick.current + i) % 3);
        ctx.fillRect(
          Math.round(cx - (dx * back) / 256) + (i % 2 ? 1 : -1),
          Math.round(cy - (dy * back) / 256),
          1,
          1,
        );
      }
    }
    // hull
    for (let t = -10; t <= 10; t++) {
      const x = Math.round(cx + (dx * t) / 256);
      const y = Math.round(cy + (dy * t) / 256);
      ctx.fillStyle = '#101010';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    for (let t = -9; t <= 9; t++) {
      const x = Math.round(cx + (dx * t) / 256);
      const y = Math.round(cy + (dy * t) / 256);
      ctx.fillStyle = t > 6 ? '#f8f8f8' : '#c83030';
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }
    const [bow] = hullPoints(s);
    ctx.fillStyle = '#f0d040';
    ctx.fillRect(bow[0], bow[1], 1, 1);
    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, SCREEN_H - 11, SCREEN_W, 11);
    ctx.font = '10px VT323, monospace';
    ctx.fillStyle = '#f8f8f8';
    ctx.fillText(`ENGINE ${THROTTLE[s.throttle + 1]}`, 4, SCREEN_H - 3);
    ctx.fillText(`BUMPS ${s.collisions}/${HARBOR_MAX_COLLISIONS}`, 120, SCREEN_H - 3);
    ctx.fillText(`TIME ${Math.max(0, Math.ceil((HARBOR_MAX_FRAMES - s.frame) / FPS))}`, 250, SCREEN_H - 3);
  }

  const s = state.current;
  const resultText =
    s.result === 'docked'
      ? `Docked! ${s.collisions ? `${s.collisions * 2}% damage from bumps, ` : ''}no tug fee.`
      : s.result === 'crashed'
        ? 'Too many collisions — the tugs will take over (fee + damage).'
        : 'Out of time — the tugs will take over.';

  return (
    <Modal title={title} onClose={phase === 'play' ? undefined : () => onDone(null)}>
      <div style={{ position: 'relative' }}>
        <canvas ref={canvas} width={SCREEN_W} height={SCREEN_H} class="mg-screen" />
        {phase !== 'play' && (
          <div class="modal-back" style={{ position: 'absolute', background: 'rgba(0,0,20,0.6)' }}>
            <div class="win" style={{ maxWidth: '360px' }}>
              <div class="body col">
                {phase === 'intro' ? (
                  <>
                    <b>Bring her alongside the flashing berth.</b>
                    <span class="small-text">
                      ↑/↓ (W/S) change engine telegraph. ←/→ (A/D) steer. Arrive slowly — ships turn only when
                      moving. Reverse is available.
                    </span>
                    <button class="primary" onClick={() => setPhase('play')}>
                      Start
                    </button>
                  </>
                ) : (
                  <>
                    <b>{resultText}</b>
                    <button class="primary" onClick={() => onDone(encodeInputs(frames.current))}>
                      Continue
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <div class="touchpad">
        <button {...bindTouch(KEY_LEFT)}>◀</button>
        <button {...bindTouch(KEY_DOWN)}>▼</button>
        <button {...bindTouch(KEY_UP)}>▲</button>
        <button {...bindTouch(KEY_RIGHT)}>▶</button>
      </div>
    </Modal>
  );
}
