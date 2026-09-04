const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { db, isMember } = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'chatspace-mvp-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, 'public')));

io.engine.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  next();
}

const USER_RE = /^[A-Za-z0-9_-]{3,20}$/;

// --- Auth ---
app.post('/api/register', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  if (!USER_RE.test(username)) return res.status(400).json({ error: 'username 3-20: A-Z a-z 0-9 _ -' });
  if (typeof password !== 'string' || password.length < 4) return res.status(400).json({ error: 'password min 4' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const r = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
    req.session.userId = r.lastInsertRowid;
    req.session.username = username;
    res.json({ id: r.lastInsertRowid, username });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'username taken' });
    throw e;
  }
});

app.post('/api/login', (req, res) => {
  const { username = '', password = '' } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) {
    return res.status(401).json({ error: 'invalid credentials' });
  }
  req.session.userId = u.id;
  req.session.username = u.username;
  res.json({ id: u.id, username: u.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'unauthorized' });
  res.json({ id: req.session.userId, username: req.session.username });
});

app.get('/api/users', requireAuth, (req, res) => {
  const q = `%${req.query.q || ''}%`;
  const rows = db.prepare("SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 20").all(q, req.session.userId);
  res.json(rows);
});

// --- Rooms ---
app.get('/api/rooms', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.name, r.description, r.created_at
    FROM rooms r JOIN room_members m ON m.room_id = r.id
    WHERE m.user_id = ? ORDER BY r.id DESC`).all(req.session.userId);
  res.json(rows);
});

app.post('/api/rooms', requireAuth, (req, res) => {
  const { name = '', description = '', memberUsernames = [] } = req.body || {};
  if (!name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const memberIds = [];
    for (const uname of new Set(memberUsernames || [])) {
      const u = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
      if (!u) return res.status(400).json({ error: `unknown user: ${uname}` });
      memberIds.push(u.id);
    }
    const r = db.prepare('INSERT INTO rooms (name, description, created_by) VALUES (?, ?, ?)')
      .run(name.trim(), String(description || ''), req.session.userId);
    const roomId = Number(r.lastInsertRowid);
    db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)').run(roomId, req.session.userId);
    for (const uid of memberIds) {
      db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)').run(roomId, uid);
    }
    res.json({ id: roomId, name: name.trim() });
    io.emit('rooms-changed');
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

function checkMember(req, res, next) {
  const roomId = Number(req.params.id);
  if (!isMember(roomId, req.session.userId)) return res.status(403).json({ error: 'not a member' });
  req.roomId = roomId;
  next();
}

app.get('/api/rooms/:id', requireAuth, checkMember, (req, res) => {
  const room = db.prepare('SELECT id, name, description, created_at FROM rooms WHERE id = ?').get(req.roomId);
  const members = db.prepare(`
    SELECT u.id, u.username, m.joined_at FROM room_members m
    JOIN users u ON u.id = m.user_id WHERE m.room_id = ? ORDER BY u.username`).all(req.roomId);
  res.json({ ...room, members });
});

app.post('/api/rooms/:id/members', requireAuth, checkMember, (req, res) => {
  const { username } = req.body || {};
  const u = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!u) return res.status(400).json({ error: `unknown user: ${username}` });
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)').run(req.roomId, u.id);
  io.emit('rooms-changed');
  res.json({ ok: true });
});

app.get('/api/rooms/:id/messages', requireAuth, checkMember, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const rows = db.prepare(`
    SELECT m.id, m.body, m.created_at, u.username FROM messages m
    LEFT JOIN users u ON u.id = m.user_id
    WHERE m.room_id = ? ORDER BY m.id DESC LIMIT ?`).all(req.roomId, limit);
  res.json(rows.reverse());
});

app.get('/api/rooms/:id/events', requireAuth, checkMember, (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50), 200);
  const rows = db.prepare(`
    SELECT e.id, e.event_type, e.created_at, u.username FROM room_events e
    LEFT JOIN users u ON u.id = e.user_id
    WHERE e.room_id = ? ORDER BY e.id DESC LIMIT ?`).all(req.roomId, limit);
  res.json(rows.reverse());
});

// --- Socket.IO ---
const roomKey = (id) => `room:${id}`;
const presence = new Map(); // roomId -> Map(socketId -> {userId, username})
const videoPeers = new Map(); // roomId -> Map(socketId -> {userId, username, muted, camOff})

function getSession(socket) {
  return socket.request.session || {};
}

io.use((socket, next) => {
  const s = getSession(socket);
  if (!s.userId) return next(new Error('unauthorized'));
  next();
});

function broadcastPresence(roomId) {
  const set = presence.get(roomId) || new Map();
  const users = [...new Set([...set.values()].map((p) => p.username))];
  io.to(roomKey(roomId)).emit('presence', { roomId, users });
}

function broadcastVideoPeers(roomId) {
  const peers = [...(videoPeers.get(roomId) || new Map()).entries()].map(([socketId, p]) => ({ socketId, ...p }));
  io.to(roomKey(roomId)).emit('video-peers', { roomId, peers });
}

io.on('connection', (socket) => {
  const { userId, username } = getSession(socket);

  socket.on('join-room', ({ roomId }) => {
    roomId = Number(roomId);
    if (!isMember(roomId, userId)) return socket.emit('error-message', { error: 'not a member' });
    socket.join(roomKey(roomId));
    if (!presence.has(roomId)) presence.set(roomId, new Map());
    presence.get(roomId).set(socket.id, { userId, username });
    db.prepare("INSERT INTO room_events (room_id, user_id, event_type) VALUES (?, ?, 'join')").run(roomId, userId);
    io.to(roomKey(roomId)).emit('room-event', { roomId, type: 'join', username, createdAt: new Date().toISOString() });
    broadcastPresence(roomId);
  });

  socket.on('leave-room', ({ roomId }) => {
    roomId = Number(roomId);
    socket.leave(roomKey(roomId));
    presence.get(roomId)?.delete(socket.id);
    if (isMember(roomId, userId)) {
      db.prepare("INSERT INTO room_events (room_id, user_id, event_type) VALUES (?, ?, 'leave')").run(roomId, userId);
      io.to(roomKey(roomId)).emit('room-event', { roomId, type: 'leave', username, createdAt: new Date().toISOString() });
    }
    broadcastPresence(roomId);
  });

  socket.on('send-message', ({ roomId, body }) => {
    roomId = Number(roomId);
    body = String(body || '').trim();
    if (!body) return;
    if (!isMember(roomId, userId)) return socket.emit('error-message', { error: 'not a member' });
    const r = db.prepare('INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)').run(roomId, userId, body.slice(0, 2000));
    const row = db.prepare('SELECT created_at FROM messages WHERE id = ?').get(r.lastInsertRowid);
    db.prepare("INSERT INTO room_events (room_id, user_id, event_type) VALUES (?, ?, 'send')").run(roomId, userId);
    io.to(roomKey(roomId)).emit('chat-message', { roomId, id: r.lastInsertRowid, username, body: body.slice(0, 2000), createdAt: row.created_at });
  });

  // Video (ephemeral, per-room)
  socket.on('video-join', ({ roomId }) => {
    roomId = Number(roomId);
    if (!isMember(roomId, userId)) return;
    socket.join(roomKey(roomId));
    if (!videoPeers.has(roomId)) videoPeers.set(roomId, new Map());
    videoPeers.get(roomId).set(socket.id, { userId, username, muted: false, camOff: false });
    io.to(roomKey(roomId)).emit('room-event', { roomId, type: 'video-join', username, createdAt: new Date().toISOString() });
    broadcastVideoPeers(roomId);
  });
  socket.on('video-leave', ({ roomId }) => {
    roomId = Number(roomId);
    videoPeers.get(roomId)?.delete(socket.id);
    io.to(roomKey(roomId)).emit('room-event', { roomId, type: 'video-leave', username, createdAt: new Date().toISOString() });
    broadcastVideoPeers(roomId);
  });
  socket.on('video-state', ({ roomId, muted, camOff }) => {
    roomId = Number(roomId);
    const p = videoPeers.get(roomId)?.get(socket.id);
    if (p) { p.muted = !!muted; p.camOff = !!camOff; broadcastVideoPeers(roomId); }
  });
  for (const ev of ['video-offer', 'video-answer', 'ice-candidate']) {
    socket.on(ev, ({ roomId, to, payload }) => {
      roomId = Number(roomId);
      if (!isMember(roomId, userId)) return;
      io.to(to).emit(ev, { from: socket.id, username, payload });
    });
  }

  // Whiteboard (ephemeral relay)
  socket.on('whiteboard-stroke', ({ roomId, stroke }) => {
    roomId = Number(roomId);
    if (!isMember(roomId, userId)) return;
    socket.to(roomKey(roomId)).emit('whiteboard-stroke', { roomId, username, stroke });
  });
  socket.on('whiteboard-clear-mine', ({ roomId }) => {
    roomId = Number(roomId);
    if (!isMember(roomId, userId)) return;
    io.to(roomKey(roomId)).emit('whiteboard-clear-mine', { roomId, username });
  });

  socket.on('disconnect', () => {
    for (const [roomId, map] of presence) {
      if (map.delete(socket.id)) broadcastPresence(roomId);
    }
    for (const [roomId, map] of videoPeers) {
      if (map.delete(socket.id)) {
        io.to(roomKey(roomId)).emit('room-event', { roomId, type: 'video-leave', username, createdAt: new Date().toISOString() });
        broadcastVideoPeers(roomId);
      }
    }
  });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (require.main === module) {
  server.listen(PORT, () => console.log(`ChatSpace on http://localhost:${PORT}`));
}
module.exports = { app, server };
