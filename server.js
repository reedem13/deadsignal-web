// Project Deadsignal - tiny static server + WebSocket room relay.
// Host is authoritative for game logic; this server only pairs 2 sockets per room and forwards messages.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUB = path.join(__dirname, 'public');
const ROOM_TTL_MS = 3 * 60 * 1000; // keep an empty room around so phones can reconnect after app switching
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
};

const server = http.createServer((req, res) => {
  let u;
  try { u = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (u === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok ' + rooms.size + ' rooms'); }
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
const rooms = new Map(); // code -> { host, guest, timer }

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += LETTERS[(Math.random() * LETTERS.length) | 0]; } while (rooms.has(c));
  return c;
}
const open = (ws) => ws && ws.readyState === 1;
function send(ws, o) { if (open(ws)) ws.send(JSON.stringify(o)); }
function touch(room, code) {
  clearTimeout(room.timer);
  if (!open(room.host) && !open(room.guest)) room.timer = setTimeout(() => rooms.delete(code), ROOM_TTL_MS);
}
function attach(ws, code, role) {
  const room = rooms.get(code);
  room[role] = ws; ws.room = code; ws.role = role;
  touch(room, code);
  const peer = role === 'host' ? room.guest : room.host;
  send(ws, { t: role === 'host' ? 'created' : 'joined', code, peer: open(peer) });
  if (open(peer)) send(peer, { t: 'peer-joined' });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf); } catch { return; }
    if (m.t === 'relay') {
      const room = ws.room && rooms.get(ws.room);
      if (!room) return;
      const peer = ws.role === 'host' ? room.guest : room.host;
      if (open(peer)) peer.send(JSON.stringify({ t: 'msg', d: m.d }));
      return;
    }
    if (m.t === 'ping') return send(ws, { t: 'pong', ts: m.ts });
    if (m.t === 'create') {
      const want = String(m.code || '').toUpperCase().slice(0, 4);
      if (want && rooms.has(want)) {
        const room = rooms.get(want);
        if (!open(room.host)) return attach(ws, want, 'host'); // host reconnecting
        return send(ws, { t: 'error', msg: 'Room ' + want + ' already has a host.' });
      }
      const code = want && m.resume && /^[A-Z]{4}$/.test(want) ? want : newCode();
      rooms.set(code, { host: null, guest: null, timer: null });
      return attach(ws, code, 'host');
    }
    if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return send(ws, { t: 'error', msg: 'No room called ' + code + '. Check the code with your partner.' });
      if (open(room.guest) && room.guest !== ws) return send(ws, { t: 'error', msg: 'Room ' + code + ' is full (2 players max).' });
      return attach(ws, code, 'guest');
    }
  });
  ws.on('close', () => {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (room[ws.role] === ws) {
      room[ws.role] = null;
      send(ws.role === 'host' ? room.guest : room.host, { t: 'peer-left' });
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
