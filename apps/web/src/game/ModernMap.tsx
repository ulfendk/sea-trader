import { useEffect, useRef, useState } from 'preact/hooks';
import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, Map as MlMap, MapMouseEvent } from 'maplibre-gl';
import { PORTS, gameTime, portLocalTime, subsolarPoint } from '@sea-trader/shared';
import { liveDay, pub } from '../net';
import { colorHex } from '../ui';
import { shipPosition, shipRouteFor } from './mapdata';

/** Free vector map style: OpenStreetMap data served by OpenFreeMap, no API key needed. */
export const MODERN_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

interface Props {
  myId: string;
  selectedShip: string | null;
  onSelectShip: (id: string) => void;
  onSelectPort?: (id: string) => void;
  highlightPorts?: string[];
  /** Called when the map library or style can't be loaded (offline, blocked). */
  onFail: (reason: string) => void;
}

type Feature = GeoFeature<Geometry, Record<string, unknown>>;
const fc = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features });

/** Polygon covering the night side of the Earth at an instant (clipped to Web Mercator's latitude range). */
function nightPolygon(ts: number): Feature {
  const sun = subsolarPoint(ts);
  const r = Math.PI / 180;
  // Avoid a degenerate terminator at the equinoxes.
  const dec = Math.abs(sun.lat) < 0.1 ? (sun.lat < 0 ? -0.1 : 0.1) : sun.lat;
  const ring: [number, number][] = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const lat = Math.atan(-Math.cos((lon - sun.lon) * r) / Math.tan(dec * r)) / r;
    ring.push([lon, Math.max(-85, Math.min(85, lat))]);
  }
  // The pole facing away from the sun is in darkness.
  const pole = dec > 0 ? -85 : 85;
  ring.push([180, pole], [-180, pole], ring[0]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** Circle of `radiusNm` around a point, as a polygon (good enough away from the poles). */
function circlePolygon(lon: number, lat: number, radiusNm: number, props: Record<string, unknown>): Feature {
  const dLat = radiusNm / 60;
  const dLon = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([lon + Math.cos(a) * dLon, Math.max(-85, Math.min(85, lat + Math.sin(a) * dLat))]);
  }
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/**
 * The world map drawn on a modern, zoomable street map (MapLibre GL + OpenFreeMap).
 * Same props as the pixel `WorldMap`; game data is drawn as GeoJSON layers on top.
 */
export function ModernMap({
  myId,
  selectedShip,
  onSelectShip,
  onSelectPort,
  highlightPorts = [],
  onFail,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const props = useRef({ myId, selectedShip, onSelectShip, onSelectPort, highlightPorts, onFail });
  props.current = { myId, selectedShip, onSelectShip, onSelectPort, highlightPorts, onFail };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let observer: ResizeObserver | undefined;
    let loaded = false;
    const fail = (reason: string) => {
      if (cancelled) return;
      cancelled = true;
      props.current.onFail(reason);
    };

    (async () => {
      let maplibregl: typeof import('maplibre-gl');
      try {
        const mod = await import('maplibre-gl');
        // The package is a UMD bundle: Vite exposes it as the default export.
        maplibregl = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
        await import('maplibre-gl/dist/maplibre-gl.css');
      } catch {
        fail('The modern map could not be loaded.');
        return;
      }
      if (cancelled || !container.current) return;

      const map = new maplibregl.Map({
        container: container.current,
        style: MODERN_MAP_STYLE,
        center: [20, 20],
        zoom: 0.8,
        minZoom: 0,
        maxZoom: 12,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      });
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current = map;

      const giveUp = setTimeout(() => !loaded && fail('The map service did not respond.'), 20000);
      map.on('error', (e: { error?: unknown }) => {
        // Only a failure before the style is ready means the map is unusable; tile hiccups are fine.
        if (!loaded) {
          console.warn('modern map error', e.error);
          fail('The map service could not be reached.');
        }
      });

      map.on('load', () => {
        loaded = true;
        clearTimeout(giveUp);
        map.fitBounds(
          [
            [-170, -58],
            [190, 72],
          ],
          { animate: false, padding: 0 },
        );
        map.addSource('night', { type: 'geojson', data: fc([]) });
        map.addSource('storms', { type: 'geojson', data: fc([]) });
        map.addSource('route', { type: 'geojson', data: fc([]) });
        map.addSource('ports', { type: 'geojson', data: fc([]) });
        map.addSource('ships', { type: 'geojson', data: fc([]) });
        map.addLayer({
          id: 'night',
          type: 'fill',
          source: 'night',
          paint: { 'fill-color': '#04081f', 'fill-opacity': 0.28 },
        });
        map.addLayer({
          id: 'storms-fill',
          type: 'fill',
          source: 'storms',
          paint: {
            'fill-color': ['case', ['==', ['get', 'severity'], 'red'], '#c83030', '#f09628'],
            'fill-opacity': 0.3,
          },
        });
        map.addLayer({
          id: 'storms-line',
          type: 'line',
          source: 'storms',
          paint: {
            'line-color': ['case', ['==', ['get', 'severity'], 'red'], '#c83030', '#f09628'],
            'line-width': 2,
            'line-dasharray': [3, 2],
          },
        });
        map.addLayer({
          id: 'route',
          type: 'line',
          source: 'route',
          paint: { 'line-color': '#101010', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
        map.addLayer({
          id: 'ports',
          type: 'circle',
          source: 'ports',
          paint: {
            'circle-radius': 6,
            'circle-color': ['case', ['get', 'blink'], '#f8f8f8', '#f0d040'],
            'circle-stroke-color': '#101010',
            'circle-stroke-width': 2,
          },
        });
        // Labels need the style's fonts; skip them if the style has none.
        if (map.getStyle().glyphs)
          map.addLayer({
            id: 'port-labels',
            type: 'symbol',
            source: 'ports',
            minzoom: 1.5,
            layout: {
              'text-field': ['get', 'name'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'text-offset': [0.9, 0],
              'text-anchor': 'left',
            },
            paint: { 'text-color': '#101010', 'text-halo-color': '#f8f8f8', 'text-halo-width': 1.5 },
          });
        map.addLayer({
          id: 'ships',
          type: 'circle',
          source: 'ships',
          paint: {
            'circle-radius': ['case', ['get', 'selected'], 8, 5],
            'circle-color': ['case', ['get', 'blink'], '#f8f8f8', ['get', 'color']],
            'circle-stroke-color': [
              'case',
              ['get', 'selected'],
              '#f8f8f8',
              ['get', 'mine'],
              '#101010',
              'rgba(0,0,0,0.4)',
            ],
            'circle-stroke-width': ['case', ['get', 'selected'], 3, ['get', 'mine'], 2, 1],
          },
        });

        const rank = (id: string) => (id === 'ships' ? 0 : id === 'ports' ? 1 : 2);
        const pick = (e: MapMouseEvent) =>
          map
            .queryRenderedFeatures(e.point, { layers: ['ships', 'ports', 'storms-fill'] })
            .sort(
              (a: { layer: { id: string } }, b: { layer: { id: string } }) =>
                rank(a.layer.id) - rank(b.layer.id),
            )[0];
        map.on('click', (e: MapMouseEvent) => {
          const f = pick(e);
          if (!f) return;
          const id = String(f.properties?.id);
          if (f.layer.id === 'ships') props.current.onSelectShip(id);
          else if (f.layer.id === 'ports') props.current.onSelectPort?.(id);
        });
        map.on('mousemove', (e: MapMouseEvent) => {
          const f = pick(e);
          map.getCanvas().style.cursor = f ? 'pointer' : '';
          setTip(f ? { x: e.point.x + 12, y: e.point.y + 12, text: String(f.properties?.label) } : null);
        });
        map.on('mouseout', () => setTip(null));

        const render = () => {
          const p = pub.value;
          const now = p ? gameTime(p.startTs, liveDay()) : Date.now();
          const blink = Math.floor(Date.now() / 500) % 2 === 0;
          const { myId: mine, selectedShip: sel, highlightPorts: hl } = props.current;
          (map.getSource('night') as GeoJSONSource).setData(fc([nightPolygon(now)]));
          (map.getSource('ports') as GeoJSONSource).setData(
            fc(
              PORTS.map((port) => ({
                type: 'Feature',
                properties: {
                  id: port.id,
                  name: port.name,
                  label: `${port.name} · ${portLocalTime(port.tz, now)}`,
                  blink: hl.includes(port.id) && blink,
                },
                geometry: { type: 'Point', coordinates: [port.lon, port.lat] },
              })),
            ),
          );
          if (!p) return;
          (map.getSource('storms') as GeoJSONSource).setData(
            fc(
              (p.storms ?? []).map((st) =>
                circlePolygon(st.lon, st.lat, st.radiusNm, {
                  id: st.id,
                  severity: st.severity,
                  label: `🌀 ${st.name}${st.windKmh ? ` · ${st.windKmh} km/h` : ''}`,
                }),
              ),
            ),
          );
          const day = liveDay();
          const ships = Object.values(p.ships).sort(
            (a, b) =>
              Number(a.owner === mine) - Number(b.owner === mine) ||
              Number(a.id === sel) - Number(b.id === sel),
          );
          (map.getSource('ships') as GeoJSONSource).setData(
            fc(
              ships.map((s) => {
                const pos = shipPosition(s, p.day, day);
                return {
                  type: 'Feature',
                  properties: {
                    id: s.id,
                    label: `${s.name} (${p.players[s.owner]?.company ?? '?'})`,
                    color: colorHex(p.players[s.owner]?.color ?? 0xffffff),
                    mine: s.owner === mine,
                    selected: s.id === sel,
                    blink: s.waiting && s.owner === mine && blink,
                  },
                  geometry: { type: 'Point', coordinates: [pos.lon, pos.lat] },
                };
              }),
            ),
          );
          const selShip = sel ? p.ships[sel] : null;
          const route =
            selShip && (selShip.status === 'at_sea' || selShip.status === 'awaiting_pilot')
              ? shipRouteFor(selShip)
              : null;
          (map.getSource('route') as GeoJSONSource).setData(
            fc(
              route
                ? [
                    {
                      type: 'Feature',
                      properties: {},
                      geometry: { type: 'LineString', coordinates: route.points },
                    },
                  ]
                : [],
            ),
          );
        };
        render();
        timer = setInterval(render, 1000);
      });

      // Keep the canvas sized to its box (e.g. after a hidden mobile tab becomes visible again).
      observer = new ResizeObserver(() => {
        if (container.current?.clientWidth) map.resize();
      });
      observer.observe(container.current);
    })();

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Follow the selected ship when zoomed in, like the pixel map.
  useEffect(() => {
    const map = mapRef.current;
    const p = pub.value;
    if (!map || !selectedShip || !p?.ships[selectedShip] || map.getZoom() < 2) return;
    const pos = shipPosition(p.ships[selectedShip], p.day, liveDay());
    map.easeTo({ center: [pos.lon, pos.lat], duration: 600 });
  }, [selectedShip]);

  return (
    <div class="modern-map">
      <div ref={container} class="modern-map-canvas" aria-label="World map" />
      {tip && (
        <div class="map-tip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }}>
          {tip.text}
        </div>
      )}
    </div>
  );
}
