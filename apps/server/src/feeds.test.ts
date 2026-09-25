import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseEia, parseGdacs } from './feeds.js';

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'));

describe('feed parsers', () => {
  it('keeps only current orange/red tropical cyclones, latest episode per storm', () => {
    const storms = parseGdacs(fixture('gdacs-tc.json'));
    expect(storms.map((s) => s.name).sort()).toEqual(['Cyclone Helene', 'Cyclone Kong-rey']);
    const helene = storms.find((s) => s.name === 'Cyclone Helene')!;
    expect(helene).toMatchObject({
      id: 'gdacs-1001234',
      lon: -45.2,
      lat: 22.1,
      severity: 'red',
      windKmh: 213,
    });
    expect(helene.radiusNm).toBeGreaterThan(300);
    expect(storms.find((s) => s.name === 'Cyclone Kong-rey')!.severity).toBe('orange');
  });

  it('tolerates junk', () => {
    expect(parseGdacs(null)).toEqual([]);
    expect(parseGdacs({ features: [{}] })).toEqual([]);
    expect(parseEia({})).toBeNull();
  });

  it('reads the latest Brent price', () => {
    expect(parseEia(fixture('eia-brent.json'))).toEqual({ usd: 82.47, date: '2026-09-22' });
  });
});
