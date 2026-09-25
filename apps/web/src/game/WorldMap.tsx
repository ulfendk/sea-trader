import { useEffect, useRef, useState } from 'preact/hooks';
import { PORTS, gameTime, getPort, portLocalTime, type Port } from '@sea-trader/shared';
import { liveDay, pub, type PubShip } from '../net';
import { colorHex } from '../ui';
import { CELL, ROWS, getLandCanvas, getNightCanvas, project, shipPosition, shipRouteFor } from './mapdata';

interface Props {
  myId: string;
  selectedShip: string | null;
  onSelectShip: (id: string) => void;
  onSelectPort?: (id: string) => void;
  highlightPorts?: string[];
}

const MAP_W = 360 * CELL;
const MAP_H = ROWS * CELL;

interface View {
  z: number;
  cx: number; // map px at centre
  cy: number;
}

export function WorldMap({ myId, selectedShip, onSelectShip, onSelectPort, highlightPorts = [] }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ z: 1, cx: MAP_W / 2, cy: MAP_H / 2 });
  const hits = useRef<
    { x: number; y: number; r: number; kind: 'ship' | 'port'; id: string; label: string }[]
  >([]);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const props = useRef({ myId, selectedShip, onSelectShip, onSelectPort, highlightPorts });
  props.current = { myId, selectedShip, onSelectShip, onSelectPort, highlightPorts };

  // Centre on the selected ship when it changes.
  useEffect(() => {
    const p = pub.value;
    if (!selectedShip || !p?.ships[selectedShip]) return;
    const s = p.ships[selectedShip];
    const pos = shipPosition(s, p.day, liveDay());
    const [x, y] = project(pos.lon, pos.lat);
    if (view.current.z > 1.2) {
      view.current.cx = x;
      view.current.cy = y;
    }
  }, [selectedShip]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const land = getLandCanvas();
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 100) return;
      last = t;
      const cv = canvas.current;
      const el = wrap.current;
      const p = pub.value;
      if (!cv || !el) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      // Hidden (e.g. another mobile tab is open): skip, or the zero size would poison the view with NaN.
      if (!cw || !ch) return;
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
        cv.width = Math.round(cw * dpr);
        cv.height = Math.round(ch * dpr);
      }
      const ctx = cv.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const v = view.current;
      const base = cw / MAP_W; // fit width at z=1
      const scale = base * v.z * dpr;
      // clamp vertical
      const halfH = ch / 2 / (base * v.z);
      v.cy = Math.max(Math.min(halfH, MAP_H / 2), Math.min(MAP_H - Math.min(halfH, MAP_H / 2), v.cy));
      v.cx = ((v.cx % MAP_W) + MAP_W) % MAP_W;
      const ox = cv.width / 2 - v.cx * scale;
      const oy = cv.height / 2 - v.cy * scale;
      ctx.fillStyle = '#2a4d8f';
      ctx.fillRect(0, 0, cv.width, cv.height);
      const now = p ? gameTime(p.startTs, liveDay()) : Date.now();
      const night = getNightCanvas(now);
      for (const layer of [land, night])
        for (const k of [-1, 0, 1])
          ctx.drawImage(
            layer,
            Math.round(ox + k * MAP_W * scale),
            Math.round(oy),
            Math.round(MAP_W * scale),
            Math.round(MAP_H * scale),
          );

      const toScreen = (mx: number, my: number): [number, number][] =>
        [-1, 0, 1]
          .map((k) => [ox + (mx + k * MAP_W) * scale, oy + my * scale] as [number, number])
          .filter(([x]) => x > -40 && x < cv.width + 40);

      const newHits: typeof hits.current = [];
      const px = Math.max(2, Math.round(dpr * Math.min(3, 1.4 + v.z * 0.5)));
      const blink = Math.floor(t / 500) % 2 === 0;
      const { myId: mine, selectedShip: sel, highlightPorts: hl } = props.current;

      // Route of the selected ship.
      if (p && sel && p.ships[sel]) {
        const s = p.ships[sel];
        const route = shipRouteFor(s);
        if (route && (s.status === 'at_sea' || s.status === 'awaiting_pilot')) {
          ctx.fillStyle = '#f8f8f8';
          for (let i = 1; i < route.points.length; i++) {
            const [ax, ay] = project(route.points[i - 1][0], route.points[i - 1][1]);
            const [bx, by] = project(route.points[i][0], route.points[i][1]);
            const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
            for (let j = 0; j < steps; j += 2) {
              const mx = ax + ((bx - ax) * j) / steps;
              const my = ay + ((by - ay) * j) / steps;
              for (const [sx, sy] of toScreen(((mx % MAP_W) + MAP_W) % MAP_W, my))
                ctx.fillRect(Math.round(sx), Math.round(sy), dpr, dpr);
            }
          }
        }
      }

      // Ports
      for (const port of PORTS) {
        const [mx, my] = project(port.lon, port.lat);
        const highlighted = hl.includes(port.id);
        for (const [sx, sy] of toScreen(mx, my)) {
          const s = px + 1;
          ctx.fillStyle = '#101010';
          ctx.fillRect(Math.round(sx - s - dpr), Math.round(sy - s - dpr), (s + dpr) * 2, (s + dpr) * 2);
          ctx.fillStyle = highlighted && blink ? '#f8f8f8' : '#f0d040';
          ctx.fillRect(Math.round(sx - s), Math.round(sy - s), s * 2, s * 2);
          if (v.z >= 1.8 || highlighted) {
            ctx.font = `${Math.round(16 * dpr)}px VT323, monospace`;
            ctx.fillStyle = '#101010';
            ctx.fillText(port.name, Math.round(sx + s + 3 * dpr) + dpr, Math.round(sy + 5 * dpr) + dpr);
            ctx.fillStyle = '#f8f8f8';
            ctx.fillText(port.name, Math.round(sx + s + 3 * dpr), Math.round(sy + 5 * dpr));
          }
          newHits.push({
            x: sx / dpr,
            y: sy / dpr,
            r: 10,
            kind: 'port',
            id: port.id,
            label: `${port.name} · ${portLocalTime(port.tz, now)}`,
          });
        }
      }

      // Ships
      if (p) {
        const day = liveDay();
        const inPort = new Map<string, number>();
        const ships = Object.values(p.ships).sort(
          (a, b) =>
            (a.owner === mine ? 1 : 0) - (b.owner === mine ? 1 : 0) ||
            (a.id === sel ? 1 : 0) - (b.id === sel ? 1 : 0),
        );
        for (const s of ships) {
          const pos = shipPosition(s, p.day, day);
          let [mx, my] = project(pos.lon, pos.lat);
          if (!pos.atSea) {
            const n = inPort.get(s.port) ?? 0;
            inPort.set(s.port, n + 1);
            mx += 6 + (n % 4) * 5;
            my += 6 + Math.floor(n / 4) * 4;
          }
          const color = colorHex(p.players[s.owner]?.color ?? 0xffffff);
          for (const [sx, sy] of toScreen(mx, my)) {
            drawShip(
              ctx,
              sx,
              sy,
              px,
              color,
              pos.heading,
              s.owner === mine,
              s.id === sel,
              s.waiting && s.owner === mine && blink,
            );
            newHits.push({
              x: sx / dpr,
              y: sy / dpr,
              r: 9,
              kind: 'ship',
              id: s.id,
              label: `${s.name} (${p.players[s.owner]?.company ?? '?'})`,
            });
          }
        }
      }
      hits.current = newHits;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ---------------------------------------------------------------- input
  useEffect(() => {
    const el = wrap.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinch = 0;
    const base = () => el.clientWidth / MAP_W;
    const zoomAt = (factor: number, sx: number, sy: number) => {
      if (!el.clientWidth || !el.clientHeight) return;
      const v = view.current;
      const nz = Math.max(1, Math.min(8, v.z * factor));
      const s0 = base() * v.z;
      const s1 = base() * nz;
      const mx = v.cx + (sx - el.clientWidth / 2) / s0;
      const my = v.cy + (sy - el.clientHeight / 2) / s0;
      v.cx = mx - (sx - el.clientWidth / 2) / s1;
      v.cy = my - (sy - el.clientHeight / 2) / s1;
      v.z = nz;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    };
    const hitAt = (x: number, y: number) => {
      let best: (typeof hits.current)[number] | null = null;
      let bd = Infinity;
      for (const h of hits.current) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < h.r && (d < bd || (best?.kind === 'port' && h.kind === 'ship'))) {
          best = h;
          bd = d;
        }
      }
      return best;
    };
    const down = (e: PointerEvent) => {
      // Let the zoom buttons receive their own clicks; capturing the pointer here would swallow them.
      if ((e.target as Element | null)?.closest('.map-tools')) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const prev = pointers.get(e.pointerId);
      if (!prev) {
        const h = hitAt(e.clientX - r.left, e.clientY - r.top);
        setTip(h ? { x: e.clientX - r.left + 12, y: e.clientY - r.top + 12, text: h.label } : null);
        el.style.cursor = h ? 'pointer' : 'grab';
        return;
      }
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        pinch = d;
        moved += 10;
        return;
      }
      moved += Math.abs(dx) + Math.abs(dy);
      const s = base() * view.current.z;
      view.current.cx -= dx / s;
      view.current.cy -= dy / s;
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
      if (moved < 6 && pointers.size === 0) {
        const r = el.getBoundingClientRect();
        const h = hitAt(e.clientX - r.left, e.clientY - r.top);
        if (h?.kind === 'ship') props.current.onSelectShip(h.id);
        else if (h?.kind === 'port') props.current.onSelectPort?.(h.id);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', () => setTip(null));
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, []);

  const zoom = (f: number) => {
    const v = view.current;
    v.z = Math.max(1, Math.min(8, v.z * f));
  };

  return (
    <div class="map-canvas-wrap" ref={wrap} style={{ aspectRatio: `${360} / ${ROWS}` }}>
      <canvas ref={canvas} aria-label="World map" />
      <div class="map-tools">
        <button class="small" onClick={() => zoom(1.5)} aria-label="Zoom in">
          +
        </button>
        <button class="small" onClick={() => zoom(1 / 1.5)} aria-label="Zoom out">
          -
        </button>
      </div>
      {tip && (
        <div class="map-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}

/** Tiny pixel ship sprite pointing east/west depending on heading. */
function drawShip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  px: number,
  color: string,
  heading: number,
  mine: boolean,
  selected: boolean,
  alert: boolean,
) {
  const u = Math.max(1, Math.round(px / 1.5)) * (selected ? 2 : 1);
  const west = Math.cos(heading) < 0;
  // hull 5x2, cabin 2x1
  const hull = west ? ['.#####', '##### '] : ['#####.', ' #####'];
  const ox = Math.round(x - 3 * u);
  const oy = Math.round(y - u);
  if (mine || selected) {
    ctx.fillStyle = selected ? '#f8f8f8' : '#101010';
    ctx.fillRect(ox - u, oy - 2 * u, 8 * u, 5 * u);
  }
  ctx.fillStyle = alert ? '#f8f8f8' : color;
  hull.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(ox + c * u, oy + r * u, u, u);
  });
  ctx.fillStyle = alert ? color : '#f8f8f8';
  ctx.fillRect(ox + (west ? 3 : 1) * u, oy - u, 2 * u, u);
}

export function portLabel(p: Port | string) {
  return typeof p === 'string' ? getPort(p).name : p.name;
}
