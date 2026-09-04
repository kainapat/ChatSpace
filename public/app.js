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
  socket.on('whiteboard-stroke', ({ stroke }) => drawStroke(stroke, false));
  socket.on('whiteboard-clear', () => clearBoard(false));
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
  clearBoard(false);
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

// --- video mesh ---
async function ensureLocal() {
  if (!localStream) localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  return localStream;
}
$('vJoin').onclick = async () => { await ensureLocal(); renderLocal(); socket.emit('video-join', { roomId }); };
function leaveVideo() { if (roomId) socket?.emit('video-leave', { roomId }); Object.values(pcs).forEach((pc) => pc.close()); pcs = {}; $('videos').innerHTML = ''; }
$('vLeave').onclick = leaveVideo;
$('vMute').onclick = () => { muted = !muted; localStream?.getAudioTracks().forEach((t) => t.enabled = !muted); socket.emit('video-state', { roomId, muted, camOff }); };
$('vCam').onclick = () => { camOff = !camOff; localStream?.getVideoTracks().forEach((t) => t.enabled = !camOff); socket.emit('video-state', { roomId, muted, camOff }); };
function renderLocal() {
  $('videos').innerHTML = '';
  const v = document.createElement('video'); v.muted = true; v.autoplay = true; v.playsInline = true; v.srcObject = localStream;
  const w = document.createElement('div'); w.textContent = me.username + ' (you)'; w.appendChild(v); $('videos').appendChild(w);
}
async function onPeers({ peers }) {
  await ensureLocal().catch(() => {});
  for (const p of peers) {
    if (p.socketId === socket.id || pcs[p.socketId]) continue;
    const pc = new RTCPeerConnection(); pcs[p.socketId] = pc;
    localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream));
    pc.onicecandidate = (e) => e.candidate && socket.emit('ice-candidate', { roomId, to: p.socketId, payload: e.candidate });
    pc.ontrack = (e) => addRemoteVideo(p.socketId, p.username, e.streams[0]);
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    socket.emit('video-offer', { roomId, to: p.socketId, payload: offer });
  }
  renderLocal();
  for (const [id] of Object.entries(pcs)) if (!peers.find((p) => p.socketId === id)) { pcs[id].close(); delete pcs[id]; }
}
async function onOffer({ from, username, payload }) {
  await ensureLocal().catch(() => {});
  const pc = new RTCPeerConnection(); pcs[from] = pc;
  localStream?.getTracks().forEach((t) => pc.addTrack(t, localStream));
  pc.onicecandidate = (e) => e.candidate && socket.emit('ice-candidate', { roomId, to: from, payload: e.candidate });
  pc.ontrack = (e) => addRemoteVideo(from, username, e.streams[0]);
  await pc.setRemoteDescription(payload);
  const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
  socket.emit('video-answer', { roomId, to: from, payload: ans });
}
function addRemoteVideo(id, username, stream) {
  if (document.getElementById('v-' + id)) return;
  const v = document.createElement('video'); v.id = 'v-' + id; v.autoplay = true; v.playsInline = true; v.srcObject = stream;
  const w = document.createElement('div'); w.textContent = username; w.appendChild(v); $('videos').appendChild(w);
}

// --- whiteboard ---
const cv = $('board'), ctx = cv.getContext('2d');
let drawing = false, pts = [], myStrokes = [], redoStack = [], tool = 'pen';
$('bPen').onclick = () => tool = 'pen'; $('bErase').onclick = () => tool = 'erase';
$('bUndo').onclick = () => { const s = myStrokes.pop(); if (s) { redoStack.push(s); redraw(); } };
$('bRedo').onclick = () => { const s = redoStack.pop(); if (s) { myStrokes.push(s); drawStroke(s, false); socket.emit('whiteboard-stroke', { roomId, stroke: s }); } };
$('bClear').onclick = () => { myStrokes = []; redoStack = []; clearBoard(true); };
function pos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
cv.onpointerdown = (e) => { drawing = true; pts = [pos(e)]; cv.setPointerCapture(e.pointerId); };
cv.onpointermove = (e) => { if (drawing) { pts.push(pos(e)); drawStroke({ points: [pts[pts.length - 2], pts[pts.length - 1]], color: $('bColor').value, size: +$('bSize').value, erase: tool === 'erase' }, false); } };
cv.onpointerup = () => {
  if (!drawing) return; drawing = false;
  const s = { points: pts, color: $('bColor').value, size: +$('bSize').value, erase: tool === 'erase' };
  myStrokes.push(s); redoStack = []; socket.emit('whiteboard-stroke', { roomId, stroke: s });
};
let remoteStrokes = [];
function drawStroke(s, record = true) {
  ctx.save(); ctx.strokeStyle = s.color; ctx.lineWidth = s.size; ctx.lineCap = 'round';
  if (s.erase) ctx.globalCompositeOperation = 'destination-over';
  ctx.beginPath(); s.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.restore();
  if (!record) remoteStrokes.push(s);
}
function redraw() { ctx.clearRect(0, 0, cv.width, cv.height); [...remoteStrokes, ...myStrokes].forEach((s) => { const tmp = remoteStrokes; drawStroke(s, true); remoteStrokes = tmp; }); }
function clearBoard(emit) { ctx.clearRect(0, 0, cv.width, cv.height); remoteStrokes = []; if (emit) socket.emit('whiteboard-clear', { roomId }); }

refreshMe();
