import { signal } from '@preact/signals';

/** Per-device display preferences, kept in localStorage. */

export type MapStyle = 'pixel' | 'modern';

const MAP_KEY = 'seatrader.mapStyle';

function readMapStyle(): MapStyle {
  try {
    return localStorage.getItem(MAP_KEY) === 'modern' ? 'modern' : 'pixel';
  } catch {
    return 'pixel';
  }
}

export const mapStyle = signal<MapStyle>(readMapStyle());

export function setMapStyle(style: MapStyle) {
  mapStyle.value = style;
  try {
    localStorage.setItem(MAP_KEY, style);
  } catch {
    /* storage unavailable: keep for this session only */
  }
}
