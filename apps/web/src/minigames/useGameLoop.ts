import { useEffect, useRef } from 'preact/hooks';
import { FPS, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_UP } from '@sea-trader/shared';

const KEYMAP: Record<string, number> = {
  ArrowUp: KEY_UP,
  KeyW: KEY_UP,
  ArrowDown: KEY_DOWN,
  KeyS: KEY_DOWN,
  ArrowLeft: KEY_LEFT,
  KeyA: KEY_LEFT,
  ArrowRight: KEY_RIGHT,
  KeyD: KEY_RIGHT,
};

/** Keyboard + touch input as a bitmask, plus a fixed 30 Hz step loop. */
export function useGameLoop(running: boolean, step: (keys: number) => boolean, render: () => void) {
  const keys = useRef(0);
  const touch = useRef(0);
  const stepRef = useRef(step);
  const renderRef = useRef(render);
  stepRef.current = step;
  renderRef.current = render;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (k) {
        keys.current |= k;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = KEYMAP[e.code];
      if (k) keys.current &= ~k;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (running) {
        acc += Math.min(250, t - last);
        const dt = 1000 / FPS;
        while (acc >= dt) {
          acc -= dt;
          if (!stepRef.current(keys.current | touch.current)) {
            acc = 0;
            break;
          }
        }
      }
      last = t;
      renderRef.current();
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  const bindTouch = (bit: number) => ({
    onPointerDown: (e: PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      touch.current |= bit;
    },
    onPointerUp: () => (touch.current &= ~bit),
    onPointerCancel: () => (touch.current &= ~bit),
    onContextMenu: (e: Event) => e.preventDefault(),
  });
  return { bindTouch };
}
