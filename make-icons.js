// Draws the app icons (a ring in the seven section colours on warm charcoal) as PNG files.
// Usage: node make-icons.js
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const HUES = ['#F0B040', '#FF8B5E', '#F47FA4', '#DE8FCE', '#D9A877', '#B7CE5C', '#5FD39A'].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
const BG = [0x19, 0x18, 0x16];
const crcTable = [...Array(256)].map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function icon(size, { pad = 0.2, rounded = true } = {}) {
  const raw = Buffer.alloc((size * 4 + 1) * size), c = size / 2, R = size * (0.5 - pad), r = R * 0.56, corner = size * 0.22, SS = 3;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS, dx = px - c, dy = py - c, d = Math.hypot(dx, dy);
        let inside = true;
        if (rounded) { const qx = Math.max(Math.abs(dx) - (c - corner), 0), qy = Math.max(Math.abs(dy) - (c - corner), 0); inside = Math.hypot(qx, qy) <= corner; }
        if (!inside) continue;
        let col = BG;
        if (d <= R && d >= r) { const a = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1 * HUES.length, i = Math.floor(a); col = mix(HUES[i % HUES.length], HUES[(i + 1) % HUES.length], a - i); }
        acc = [acc[0] + col[0], acc[1] + col[1], acc[2] + col[2], acc[3] + 255];
      }
      const n = SS * SS, cov = acc[3] / 255, o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = cov ? Math.round(acc[0] / cov) : 0; raw[o + 1] = cov ? Math.round(acc[1] / cov) : 0; raw[o + 2] = cov ? Math.round(acc[2] / cov) : 0; raw[o + 3] = Math.round(acc[3] / n);
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const dir = path.join(__dirname, 'icons'); fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon-192.png'), icon(192));
fs.writeFileSync(path.join(dir, 'icon-512.png'), icon(512));
fs.writeFileSync(path.join(dir, 'icon-maskable-512.png'), icon(512, { pad: 0.27, rounded: false }));
fs.writeFileSync(path.join(dir, 'apple-touch-icon.png'), icon(180, { rounded: false }));
console.log('icons written');
