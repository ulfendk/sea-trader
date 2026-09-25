import { useMemo, useRef, useState } from 'preact/hooks';
import {
  COLS,
  KEY_LEFT,
  KEY_RIGHT,
  REEF_MAX_HITS,
  REEF_ROWS,
  REEF_SHIP_SCREEN_Y,
  SCREEN_H,
  SCREEN_W,
  SUB,
  TILE,
  encodeInputs,
  reefInit,
  reefLayout,
  reefStep,
} from '@sea-trader/shared';
import { Modal } from '../ui';
import { useGameLoop } from './useGameLoop';

export function ReefGame({
  seed,
  title,
  onDone,
}: {
  seed: number;
  title: string;
  onDone: (inputs: number[] | null) => void;
}) {
  const layout = useMemo(() => reefLayout(seed), [seed]);
  const ice = /ice/i.test(title);
  const state = useRef(reefInit());
  const frames = useRef<number[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'intro' | 'play' | 'done'>('intro');

  const { bindTouch } = useGameLoop(
    phase === 'play',
    (keys) => {
      const s = state.current;
      frames.current.push(keys);
      reefStep(layout, s, keys);
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
    const wy = s.scroll / SUB;
    ctx.fillStyle = ice ? '#1d3566' : '#2f7fb0';
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    const firstRow = Math.max(0, Math.floor((wy - (SCREEN_H - REEF_SHIP_SCREEN_Y)) / TILE) - 1);
    const lastRow = Math.min(REEF_ROWS - 1, Math.ceil((wy + REEF_SHIP_SCREEN_Y) / TILE) + 1);
    for (let r = firstRow; r <= lastRow; r++) {
      const sy = Math.round(REEF_SHIP_SCREEN_Y - (r * TILE - wy) - TILE);
      for (let c = 0; c < COLS; c++) {
        if (!layout.tiles[r * COLS + c]) continue;
        ctx.fillStyle = ice ? '#e8f0f8' : (r + c) % 3 === 0 ? '#e07050' : '#d8c070';
        ctx.fillRect(c * TILE, sy, TILE, TILE);
        ctx.fillStyle = ice ? '#a8c8e0' : '#b89850';
        ctx.fillRect(c * TILE, sy + TILE - 2, TILE, 2);
      }
    }
    // finish line
    const fy = Math.round(REEF_SHIP_SCREEN_Y - (REEF_ROWS * TILE - wy));
    if (fy > -4 && fy < SCREEN_H) {
      for (let x = 0; x < SCREEN_W; x += 8) {
        ctx.fillStyle = (x / 8) % 2 ? '#f8f8f8' : '#101010';
        ctx.fillRect(x, fy, 8, 3);
      }
    }
    // ship (pointing up)
    const x = Math.round(s.x / SUB);
    const y = REEF_SHIP_SCREEN_Y;
    const flash = s.cooldown > 0 && s.cooldown % 6 < 3;
    ctx.fillStyle = '#101010';
    ctx.fillRect(x - 4, y - 8, 8, 16);
    ctx.fillStyle = flash ? '#f8f8f8' : '#c83030';
    ctx.fillRect(x - 3, y - 5, 6, 12);
    ctx.fillRect(x - 2, y - 7, 4, 2);
    ctx.fillStyle = '#f8f8f8';
    ctx.fillRect(x - 2, y + 2, 4, 3);
    // wake
    ctx.fillStyle = '#d8e8f8';
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 3 + ((s.frame + i * 2) % 7), y + 10 + i * 3, 1, 1);
    // HUD
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, SCREEN_W, 11);
    ctx.font = '10px VT323, monospace';
    ctx.fillStyle = '#f8f8f8';
    ctx.fillText(`HITS ${s.hits}/${REEF_MAX_HITS}`, 4, 8);
    ctx.fillText(`PASSAGE ${Math.min(100, Math.round((wy / (REEF_ROWS * TILE)) * 100))}%`, 230, 8);
  }

  const s = state.current;
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
                    <b>Thread the ship through the channel.</b>
                    <span class="small-text">
                      ←/→ (A/D) steer. Each hit damages the hull; {REEF_MAX_HITS} hits and you run aground.
                    </span>
                    <button class="primary" onClick={() => setPhase('play')}>
                      Start
                    </button>
                  </>
                ) : (
                  <>
                    <b>
                      {s.result === 'cleared'
                        ? `Through! ${s.hits ? `${s.hits * 3}% damage.` : 'Not a scratch.'}`
                        : 'Aground! Heavy damage and delays.'}
                    </b>
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
      <div class="touchpad" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <button {...bindTouch(KEY_LEFT)}>◀</button>
        <button {...bindTouch(KEY_RIGHT)}>▶</button>
      </div>
    </Modal>
  );
}
