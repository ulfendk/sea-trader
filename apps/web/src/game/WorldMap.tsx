import { useEffect, useRef, useState } from 'preact/hooks';
import { PORTS, gameTime, getPort, haversineNm, portLocalTime, type Port } from '@sea-trader/shared';
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
    { x: number; y: number; r: number; kind: 'ship' | 'port' | 'storm' | 'zone'; id: string; label: string }[]
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

      // Routes: my ships at sea in thin dots, the selected ship bold, with the sailed part dimmed.
      if (p) {
        for (const s of Object.values(p.ships)) {
          const isSel = s.id === sel;
          if (!isSel && s.owner !== mine) continue;
          if (s.status !== 'at_sea' && s.status !== 'awaiting_pilot') continue;
          const route = shipRouteFor(s);
          if (!route) continue;
          const color = colorHex(p.players[s.owner]?.color ?? 0xffffff);
          // Split the route (map coordinates, longitudes unwrapped) at the ship's progress.
          const sailed: [number, number][] = [];
          const ahead: [number, number][] = [];
          let nm = 0;
          for (let i = 0; i < route.points.length; i++) {
            const [lon, lat] = route.points[i];
            const pt = project(lon, lat);
            if (i > 0) {
              const [plon, plat] = route.points[i - 1];
              const seg = haversineNm(plon, plat, lon, lat);
              if (nm < s.progressNm && nm + seg >= s.progressNm) {
                const f = seg ? (s.progressNm - nm) / seg : 0;
                const prev = project(plon, plat);
                const cut: [number, number] = [
                  prev[0] + (pt[0] - prev[0]) * f,
                  prev[1] + (pt[1] - prev[1]) * f,
                ];
                sailed.push(cut);
                ahead.push(cut);
              }
              nm += seg;
            }
            (nm <= s.progressNm ? sailed : ahead).push(pt);
          }
          const w = (isSel ? 3 : 2) * dpr;
          const stroke = (pts: [number, number][], col: string, dash: number[]) => {
            if (pts.length < 2) return;
            for (const k of [-1, 0, 1]) {
              ctx.beginPath();
              pts.forEach(([mx, my], i) => {
                const x = ox + (mx + k * MAP_W) * scale;
                const y = oy + my * scale;
                if (i) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
              });
              ctx.setLineDash(dash);
              ctx.lineCap = 'butt';
              ctx.lineJoin = 'round';
              ctx.strokeStyle = '#101010';
              ctx.lineWidth = w + 2 * dpr;
              ctx.stroke();
              ctx.strokeStyle = col;
              ctx.lineWidth = w;
              ctx.stroke();
            }
          };
          stroke(sailed, '#7d8aa3', [2 * dpr, 4 * dpr]);
          stroke(ahead, isSel ? '#f8f8f8' : color, isSel ? [8 * dpr, 4 * dpr] : [4 * dpr, 4 * dpr]);
          ctx.setLineDash([]);
          if (isSel) {
            // Destination flag.
            const [dlon, dlat] = route.points[route.points.length - 1];
            const [dx, dy] = project(dlon, dlat);
            const u = Math.max(2, Math.round(dpr * 1.5));
            for (const [sx, sy] of toScreen(((dx % MAP_W) + MAP_W) % MAP_W, dy)) {
              const x = Math.round(sx);
              const y = Math.round(sy);
              ctx.fillStyle = '#101010';
              ctx.fillRect(x - u, y - 7 * u, 5 * u, 8 * u);
              ctx.fillStyle = '#f8f8f8';
              ctx.fillRect(x, y - 6 * u, u, 6 * u);
              ctx.fillStyle = color;
              ctx.fillRect(x + u, y - 6 * u, 3 * u, 2 * u);
            }
          }
        }
      }

      // Conflict zones: hatched discs with a dotted border and a warning sign.
      for (const z of p?.conflicts ?? []) {
        const [mx, my] = project(z.lon, z.lat);
        const rPx = (z.radiusNm / 60) * CELL * scale;
        const col = z.level === 'war' ? '176,16,72' : z.level === 'high' ? '200,48,120' : '190,110,170';
        for (const [sx, sy] of toScreen(mx, my)) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${col},0.2)`;
          ctx.fill();
          ctx.fillStyle = hatch(ctx, col, dpr);
          ctx.fill();
          ctx.restore();
          const u = Math.max(1, Math.round(dpr));
          ctx.fillStyle = `rgb(${col})`;
          const dots = Math.max(16, Math.round(rPx / (3 * dpr)));
          for (let i = 0; i < dots; i += 1) {
            const a = (i / dots) * Math.PI * 2;
            ctx.fillRect(
              Math.round(sx + Math.cos(a) * rPx - u),
              Math.round(sy + Math.sin(a) * rPx - u),
              2 * u,
              2 * u,
            );
          }
          drawWarning(ctx, sx, sy, Math.max(2, Math.round(dpr * 1.5)), `rgb(${col})`);
          newHits.push({
            x: sx / dpr,
            y: sy / dpr,
            r: Math.max(12, rPx / dpr),
            kind: 'zone',
            id: z.id,
            label: `⚠ ${z.name[0].toUpperCase()}${z.name.slice(1)} · ${z.level === 'war' ? 'war zone' : `${z.level} risk`}`,
          });
        }
      }

      // Real storms: translucent discs sized to their danger radius, with a pixel swirl.
      for (const st of p?.storms ?? []) {
        const [mx, my] = project(st.lon, st.lat);
        const rPx = (st.radiusNm / 60) * CELL * scale;
        const red = st.severity === 'red';
        for (const [sx, sy] of toScreen(mx, my)) {
          ctx.fillStyle = red ? 'rgba(200,40,40,0.28)' : 'rgba(240,150,40,0.28)';
          ctx.beginPath();
          ctx.arc(sx, sy, rPx, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = red ? '#c83030' : '#f09628';
          const u = Math.max(2, Math.round(px * 0.8));
          const spin = Math.floor(t / 250) % 4;
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 4 + spin * (Math.PI / 2);
            const d = (i / 12) * Math.max(4 * u, rPx * 0.5);
            ctx.fillRect(
              Math.round(sx + Math.cos(a) * d - u / 2),
              Math.round(sy + Math.sin(a) * d - u / 2),
              u,
              u,
            );
          }
          newHits.push({
            x: sx / dpr,
            y: sy / dpr,
            r: Math.max(12, rPx / dpr),
            kind: 'storm',
            id: st.id,
            label: `🌀 ${st.name}${st.windKmh ? ` · ${st.windKmh} km/h` : ''}`,
          });
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
    const rank = (h: { kind: string }) =>
      h.kind === 'ship' ? 3 : h.kind === 'port' ? 2 : h.kind === 'storm' ? 1 : 0;
    const hitAt = (x: number, y: number) => {
      let best: (typeof hits.current)[number] | null = null;
      let bd = Infinity;
      for (const h of hits.current) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < h.r && (!best || rank(h) > rank(best) || (rank(h) === rank(best) && d < bd))) {
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
// East-facing ship sprite: c = hull (player colour), w = superstructure, f = funnel.
const SHIP_SPRITE = ['....f.....', '..www.....', '..www.....', 'ccccccccccc', 'cccccccccc.', '.cccccccc..'];

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
  const u = Math.max(1, Math.round(px / 2)) + (selected ? 1 : 0);
  const west = Math.cos(heading) < 0;
  const w = SHIP_SPRITE[0].length;
  const h = SHIP_SPRITE.length;
  const ox = Math.round(x - (w * u) / 2);
  const oy = Math.round(y - (h * u) / 2);
  const cells: [number, number, string][] = [];
  SHIP_SPRITE.forEach((row, r) => {
    for (let c = 0; c < w; c++) if (row[c] !== '.') cells.push([west ? w - 1 - c : c, r, row[c]]);
  });
  // Outline: white when selected, dark otherwise; own ships get a thicker one.
  const o = selected || mine ? 2 * u : u;
  ctx.fillStyle = selected ? '#f8f8f8' : '#101010';
  for (const [c, r] of cells) ctx.fillRect(ox + c * u - o, oy + r * u - o, u + 2 * o, u + 2 * o);
  if (selected) {
    ctx.fillStyle = '#101010';
    for (const [c, r] of cells) ctx.fillRect(ox + c * u - u, oy + r * u - u, 3 * u, 3 * u);
  }
  for (const [c, r, k] of cells) {
    ctx.fillStyle =
      k === 'c' ? color : k === 'w' ? (alert ? '#e02020' : '#f8f8f8') : alert ? '#f8f8f8' : '#101010';
    ctx.fillRect(ox + c * u, oy + r * u, u, u);
  }
}

const hatches = new Map<string, CanvasPattern | string>();

/** Diagonal pixel hatching for conflict zones, cached per colour and pixel ratio. */
function hatch(ctx: CanvasRenderingContext2D, rgb: string, dpr: number): CanvasPattern | string {
  const key = `${rgb}@${dpr}`;
  let pat = hatches.get(key);
  if (!pat) {
    const u = Math.max(1, Math.round(dpr));
    const n = 6 * u;
    const c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d')!;
    g.fillStyle = `rgba(${rgb},0.5)`;
    for (let i = 0; i < 6; i++) g.fillRect(i * u, (5 - i) * u, u, u);
    pat = ctx.createPattern(c, 'repeat') ?? `rgba(${rgb},0.3)`;
    hatches.set(key, pat);
  }
  return pat;
}

/** Small pixel warning triangle with an exclamation mark. */
function drawWarning(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, color: string) {
  const rows = ['...#...', '..###..', '..#w#..', '.##w##.', '.#####.', '###w###', '#######'];
  const ox = Math.round(x - 3.5 * u);
  const oy = Math.round(y - 3.5 * u);
  ctx.fillStyle = '#101010';
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++)
      if (row[c] !== '.') ctx.fillRect(ox + (c - 1) * u, oy + (r - 1) * u, 3 * u, 3 * u);
  });
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '.') continue;
      ctx.fillStyle = row[c] === 'w' ? '#f8f8f8' : color;
      ctx.fillRect(ox + c * u, oy + r * u, u, u);
    }
  });
}

export function portLabel(p: Port | string) {
  return typeof p === 'string' ? getPort(p).name : p.name;
}
