import type { CargoType } from '../types.js';

export interface Port {
  id: string;
  name: string;
  country: string;
  lon: number;
  lat: number;
  /** Base port fee in USD for a 10,000 t ship. */
  feeBase: number;
  /** Cargo handling capacity in tonnes per day. */
  handling: number;
  /** Fuel price multiplier relative to world index. */
  fuelFactor: number;
  /** Relative export (supply) weight per cargo type. */
  exports: Record<CargoType, number>;
  /** Relative import (demand) weight per cargo type. */
  imports: Record<CargoType, number>;
  /** Chance per call of a dock strike. */
  strikeRisk: number;
}

const p = (
  id: string,
  name: string,
  country: string,
  lon: number,
  lat: number,
  feeBase: number,
  handling: number,
  fuelFactor: number,
  exp: [number, number, number, number],
  imp: [number, number, number, number],
  strikeRisk = 0.03,
): Port => ({
  id,
  name,
  country,
  lon,
  lat,
  feeBase,
  handling,
  fuelFactor,
  exports: { general: exp[0], container: exp[1], bulk: exp[2], oil: exp[3] },
  imports: { general: imp[0], container: imp[1], bulk: imp[2], oil: imp[3] },
  strikeRisk,
});

//      id      name              country       lon      lat     fee    handling fuel  exports(g,c,b,o)  imports(g,c,b,o)
export const PORTS: Port[] = [
  p('ham', 'Hamburg', 'Germany', 9.97, 53.55, 22000, 26000, 1.05, [3, 4, 1, 0], [2, 3, 2, 3]),
  p('rtm', 'Rotterdam', 'Netherlands', 4.1, 51.95, 20000, 32000, 0.95, [2, 4, 1, 3], [2, 3, 4, 5]),
  p('lon', 'London', 'UK', 0.5, 51.5, 24000, 20000, 1.1, [3, 2, 1, 1], [3, 3, 1, 2], 0.06),
  p('gen', 'Genoa', 'Italy', 8.93, 44.4, 18000, 16000, 1.05, [3, 2, 1, 0], [2, 2, 2, 3], 0.07),
  p('pir', 'Piraeus', 'Greece', 23.63, 37.94, 14000, 14000, 1.0, [2, 1, 1, 0], [3, 2, 1, 2]),
  p('alx', 'Alexandria', 'Egypt', 29.9, 31.2, 11000, 10000, 0.9, [2, 0, 3, 2], [3, 2, 2, 1]),
  p('lag', 'Lagos', 'Nigeria', 3.4, 6.45, 13000, 7000, 0.85, [1, 0, 1, 5], [4, 3, 2, 1], 0.05),
  p('cpt', 'Cape Town', 'South Africa', 18.42, -33.9, 12000, 12000, 0.95, [2, 1, 4, 0], [2, 2, 1, 3]),
  p('mba', 'Mombasa', 'Kenya', 39.67, -4.05, 10000, 7000, 1.0, [3, 0, 2, 0], [3, 2, 1, 3]),
  p('jed', 'Jeddah', 'Saudi Arabia', 39.17, 21.5, 12000, 14000, 0.7, [1, 0, 0, 5], [4, 4, 3, 0]),
  p('dxb', 'Dubai', 'UAE', 55.27, 25.27, 13000, 24000, 0.65, [1, 2, 0, 6], [4, 5, 3, 0]),
  p('bom', 'Bombay', 'India', 72.83, 18.95, 12000, 10000, 1.0, [3, 2, 2, 0], [2, 2, 3, 4], 0.08),
  p('cmb', 'Colombo', 'Sri Lanka', 79.85, 6.93, 9000, 9000, 1.0, [3, 2, 1, 0], [2, 2, 1, 2]),
  p('sin', 'Singapore', 'Singapore', 103.85, 1.28, 16000, 34000, 0.8, [2, 5, 0, 3], [2, 4, 1, 4], 0.01),
  p('hkg', 'Hong Kong', 'Hong Kong', 114.17, 22.3, 17000, 30000, 0.9, [4, 6, 0, 0], [2, 3, 2, 3], 0.01),
  p('sha', 'Shanghai', 'China', 121.5, 31.23, 15000, 28000, 0.95, [4, 5, 1, 0], [1, 2, 5, 4], 0.02),
  p('yok', 'Yokohama', 'Japan', 139.64, 35.44, 23000, 24000, 1.15, [4, 5, 0, 0], [1, 1, 5, 5], 0.01),
  p('syd', 'Sydney', 'Australia', 151.2, -33.86, 18000, 16000, 1.05, [1, 1, 5, 0], [3, 3, 0, 2], 0.05),
  p('lax', 'Los Angeles', 'USA', -118.26, 33.73, 21000, 26000, 1.0, [3, 2, 2, 1], [3, 5, 1, 3], 0.04),
  p('van', 'Vancouver', 'Canada', -123.1, 49.28, 16000, 18000, 1.0, [2, 1, 5, 0], [2, 3, 1, 2], 0.03),
  p('vap', 'Valparaiso', 'Chile', -71.62, -33.05, 11000, 9000, 1.05, [2, 0, 5, 0], [3, 2, 1, 3]),
  p('bue', 'Buenos Aires', 'Argentina', -58.37, -34.6, 12000, 11000, 1.0, [2, 1, 5, 0], [3, 2, 1, 3], 0.09),
  p('rio', 'Rio de Janeiro', 'Brazil', -43.2, -22.9, 13000, 12000, 1.0, [2, 1, 5, 1], [3, 2, 1, 3], 0.06),
  p('nyc', 'New York', 'USA', -74.0, 40.7, 25000, 28000, 1.05, [3, 3, 1, 0], [4, 5, 1, 4], 0.04),
  p('hou', 'Houston', 'USA', -95.0, 29.3, 17000, 26000, 0.75, [2, 1, 3, 5], [2, 2, 1, 1], 0.02),
];

export const PORTS_BY_ID: Record<string, Port> = Object.fromEntries(PORTS.map((x) => [x.id, x]));

export function getPort(id: string): Port {
  const port = PORTS_BY_ID[id];
  if (!port) throw new Error(`Unknown port ${id}`);
  return port;
}

/** Regions with pirate activity: [lonMin, lonMax, latMin, latMax, riskPerDay]. */
export const PIRATE_ZONES: [number, number, number, number, number][] = [
  [42, 60, -2, 16, 0.03], // Gulf of Aden / Somali basin
  [95, 106, -2, 7, 0.025], // Malacca strait
  [-2, 9, 0, 7, 0.02], // Gulf of Guinea
  [115, 122, 4, 12, 0.012], // South China Sea
];

/** Regions with reefs, shoals or ice where a navigation challenge may occur. */
export const HAZARD_ZONES: [number, number, number, number, number, string][] = [
  [142, 155, -25, -10, 0.05, 'the Great Barrier Reef'],
  [-60, -40, 40, 55, 0.04, 'icebergs off Newfoundland'],
  [-80, -60, -60, -50, 0.05, 'ice near Cape Horn'],
  [105, 120, 5, 20, 0.02, 'the Spratly shoals'],
  [-85, -70, 18, 27, 0.02, 'the Bahamas banks'],
  [35, 44, 12, 28, 0.02, 'Red Sea coral reefs'],
];
