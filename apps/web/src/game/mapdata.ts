import {
  LAND,
  W,
  H,
  PORTS,
  findRoute,
  getPort,
  getShipClass,
  pointAlong,
  routeOptsFor,
  type Route,
} from '@sea-trader/shared';
import type { PubShip } from '../net';

export const CELL = 4; // offscreen px per 1° cell
export const LAT_TOP = 78;
export const LAT_BOTTOM = -62;
export const ROW0 = 90 - LAT_TOP;
export const ROWS = LAT_TOP - LAT_BOTTOM;

let landCanvas: HTMLCanvasElement | null = null;

const SEA = [42, 77, 143];
const SHALLOW = [58, 100, 170];
const LAND_C = [63, 127, 58];
const LAND_D = [52, 108, 48];
const COAST = [216, 192, 112];
const ICE = [220, 228, 236];

function isLand(x: number, y: number): boolean {
  if (y < 0 || y >= H) return true;
  return LAND[y * W + (((x % W) + W) % W)] === 1;
}

/** Pre-renders the land mask as a pixel-art bitmap. */
export function getLandCanvas(): HTMLCanvasElement {
  if (landCanvas) return landCanvas;
  const c = document.createElement('canvas');
  c.width = W * CELL;
  c.height = ROWS * CELL;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(c.width, c.height);
  for (let row = 0; row < ROWS; row++) {
    const y = row + ROW0;
    const lat = 90 - y - 0.5;
    for (let x = 0; x < W; x++) {
      const land = isLand(x, y);
      let coast = false;
      let nearLand = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (land && !isLand(x + dx, y + dy)) coast = true;
          if (!land && isLand(x + dx, y + dy)) nearLand = true;
        }
      for (let py = 0; py < CELL; py++)
        for (let px = 0; px < CELL; px++) {
          let col: number[];
          if (land) {
            if (Math.abs(lat) > 64) col = ICE;
            else if (
              coast &&
              (px === 0 || py === 0 || px === CELL - 1 || py === CELL - 1) &&
              ((px + py + x + y) & 1) === 0
            )
              col = COAST;
            else col = (x * 7 + y * 13 + px + py * 3) % 11 === 0 ? LAND_D : LAND_C;
          } else {
            col = nearLand ? SHALLOW : SEA;
            if ((x * 5 + y * 3) % 17 === 0 && py === 1 && px > 0 && px < 3) col = SHALLOW;
          }
          const o = ((row * CELL + py) * c.width + x * CELL + px) * 4;
          img.data[o] = col[0];
          img.data[o + 1] = col[1];
          img.data[o + 2] = col[2];
          img.data[o + 3] = 255;
        }
    }
  }
  ctx.putImageData(img, 0, 0);
  landCanvas = c;
  return c;
}

/** lon/lat to offscreen map pixel coordinates. */
export function project(lon: number, lat: number): [number, number] {
  return [(lon + 180) * CELL, (LAT_TOP - lat) * CELL];
}

export function shipRouteFor(ship: Pick<PubShip, 'from' | 'to' | 'classId'>): Route | null {
  if (!ship.from || !ship.to || ship.from === ship.to) return null;
  try {
    return findRoute(getPort(ship.from), getPort(ship.to), routeOptsFor(getShipClass(ship.classId)));
  } catch {
    return null;
  }
}

/** Current interpolated position of a ship. */
export function shipPosition(
  ship: PubShip,
  serverDay: number,
  day: number,
): { lon: number; lat: number; heading: number; atSea: boolean } {
  if (ship.status === 'at_sea' || ship.status === 'awaiting_pilot') {
    const route = shipRouteFor(ship);
    if (route) {
      let nm = ship.progressNm;
      if (ship.status === 'at_sea' && !ship.waiting) {
        const from = Math.max(serverDay, ship.holdUntil);
        if (day > from) nm += ship.speed * 24 * (day - from);
      }
      nm = Math.min(nm, ship.distance || route.distance);
      const p = pointAlong(route, nm);
      return { ...p, atSea: true };
    }
  }
  const port = getPort(ship.port);
  return { lon: port.lon, lat: port.lat, heading: 0, atSea: false };
}

export { PORTS };
