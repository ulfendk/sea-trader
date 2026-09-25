import type { CargoType } from '../types.js';

export interface ShipClass {
  id: string;
  name: string;
  cargo: CargoType;
  /** Deadweight capacity in tonnes. */
  capacity: number;
  /** Service speed in knots. */
  speed: number;
  /** Fuel use in tonnes/day at service speed. */
  fuelPerDay: number;
  /** Bunker tank capacity in tonnes. */
  tank: number;
  /** Crew, insurance and maintenance cost per day (USD). */
  opex: number;
  /** New-build price (USD). */
  price: number;
  /** Too big for the Panama canal. */
  noPanama?: boolean;
  /** Too big for the Suez canal. */
  noSuez?: boolean;
  /** Pixel sprite length (for rendering). */
  size: 1 | 2 | 3;
}

export const SHIP_CLASSES: ShipClass[] = [
  {
    id: 'coaster',
    name: 'Coaster',
    cargo: 'general',
    capacity: 3500,
    speed: 12,
    fuelPerDay: 8,
    tank: 300,
    opex: 2200,
    price: 3_600_000,
    size: 1,
  },
  {
    id: 'general',
    name: 'General Cargo',
    cargo: 'general',
    capacity: 12000,
    speed: 15,
    fuelPerDay: 20,
    tank: 900,
    opex: 4200,
    price: 9_500_000,
    size: 2,
  },
  {
    id: 'feeder',
    name: 'Feeder Container',
    cargo: 'container',
    capacity: 9000,
    speed: 17,
    fuelPerDay: 24,
    tank: 900,
    opex: 4800,
    price: 11_000_000,
    size: 1,
  },
  {
    id: 'panamax',
    name: 'Panamax Container',
    cargo: 'container',
    capacity: 45000,
    speed: 21,
    fuelPerDay: 90,
    tank: 3600,
    opex: 11500,
    price: 44_000_000,
    size: 3,
  },
  {
    id: 'handy',
    name: 'Handysize Bulker',
    cargo: 'bulk',
    capacity: 28000,
    speed: 14,
    fuelPerDay: 25,
    tank: 1400,
    opex: 5600,
    price: 16_000_000,
    size: 2,
  },
  {
    id: 'cape',
    name: 'Capesize Bulker',
    cargo: 'bulk',
    capacity: 150000,
    speed: 14,
    fuelPerDay: 55,
    tank: 3800,
    opex: 10500,
    price: 40_000_000,
    noPanama: true,
    size: 3,
  },
  {
    id: 'product',
    name: 'Product Tanker',
    cargo: 'oil',
    capacity: 40000,
    speed: 14.5,
    fuelPerDay: 32,
    tank: 1800,
    opex: 7200,
    price: 23_000_000,
    size: 2,
  },
  {
    id: 'vlcc',
    name: 'VLCC Supertanker',
    cargo: 'oil',
    capacity: 280000,
    speed: 15,
    fuelPerDay: 85,
    tank: 5500,
    opex: 14000,
    price: 82_000_000,
    noPanama: true,
    noSuez: true,
    size: 3,
  },
];

export const SHIP_CLASSES_BY_ID: Record<string, ShipClass> = Object.fromEntries(
  SHIP_CLASSES.map((c) => [c.id, c]),
);

export function getShipClass(id: string): ShipClass {
  const c = SHIP_CLASSES_BY_ID[id];
  if (!c) throw new Error(`Unknown ship class ${id}`);
  return c;
}

export const CARGO_LABEL: Record<CargoType, string> = {
  general: 'General cargo',
  container: 'Containers',
  bulk: 'Dry bulk',
  oil: 'Oil',
};

/** Fixed + distance-based freight rate per tonne (USD) before market modifiers. */
export const FREIGHT_BASE: Record<CargoType, { fixed: number; perNm: number }> = {
  general: { fixed: 12, perNm: 0.0085 },
  container: { fixed: 9.5, perNm: 0.0072 },
  bulk: { fixed: 6.8, perNm: 0.0043 },
  oil: { fixed: 6.8, perNm: 0.0045 },
};
