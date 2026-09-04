const $ = (id) => document.getElementById(id);
let me = null, socket = null, roomId = null;
let pcs = {}, localStream = null, muted = false, camOff = false;

async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'request failed');
  return j;
}
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso) => {
  try {
    const s = String(iso).includes('T') ? String(iso) : String(iso).replace(' ', 'T') + 'Z';
    const d = new Date(s);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getDate()} ${MO[d.getMonth()]} ${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
};

async function refreshMe() {
  try { me = await api('/api/me'); } catch { me = null; }
  $('auth').hidden = !!me; $('app').hidden = !me; $('logout').hidden = !me;
  $('me').textContent = me ? `User: ${me.username}` : '';
  if (me) { connectSocket(); loadRooms(); }
}
$('login').onclick = async () => {
  try { await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) }); refreshMe(); }
  catch (e) { $('authErr').textContent = e.message; }
};
$('register').onclick = async () => {
  try { await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) }); refreshMe(); }
  catch (e) { $('authErr').textContent = e.message; }
};
$('logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

async function loadRooms() {
  const rooms = await api('/api/rooms');
  $('rooms').innerHTML = '';
  rooms.forEach((r) => {
    const b = document.createElement('button');
    b.textContent = r.name; b.onclick = () => selectRoom(r.id, r.name);
    $('rooms').appendChild(b);
  });
}
$('newRoom').onclick = () => { $('roomErr').textContent = ''; $('roomModal').hidden = false; };
$('rCancel').onclick = () => $('roomModal').hidden = true;
$('refreshRooms').onclick = () => loadRooms();
$('rCreate').onclick = async () => {
  try {
    const memberUsernames = $('rMembers').value.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: $('rName').value, description: $('rDesc').value, memberUsernames }) });
    $('roomModal').hidden = true; loadRooms(); selectRoom(r.id, $('rName').value);
  } catch (e) { $('roomErr').textContent = e.message; }
};
$('addMember').onclick = async () => {
  try {
    if (!roomId) throw new Error('select a room first');
    await api(`/api/rooms/${roomId}/members`, { method: 'POST', body: JSON.stringify({ username: $('addMemberName').value.trim() }) });
    $('addMemberName').value = ''; $('memberErr').textContent = '';
    reloadMembers();
  } catch (e) { $('memberErr').textContent = e.message; }
};
async function reloadMembers() {
  if (!roomId) return;
  const info = await api(`/api/rooms/${roomId}`);
  $('members').textContent = info.members.map((m) => m.username).join(', ');
}

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.on('chat-message', (m) => { if (m.roomId === roomId) addMsg(`${m.username}: ${m.body}`, m.createdAt); });
  socket.on('room-event', (e) => { if (e.roomId === roomId) addSys(`${e.username} ${e.type}`, e.createdAt); });
  socket.on('presence', (p) => { if (p.roomId === roomId) $('online').textContent = p.users.join(', '); });
  socket.on('whiteboard-stroke', ({ roomId: rid, username, stroke }) => { if (rid === roomId) onRemoteStroke(username, stroke); });
  socket.on('whiteboard-clear-mine', ({ roomId: rid, username }) => { if (rid === roomId) onClearMine(username); });
  socket.on('video-peers', onPeers);
  socket.on('video-offer', onOffer);
  socket.on('video-answer', async ({ from, payload }) => pcs[from]?.setRemoteDescription(payload));
  socket.on('ice-candidate', async ({ from, payload }) => pcs[from]?.addIceCandidate(payload).catch(() => {}));
  socket.on('rooms-changed', () => loadRooms());
}

async function selectRoom(id, name) {
  if (roomId) socket.emit('leave-room', { roomId });
  leaveVideo();
  roomId = id; $('roomTitle').textContent = name; $('messages').innerHTML = '';
  socket.emit('join-room', { roomId });
  const [msgs, evs, info] = await Promise.all([
    api(`/api/rooms/${id}/messages`), api(`/api/rooms/${id}/events`), api(`/api/rooms/${id}`),
  ]);
  $('members').textContent = info.members.map((m) => m.username).join(', ');
  const timeline = [...msgs.map((m) => ({ t: m.created_at, s: `${m.username}: ${m.body}` })),
    ...evs.map((e) => ({ t: e.created_at, s: `${e.username} ${e.event_type}` }))].sort((a, b) => a.t < b.t ? -1 : 1);
  timeline.forEach((x) => addMsg(x.s, x.t));
  strokes = []; redoStack = []; ctx.clearRect(0, 0, cv.width, cv.height);
}
function addMsg(s, t) {
  const d = document.createElement('div'); d.innerHTML = `<div>${s}</div><div class="ts">${fmt(t)}</div>`;
  $('messages').appendChild(d); $('messages').scrollTop = 1e6;
}
function addSys(s, t) {
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = `${s} — ${fmt(t)}`;
  $('messages').appendChild(d); $('messages').scrollTop = 1e6;
}
$('sendForm').onsubmit = (e) => { e.preventDefault(); socket.emit('send-message', { roomId, body: $('msg').value }); $('msg').value = ''; };

// tabs
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  for (const t of ['chat', 'video', 'board']) $('tab-' + t).hidden = t !== b.dataset.tab;
});

// --- video mesh (Discord-like grid, P2P, STUN for cross-network) ---
const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
async function ensureLocal() {
  if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  return localStream;
}
$('vJoin').onclick = async () => { await ensureLocal(); ensureVideoEl('local', me.username + ' (you)', localStream, true); socket.emit('video-join', { roomId }); };
function leaveVideo() {
  if (roomId) socket?.emit('video-leave', { roomId });
  Object.values(pcs).forEach((pc) => { try { pc.close(); } catch {} }); pcs = {};
  $('videos').innerHTML = '';
}
$('vLeave').onclick = leaveVideo;
$('vMute').onclick = () => { muted = !muted; localStream?.getAudioTracks().forEach((t) => t.enabled = !muted); socket.emit('video-state', { roomId, muted, camOff }); };
$('vCam').onclick = () => { camOff = !camOff; localStream?.getVideoTracks().forEach((t) => t.enabled = !camOff); socket.emit('video-state', { roomId, muted, camOff }); };
function ensureVideoEl(id, label, stream, mutedEl) {
  let w = document.getElementById('vw-' + id);
  if (!w) {
    w = document.createElement('div'); w.id = 'vw-' + id;
    const tag = document.createElement('div'); tag.textContent = label; w.appendChild(tag);
    const v = document.createElement('video'); v.id = 'v-' + id; v.autoplay = true; v.playsInline = true;
    if (mutedEl) v.muted = true;
    w.appendChild(v); $('videos').appendChild(w);
  }
  const v = w.querySelector('video');
  if (stream && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
  return v;
}
function removeVideoEl(id) { document.getElementById('vw-' + id)?.remove(); }
async function onPeers({ peers }) {
  await ensureLocal().catch(() => {});
  ensureVideoEl('local', me.username + ' (you)', localStream, true);
  for (const p of peers) {
    if (p.socketId === socket.id || pcs[p.socketId]) continue;
    if (!(socket.id < p.socketId)) continue; // offerer election: smaller id offers, avoids glare
    const pc = new RTCPeerConnection(RTC_CFG); pcs[p.socketId] = pc;
    localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream));
    pc.onicecandidate = (e) => e.candidate && socket.emit('ice-candidate', { roomId, to: p.socketId, payload: e.candidate });
    pc.ontrack = (e) => addRemoteVideo(p.socketId, p.username, e.streams[0]);
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    socket.emit('video-offer', { roomId, to: p.socketId, payload: offer });
  }
  for (const id of Object.keys(pcs)) {
    if (!peers.find((p) => p.socketId === id)) { try { pcs[id].close(); } catch {} delete pcs[id]; removeVideoEl(id); }
  }
}
async function onOffer({ from, username, payload }) {
  await ensureLocal().catch(() => {});
  if (pcs[from]) { try { pcs[from].close(); } catch {} delete pcs[from]; }
  const pc = new RTCPeerConnection(RTC_CFG); pcs[from] = pc;
  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => e.candidate && socket.emit('ice-candidate', { roomId, to: from, payload: e.candidate });
  pc.ontrack = (e) => addRemoteVideo(from, username, e.streams[0]);
  await pc.setRemoteDescription(payload);
  const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
  socket.emit('video-answer', { roomId, to: from, payload: ans });
}
function addRemoteVideo(id, username, stream) {
  ensureVideoEl(id, username, stream, false);
}

// --- whiteboard (pen/marker/highlighter/eraser, clear only mine) ---
const cv = $('board'), ctx = cv.getContext('2d');
let drawing = false, pts = [], strokes = [], redoStack = [], tool = 'pen';
$('bPen').onclick = () => tool = 'pen';
$('bMarker').onclick = () => tool = 'marker';
$('bHigh').onclick = () => tool = 'hl';
$('bErase').onclick = () => tool = 'erase';
function curStyle() { return { color: $('bColor').value, size: +$('bSize').value, mode: tool }; }
function applyStyle(s) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (s.mode === 'erase') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = '#000'; ctx.globalAlpha = 1; ctx.lineWidth = s.size * 3 + 4; }
  else if (s.mode === 'marker') { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; ctx.globalAlpha = 1; ctx.lineWidth = s.size * 2 + 2; }
  else if (s.mode === 'hl') { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; ctx.globalAlpha = 0.35; ctx.lineWidth = s.size * 4 + 6; }
  else { ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = s.color; ctx.globalAlpha = 1; ctx.lineWidth = s.size; }
}
$('bUndo').onclick = () => { for (let i = strokes.length - 1; i >= 0; i--) { if (strokes[i].mine) { redoStack.push(strokes.splice(i, 1)[0]); redraw(); break; } } };
$('bRedo').onclick = () => { const s = redoStack.pop(); if (s) { strokes.push(s); drawStroke(s); socket.emit('whiteboard-stroke', { roomId, stroke: s }); } };
$('bClear').onclick = () => { strokes = strokes.filter((s) => !s.mine); redoStack = []; redraw(); socket.emit('whiteboard-clear-mine', { roomId }); };
function pos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
cv.onpointerdown = (e) => { drawing = true; pts = [pos(e)]; cv.setPointerCapture(e.pointerId); };
cv.onpointermove = (e) => { if (drawing) { pts.push(pos(e)); drawStroke({ points: [pts[pts.length - 2], pts[pts.length - 1]], ...curStyle() }); } };
cv.onpointerup = () => {
  if (!drawing) return; drawing = false;
  const s = { points: pts, ...curStyle(), by: me.username, mine: true };
  strokes.push(s); redoStack = []; socket.emit('whiteboard-stroke', { roomId, stroke: s });
};
function drawStroke(s) {
  ctx.save(); applyStyle(s);
  ctx.beginPath(); s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.restore();
}
function redraw() { ctx.clearRect(0, 0, cv.width, cv.height); strokes.forEach(drawStroke); }
function onRemoteStroke(username, stroke) { stroke.by = username; stroke.mine = false; strokes.push(stroke); drawStroke(stroke); }
function onClearMine(username) { strokes = strokes.filter((s) => s.by !== username); redraw(); }

refreshMe();
