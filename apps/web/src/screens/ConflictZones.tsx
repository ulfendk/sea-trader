import { useEffect, useRef, useState } from 'preact/hooks';
import type { ConflictLevel, ConflictZone } from '@sea-trader/shared';
import { api } from '../api';
import { toast } from '../toast';
import { CELL, LAT_BOTTOM, LAT_TOP, getLandCanvas, project } from '../game/mapdata';
import { errText } from '../game/util';

const LEVELS: [ConflictLevel, string][] = [
  ['elevated', 'Elevated risk'],
  ['high', 'High risk'],
  ['war', 'War zone'],
];
const LEVEL_RGB: Record<ConflictLevel, string> = {
  elevated: '190,110,170',
  high: '200,48,120',
  war: '176,16,72',
};

/** Admin editor for the server-wide conflict zones, applied to every game that uses them. */
export function ConflictZonesTab() {
  const [zones, setZones] = useState<ConflictZone[]>([]);
  const [selected, setSelected] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = (list: ConflictZone[]) => {
    setZones(list);
    setDirty(false);
    setSelected((i) => Math.min(i, Math.max(0, list.length - 1)));
  };
  useEffect(() => {
    api<{ zones: ConflictZone[] }>('GET', '/admin/conflicts')
      .then((r) => apply(r.zones))
      .catch((e) => toast(errText(e), 'err'));
  }, []);

  const update = (i: number, patch: Partial<ConflictZone>) => {
    setZones((list) => list.map((z, k) => (k === i ? { ...z, ...patch } : z)));
    setDirty(true);
  };
  const send = async (method: string, path: string, body?: unknown, ok = 'Saved') => {
    setBusy(true);
    try {
      const r = await api<{ zones: ConflictZone[] }>(method, path, body);
      apply(r.zones);
      toast(ok, 'ok');
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const z = zones[selected];
  return (
    <div class="col" style={{ gap: '14px' }}>
      <p class="small-text muted" style={{ margin: 0 }}>
        Zones apply to every game with conflict zones switched on. Ships entering one must choose between
        paying war-risk cover to sail through (with a risk of attack) and avoiding it for the extra days set
        here. Changes appear in each game&apos;s news. Click the map to move the selected zone.
      </p>
      <ZoneMap
        zones={zones}
        selected={selected}
        onPick={(lon, lat) => z && update(selected, { lon, lat })}
        onSelect={setSelected}
      />
      <div class="scroll-x">
        <table class="small-text">
          <thead>
            <tr>
              <th>Name</th>
              <th>Level</th>
              <th>Lat</th>
              <th>Lon</th>
              <th>Radius (nm)</th>
              <th>Avoid (+days)</th>
              <th>Note for players</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zones.map((zone, i) => (
              <tr
                key={zone.id}
                class={i === selected ? 'selected' : ''}
                onFocusCapture={() => setSelected(i)}
                onClick={() => setSelected(i)}
              >
                <td>
                  <input
                    value={zone.name}
                    maxLength={60}
                    onInput={(e) => update(i, { name: e.currentTarget.value })}
                  />
                </td>
                <td>
                  <select
                    value={zone.level}
                    onChange={(e) => update(i, { level: e.currentTarget.value as ConflictLevel })}
                  >
                    {LEVELS.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                {(['lat', 'lon', 'radiusNm', 'detourDays'] as const).map((k) => (
                  <td key={k}>
                    <input
                      type="number"
                      step="any"
                      style={{ width: '80px' }}
                      value={zone[k]}
                      onInput={(e) => update(i, { [k]: Number(e.currentTarget.value) })}
                    />
                  </td>
                ))}
                <td>
                  <input
                    value={zone.note ?? ''}
                    maxLength={200}
                    style={{ minWidth: '220px' }}
                    onInput={(e) => update(i, { note: e.currentTarget.value })}
                  />
                </td>
                <td class="num">
                  <button
                    class="small danger"
                    onClick={() => {
                      setZones((list) => list.filter((_, k) => k !== i));
                      setDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {zones.length === 0 && <p class="small-text muted">No conflict zones.</p>}
      <div class="row">
        <button
          onClick={() => {
            setZones((list) => [
              ...list,
              { id: '', name: 'New zone', lon: 0, lat: 0, radiusNm: 200, level: 'elevated', detourDays: 1 },
            ]);
            setSelected(zones.length);
            setDirty(true);
          }}
        >
          Add zone
        </button>
        <button
          class="primary"
          disabled={!dirty || busy}
          onClick={() => send('PUT', '/admin/conflicts', { zones })}
        >
          Save changes
        </button>
        {dirty && <span class="small-text muted">Unsaved changes</span>}
        <span style={{ flex: 1 }} />
        <button
          class="danger"
          disabled={busy}
          onClick={() => {
            if (confirm('Replace all zones with the built-in starting list?'))
              void send('POST', '/admin/conflicts/reset', {}, 'Zones reset');
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}

const MAP_W = 360 * CELL;
const MAP_H = (LAT_TOP - LAT_BOTTOM) * CELL;

function ZoneMap({
  zones,
  selected,
  onPick,
  onSelect,
}: {
  zones: ConflictZone[];
  selected: number;
  onPick: (lon: number, lat: number) => void;
  onSelect: (i: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(getLandCanvas(), 0, 0);
    zones.forEach((z, i) => {
      const [x, y] = project(z.lon, z.lat);
      const r = (z.radiusNm / 60) * CELL;
      const rgb = LEVEL_RGB[z.level] ?? LEVEL_RGB.elevated;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},0.35)`;
      ctx.fill();
      ctx.lineWidth = i === selected ? 6 : 3;
      ctx.strokeStyle = i === selected ? '#f8f8f8' : `rgb(${rgb})`;
      ctx.stroke();
      ctx.fillStyle = '#101010';
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.fillStyle = i === selected ? '#f8f8f8' : `rgb(${rgb})`;
      ctx.fillRect(x - 3, y - 3, 6, 6);
    });
  }, [zones, selected]);

  return (
    <canvas
      ref={canvas}
      width={MAP_W}
      height={MAP_H}
      class="zone-map"
      style={{ width: '100%', imageRendering: 'pixelated', cursor: 'crosshair', border: '2px solid #101010' }}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const lon = ((e.clientX - r.left) / r.width) * 360 - 180;
        const lat = LAT_TOP - ((e.clientY - r.top) / r.height) * (LAT_TOP - LAT_BOTTOM);
        // Clicking inside another zone selects it; elsewhere moves the selected zone.
        const hit = zones.findIndex(
          (z, i) => i !== selected && Math.hypot(z.lon - lon, z.lat - lat) < Math.max(2, z.radiusNm / 60 / 2),
        );
        if (hit >= 0) onSelect(hit);
        else onPick(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
      }}
    />
  );
}
