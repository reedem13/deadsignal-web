// Project Deadsignal - tiny static server + WebSocket room relay.
// Host is authoritative for game logic; this server only groups sockets per room and forwards messages.
// Up to 5 players per room: slot 0 = host, slots 1..4 = guests. Host -> every guest (or just `to` = one slot);
// guest -> host only, tagged with `from` = its slot. A 'roster' of open slots goes to everyone on every change.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUB = path.join(__dirname, 'public');
const MAP_DIR = path.join(__dirname, 'data', 'maps');
const ACTIVE_FILE = path.join(MAP_DIR, 'active.txt');
const MAX_GUESTS = 4; // 5 players total
const ROOM_TTL_MS = 3 * 60 * 1000; // keep an empty room around so phones can reconnect after app switching
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

function mapIdOf(id) {
  const s = String(id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  if (!s || s === 'yard' || s === 'default' || s === 'playtest') return '';
  return s;
}
function mapFile(id) { const s = mapIdOf(id); return s ? path.join(MAP_DIR, s + '.json') : null; }
function readActive() {
  try { return mapIdOf(fs.readFileSync(ACTIVE_FILE, 'utf8').trim()); } catch { return ''; }
}
function readMapFile(id) {
  const f = mapFile(id);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
function listMaps() {
  try { fs.mkdirSync(MAP_DIR, { recursive: true }); } catch { /* already there */ }
  let names = [];
  try { names = fs.readdirSync(MAP_DIR).filter((n) => n.endsWith('.json')); } catch { return []; }
  return names.map((n) => {
    const id = n.slice(0, -5);
    const doc = readMapFile(id);
    return doc && Array.isArray(doc.pieces) ? { id, name: doc.name || id } : null;
  }).filter(Boolean);
}
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function chooseId(doc) {
  return mapIdOf(doc.id) || mapIdOf(String(doc.name || 'mission').replace(/\s+/g, '-')) || 'mission';
}
async function handleMap(req, res, u) {
  const q = new URL(req.url, 'http://localhost').searchParams;
  if (req.method === 'GET' && u === '/api/maps') return sendJson(res, 200, { active: readActive(), maps: listMaps() });
  if (req.method === 'GET' && u === '/api/map') {
    const want = q.get('id') || '';
    if (want === 'yard' || want === 'default') return sendJson(res, 200, { active: false, id: 'yard' });
    const id = want ? mapIdOf(want) : readActive();
    if (!id) return sendJson(res, 200, { active: false });
    const map = readMapFile(id);
    if (!map) return sendJson(res, want ? 404 : 200, want ? { error: 'no map ' + id } : { active: false });
    return sendJson(res, 200, { active: readActive() === id, id, map });
  }
  if (req.method === 'POST' && (u === '/api/maps' || u === '/api/map')) {
    let doc;
    try { doc = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: 'Send a map JSON file.' }); }
    if (!doc || !Array.isArray(doc.pieces) || doc.pieces.length > 4000) return sendJson(res, 400, { error: 'That is not a Deadsignal map.' });
    const id = chooseId(doc);
    doc.version = 1; doc.id = id;
    try { fs.mkdirSync(MAP_DIR, { recursive: true }); fs.writeFileSync(mapFile(id), JSON.stringify(doc)); }
    catch { return sendJson(res, 500, { error: 'Could not store the map.' }); }
    return sendJson(res, 200, { ok: true, id, name: doc.name || id });
  }
  if (req.method === 'POST' && u === '/api/maps/active') {
    let body = {};
    try { body = JSON.parse(await readBody(req) || '{}'); } catch { return sendJson(res, 400, { error: 'bad json' }); }
    const id = mapIdOf(body.id);
    if (id && !readMapFile(id)) return sendJson(res, 404, { error: 'Save the map first.' });
    try {
      fs.mkdirSync(MAP_DIR, { recursive: true });
      if (!id) fs.rmSync(ACTIVE_FILE, { force: true });
      else fs.writeFileSync(ACTIVE_FILE, id);
    } catch { return sendJson(res, 500, { error: 'Could not update the game map.' }); }
    return sendJson(res, 200, { ok: true, active: id || null });
  }
  sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (u === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok ' + rooms.size + ' rooms'); }
  if (u === '/api/map' || u === '/api/maps' || u === '/api/maps/active') {
    handleMap(req, res, u).catch(() => { if (!res.headersSent) sendJson(res, 500, { error: 'map error' }); });
    return;
  }
  if (u === '/editor') u = '/editor.html';
  if (u === '/') u = '/index.html';
  const f = path.normalize(path.join(PUB, u));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map(); // code -> { host, guests: [ws|null x4], timer }

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += LETTERS[(Math.random() * LETTERS.length) | 0]; } while (rooms.has(c));
  return c;
}
const open = (ws) => ws && ws.readyState === 1;
function send(ws, o) { if (open(ws)) ws.send(JSON.stringify(o)); }
const members = (room) => [room.host, ...room.guests];
const roster = (room) => members(room).map(open);
function touch(room, code) {
  clearTimeout(room.timer);
  if (!members(room).some(open)) room.timer = setTimeout(() => rooms.delete(code), ROOM_TTL_MS);
}
function broadcastRoster(room) { const r = roster(room); for (const ws of members(room)) send(ws, { t: 'roster', slots: r }); }
function attach(ws, code, slot) {
  const room = rooms.get(code);
  if (slot === 0) room.host = ws; else room.guests[slot - 1] = ws;
  ws.room = code; ws.slot = slot; ws.role = slot === 0 ? 'host' : 'guest';
  touch(room, code);
  const peers = members(room).some((m, i) => i !== slot && open(m));
  send(ws, { t: slot === 0 ? 'created' : 'joined', code, slot, peer: peers, slots: roster(room) });
  for (const [i, m] of members(room).entries()) if (i !== slot && open(m)) send(m, { t: 'peer-joined', slot });
  broadcastRoster(room);
}
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'relay') {
      const room = ws.room && rooms.get(ws.room);
      if (!room) return;
      if (ws.slot === 0) { // host -> one guest (to) or all of them
        const out = JSON.stringify({ t: 'msg', d: m.d });
        if (m.to != null) { const g = room.guests[m.to - 1]; if (open(g)) g.send(out); }
        else for (const g of room.guests) if (open(g)) g.send(out);
      } else if (open(room.host) && m.d && typeof m.d === 'object') { m.d.from = ws.slot; room.host.send(JSON.stringify({ t: 'msg', d: m.d })); }
      return;
    }
    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
    if (m.t === 'create') {
      const want = String(m.code || '').toUpperCase().slice(0, 4);
      if (want && rooms.has(want)) {
        const room = rooms.get(want);
        if (!open(room.host)) return attach(ws, want, 0); // host reconnecting
        return send(ws, { t: 'error', msg: 'Room ' + want + ' already has a host.' });
      }
      const code = want && m.resume && /^[A-Z]{4}$/.test(want) ? want : newCode();
      rooms.set(code, { host: null, guests: Array(MAX_GUESTS).fill(null), timer: null });
      return attach(ws, code, 0);
    }
    if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'No room called ' + code + '. Check the code with your partner.' });
      // reconnecting guests ask for their old slot back; otherwise the first free one
      const want = m.slot >= 1 && m.slot <= MAX_GUESTS && !open(room.guests[m.slot - 1]) ? m.slot : room.guests.findIndex((g) => !open(g) || g === ws) + 1;
      if (want < 1) return send(ws, { t: 'error', msg: 'Room ' + code + ' is full (' + (MAX_GUESTS + 1) + ' players max).' });
      return attach(ws, code, want);
    }
  });
  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    const mine = ws.slot === 0 ? room.host === ws : room.guests[ws.slot - 1] === ws;
    if (mine) {
      if (ws.slot === 0) room.host = null; else room.guests[ws.slot - 1] = null;
      for (const m of members(room)) send(m, { t: 'peer-left', slot: ws.slot });
      broadcastRoster(room);
      touch(room, ws.room);
    }
  });
});

// Heartbeat keeps tunnels (ngrok/cloudflared) and mobile NATs from dropping idle sockets.
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
}, 20000);

server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log('Project Deadsignal server running');
  console.log('  Local:   http://localhost:' + PORT);
  ips.forEach((ip) => console.log('  On WiFi: http://' + ip + ':' + PORT));
  console.log('For phones on different networks, run a tunnel, e.g.: npx cloudflared tunnel --url http://localhost:' + PORT);
});
