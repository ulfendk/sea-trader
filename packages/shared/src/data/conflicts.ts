import type { ConflictZone } from '../types.js';

/**
 * Starting list of conflict zones (war risk, attacks on shipping, piracy), based on the
 * UKMTO/JMIC advisories and the Joint War Committee's listed areas. Admins keep it current
 * in the admin panel; this list is only used until they first save their own.
 */
export const DEFAULT_CONFLICT_ZONES: ConflictZone[] = [
  {
    id: 'red-sea',
    name: 'the Red Sea and Gulf of Aden',
    lon: 43.5,
    lat: 13.5,
    radiusNm: 330,
    level: 'war',
    detourDays: 10,
    note: 'Missile and drone attacks on merchant ships; many lines reroute via the Cape of Good Hope',
  },
  {
    id: 'black-sea',
    name: 'the Black Sea',
    lon: 34,
    lat: 43.5,
    radiusNm: 300,
    level: 'war',
    detourDays: 2,
    note: 'Sea mines and strikes on ports and shipping',
  },
  {
    id: 'hormuz',
    name: 'the Strait of Hormuz',
    lon: 56.6,
    lat: 26.4,
    radiusNm: 60,
    level: 'high',
    detourDays: 1.5,
    note: 'Ship seizures and harassment; wait for a naval escort to avoid it',
  },
  {
    id: 'gulf-of-guinea',
    name: 'the Gulf of Guinea',
    lon: 4.5,
    lat: 2.5,
    radiusNm: 220,
    level: 'high',
    detourDays: 1.5,
    note: 'Armed robbery and kidnapping of crews',
  },
  {
    id: 'somali-basin',
    name: 'the Somali Basin',
    lon: 52,
    lat: 4,
    radiusNm: 360,
    level: 'elevated',
    detourDays: 2,
    note: 'Somali piracy has flared up again',
  },
];
