// Generates the pixel-art PWA icons (run once: node scripts/gen-icons.mjs).
import fs from 'node:fs';
import zlib from 'node:zlib';

const ANCHOR = [
  '................',
  '.......##.......',
  '......#..#......',
  '.......##.......',
  '.......##.......',
  '....########....',
  '.......##.......',
  '.......##.......',
  '.......##.......',
  '.#.....##.....#.',
  '.##....##....##.',
  '..##...##...##..',
  '...###.##.###...',
  '.....######.....',
  '.......##.......',
  '................',
];
const BG = [0x1d, 0x35, 0x66];
const WAVE = [0x2a, 0x4d, 0x8f];
const FG = [0xf0, 0xd0, 0x40];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, padCells) {
  const cells = 16 + padCells * 2;
  const scale = size / cells;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / scale) - padCells;
      const cy = Math.floor(y / scale) - padCells;
      let col = BG;
      if (cy >= 13 + 0 && (cx + cy) % 4 === 0 && cy >= 14) col = WAVE;
      if (cx >= 0 && cy >= 0 && cx < 16 && cy < 16 && ANCHOR[cy][cx] === '#') col = FG;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0];
      raw[o + 1] = col[1];
      raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
fs.writeFileSync('public/icon-192.png', png(192, 2));
fs.writeFileSync('public/icon-512.png', png(512, 2));
fs.writeFileSync('public/icon-maskable-512.png', png(512, 4));
fs.writeFileSync('public/apple-touch-icon.png', png(180, 2));
fs.writeFileSync('public/favicon-32.png', png(32, 0));
console.log('icons written');
