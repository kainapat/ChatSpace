const $ = (id) => document.getElementById(id);
let me = null, socket = null, roomId = null, inVideo = false;
let pcs = {}, localStream = null, muted = false, camOff = false;
const BOARD_CTL = ['bPen', 'bMarker', 'bHigh', 'bErase', 'bUndo', 'bRedo', 'bClear', 'bColor', 'bSize'];

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

function toast(msg, type = 'ok') {
  const box = $('toasts');
  const d = document.createElement('div');
  d.className = 'toast ' + type; d.textContent = msg;
  box.appendChild(d);
  setTimeout(() => d.remove(), 3000);
}
function showConfirm(title, msg, okLabel = 'Delete') {
  return new Promise((resolve) => {
    $('cTitle').textContent = title; $('cMsg').textContent = msg; $('cOk').textContent = okLabel;
    $('confirmModal').hidden = false;
    const done = (v) => { $('confirmModal').hidden = true; $('cOk').onclick = $('cCancel').onclick = null; resolve(v); };
    $('cOk').onclick = () => done(true);
    $('cCancel').onclick = () => done(false);
  });
}

async function refreshMe() {
  try { me = await api('/api/me'); } catch { me = null; }
  $('auth').hidden = !!me; $('app').hidden = !me; $('logout').hidden = !me;
  $('me').textContent = me ? `User: ${me.username}` : '';
  if (me) { connectSocket(); loadRooms(); }
}
$('login').onclick = async () => {
  try {
    const u = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
    toast(`Welcome back, ${u.username}!`); refreshMe();
  } catch (e) { toast(e.message, 'err'); }
};
$('register').onclick = async () => {
  try {
    const u = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
    toast(`Registered as ${u.username}!`); refreshMe();
  } catch (e) { toast(e.message, 'err'); }
};
$('logout').onclick = async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} toast('Logged out'); setTimeout(() => location.reload(), 800); };

async function loadRooms() {
  const rooms = await api('/api/rooms');
  $('rooms').innerHTML = '';
  rooms.forEach((r) => {
    const b = document.createElement('button');
    b.textContent = r.name; b.dataset.id = r.id; b.onclick = () => selectRoom(r.id, r.name);
    if (r.id === roomId) b.classList.add('active');
    $('rooms').appendChild(b);
  });
  return rooms;
}
$('newRoom').onclick = () => { $('roomModal').hidden = false; };
$('rCancel').onclick = () => $('roomModal').hidden = true;
$('refreshRooms').onclick = () => loadRooms();
function exitRoomView() {
  leaveVideo();
  roomId = null;
  $('roomTitle').textContent = 'Select a room';
  $('members').textContent = ''; $('online').textContent = ''; $('messages').innerHTML = '';
  strokes = []; redoStack = []; ctx.clearRect(0, 0, cv.width, cv.height);
  updateVideoUI();
}
$('leaveRoom').onclick = () => {
  if (!roomId) return;
  socket.emit('leave-room', { roomId });
  exitRoomView();
};
$('delRoom').onclick = async () => {
  if (!roomId) return;
  if (!await showConfirm('Delete room', `Delete "${$('roomTitle').textContent}" for everyone?`)) return;
  try {
    await api(`/api/rooms/${roomId}`, { method: 'DELETE' });
    toast('Room deleted');
    exitRoomView(); loadRooms();
  } catch (e) { toast(e.message, 'err'); }
};$('rCreate').onclick = async () => {
  try {
    const memberUsernames = $('rMembers').value.split(',').map((s) => s.trim()).filter(Boolean);
    const r = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: $('rName').value, description: $('rDesc').value, memberUsernames }) });
    $('roomModal').hidden = true; toast(`Room "${r.name}" created`); loadRooms(); selectRoom(r.id, $('rName').value);
  } catch (e) { toast(e.message, 'err'); }
};
$('addMember').onclick = async () => {
  try {
    if (!roomId) throw new Error('select a room first');
    await api(`/api/rooms/${roomId}/members`, { method: 'POST', body: JSON.stringify({ username: $('addMemberName').value.trim() }) });
    $('addMemberName').value = '';
    toast('Member added'); reloadMembers();
  } catch (e) { toast(e.message, 'err'); }
};
async function reloadMembers() {
  if (!roomId) return;
  const info = await api(`/api/rooms/${roomId}`);
  $('members').textContent = info.members.map((m) => m.username).join(', ');
}

function connectSocket() {
  if (socket) return;
  socket = io();
  socket.on('chat-message', (m) => { if (m.roomId === roomId) addChat(m.username, m.body, m.createdAt); });
  socket.on('room-event', (e) => { if (e.roomId === roomId) addSys(`${e.username} ${e.type}`, e.createdAt); });
  socket.on('presence', (p) => { if (p.roomId === roomId) $('online').textContent = p.users.join(', '); });
  socket.on('whiteboard-stroke', ({ roomId: rid, username, stroke }) => { if (rid === roomId) onRemoteStroke(username, stroke); });
  socket.on('whiteboard-clear-mine', ({ roomId: rid, username }) => { if (rid === roomId) onClearMine(username); });
  socket.on('video-peers', onPeers);
  socket.on('video-offer', onOffer);
  socket.on('video-answer', async ({ from, payload }) => pcs[from]?.setRemoteDescription(payload));
  socket.on('ice-candidate', async ({ from, payload }) => pcs[from]?.addIceCandidate(payload).catch(() => {}));
  socket.on('rooms-changed', async () => {
    const rooms = await loadRooms().catch(() => []);
    if (roomId && !rooms.find((r) => r.id === roomId)) exitRoomView();
  });
  socket.on('room-deleted', ({ roomId: rid }) => {
    if (rid === roomId) { toast('This room was deleted', 'err'); exitRoomView(); loadRooms(); }
  });
  socket.on('connect', () => {
    if (socket._rejoin && roomId) {
      socket.emit('join-room', { roomId });
      if (inVideo) { inVideo = false; updateVideoUI(); addSys('reconnected — press Join Video again', new Date().toISOString()); }
    }
    socket._rejoin = true;
  });
}

async function selectRoom(id, name) {
  if (roomId) socket.emit('leave-room', { roomId });
  leaveVideo();
  roomId = id; $('roomTitle').textContent = name; $('messages').innerHTML = '';
  [...$('rooms').children].forEach((x) => x.classList.toggle('active', +x.dataset.id === id));
  socket.emit('join-room', { roomId });
  const [msgs, evs, info] = await Promise.all([
    api(`/api/rooms/${id}/messages`), api(`/api/rooms/${id}/events`), api(`/api/rooms/${id}`),
  ]);
  $('members').textContent = info.members.map((m) => m.username).join(', ');
  const timeline = [...msgs.map((m) => ({ t: m.created_at, kind: 'chat', username: m.username, body: m.body })),
    ...evs.map((e) => ({ t: e.created_at, kind: 'sys', text: `${e.username} ${e.event_type}` }))].sort((a, b) => a.t < b.t ? -1 : 1);
  timeline.forEach((x) => x.kind === 'chat' ? addChat(x.username, x.body, x.t) : addSys(x.text, x.t));
  strokes = []; redoStack = []; ctx.clearRect(0, 0, cv.width, cv.height);
  updateVideoUI();
}
function nameColor(username) {
  const h = [...String(username)].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `hsl(${h}, 75%, 70%)`;
}
function scrollChat() { $('messages').scrollTop = 1e6; }
function addChat(username, body, t) {
  const own = me && username === me.username;
  const row = document.createElement('div'); row.className = 'row' + (own ? ' own' : '');
  const un = document.createElement('div'); un.className = 'uname';
  un.textContent = own ? 'You' : username; un.style.color = nameColor(username);
  const b = document.createElement('div'); b.className = 'bubble'; b.textContent = body;
  const ts = document.createElement('div'); ts.className = 'ts'; ts.textContent = fmt(t);
  row.appendChild(un); row.appendChild(b); row.appendChild(ts);
  $('messages').appendChild(row); scrollChat();
}
function addSys(s, t) {
  const d = document.createElement('div'); d.className = 'sys'; d.textContent = `${s} — ${fmt(t)}`;
  $('messages').appendChild(d); scrollChat();
}
$('sendForm').onsubmit = (e) => { e.preventDefault(); socket.emit('send-message', { roomId, body: $('msg').value }); $('msg').value = ''; };

// tabs
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
  for (const t of ['chat', 'video', 'board']) $('tab-' + t).hidden = t !== b.dataset.tab;
  if (b.dataset.tab === 'video') { updateVideoUI(); refreshCams().catch(() => {}); }
});
document.querySelector('nav button')?.classList.add('active');
updateVideoUI();

// --- video mesh (Discord-like grid, P2P, STUN for cross-network) ---
const RTC_CFG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
function updateVideoUI() {
  $('leaveRoom').disabled = $('delRoom').disabled = !roomId;
  $('vJoin').disabled = !roomId || inVideo;
  $('vLeave').disabled = !inVideo;
  $('vMute').disabled = $('vCam').disabled = $('vCamSel').disabled = !inVideo;
  $('vMute').textContent = muted ? 'Unmute' : 'Mute';
  $('vCam').textContent = camOff ? 'Camera on' : 'Camera off';
  $('videoHint').hidden = !!roomId;
  updateBoardUI();
}
function updateBoardUI() {
  BOARD_CTL.forEach((id) => { $(id).disabled = !roomId; });
  $('boardHint').hidden = !!roomId;
}
async function ensureLocal() {
  if (!localStream) {
    const dev = $('vCamSel').value;
    localStream = await navigator.mediaDevices.getUserMedia({ video: dev ? { deviceId: { exact: dev } } : true, audio: true });
    refreshCams().catch(() => {});
  }
  return localStream;
}
async function refreshCams() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const cams = devs.filter((d) => d.kind === 'videoinput');
  const sel = $('vCamSel'), cur = sel.value;
  sel.innerHTML = '';
  cams.forEach((c, i) => {
    const o = document.createElement('option');
    o.value = c.deviceId; o.textContent = c.label || `Camera ${i + 1}`;
    sel.appendChild(o);
  });
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
$('vCamSel').onchange = async () => {
  if (!inVideo || !localStream) return;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: $('vCamSel').value } }, audio: false });
  const track = stream.getVideoTracks()[0];
  const old = localStream.getVideoTracks()[0];
  if (old) { old.stop(); try { localStream.removeTrack(old); } catch {} }
  localStream.addTrack(track);
  Object.values(pcs).forEach((pc) => pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(track));
  ensureVideoEl('local', me.username + ' (you)', localStream, true);
  refreshCams().catch(() => {});
};
$('vJoin').onclick = async () => {
  try {
    if (!roomId) throw new Error('select a room first');
    await ensureLocal();
    ensureVideoEl('local', me.username + ' (you)', localStream, true);
    paintVideoEl('local', me.username + ' (you)', { muted, camOff });
    socket.emit('video-join', { roomId });
    inVideo = true; updateVideoUI();
  } catch (e) { toast(e.message, 'err'); }
};
function leaveVideo() {
  if (roomId && inVideo) socket?.emit('video-leave', { roomId });
  Object.values(pcs).forEach((pc) => { try { pc.close(); } catch {} }); pcs = {};
  localStream?.getTracks().forEach((t) => t.stop()); localStream = null;
  muted = false; camOff = false; inVideo = false;
  $('videos').innerHTML = ''; updateVideoUI();
}
$('vLeave').onclick = leaveVideo;
$('vMute').onclick = () => { muted = !muted; localStream?.getAudioTracks().forEach((t) => t.enabled = !muted); socket.emit('video-state', { roomId, muted, camOff }); paintVideoEl('local', me.username + ' (you)', { muted, camOff }); updateVideoUI(); };
$('vCam').onclick = () => { camOff = !camOff; localStream?.getVideoTracks().forEach((t) => t.enabled = !camOff); socket.emit('video-state', { roomId, muted, camOff }); paintVideoEl('local', me.username + ' (you)', { muted, camOff }); updateVideoUI(); };
function ensureVideoEl(id, label, stream, mutedEl) {
  let w = document.getElementById('vw-' + id);
  if (!w) {
    w = document.createElement('div'); w.id = 'vw-' + id;
    const tag = document.createElement('div');
    const nm = document.createElement('span'); nm.className = 'vn'; nm.textContent = label;
    const st = document.createElement('span'); st.className = 'vs';
    tag.appendChild(nm); tag.appendChild(document.createTextNode(' ')); tag.appendChild(st);
    w.appendChild(tag);
    const v = document.createElement('video'); v.id = 'v-' + id; v.autoplay = true; v.playsInline = true;
    if (mutedEl) v.muted = true;
    w.appendChild(v); $('videos').appendChild(w);
  }
  const v = w.querySelector('video');
  if (stream && v.srcObject !== stream) { v.srcObject = stream; v.play().catch(() => {}); }
  return v;
}
function paintVideoEl(id, label, st) {
  ensureVideoEl(id, label, null, id === 'local');
  const w = document.getElementById('vw-' + id);
  if (!w) return;
  w.querySelector('.vn').textContent = label;
  w.querySelector('.vs').textContent = `${st?.muted ? '🔇' : ''}${st?.camOff ? ' 🚫' : ''}`;
}
function removeVideoEl(id) { document.getElementById('vw-' + id)?.remove(); }
async function onPeers({ peers }) {
  if (!inVideo) { // left (or never joined): prune only, never touch camera/DOM
    for (const id of Object.keys(pcs)) {
      if (!peers.find((p) => p.socketId === id)) { try { pcs[id].close(); } catch {} delete pcs[id]; removeVideoEl(id); }
    }
    return;
  }
  await ensureLocal().catch(() => {});
  ensureVideoEl('local', me.username + ' (you)', localStream, true);
  paintVideoEl('local', me.username + ' (you)', { muted, camOff });
  for (const p of peers) {
    if (p.socketId !== socket.id) paintVideoEl(p.socketId, p.username, p);
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
  if (!inVideo) return; // ignore invites when not in video (prevents resurrection)
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
$('bUndo').onclick = () => { if (!roomId) return toast('Select a room first', 'err'); for (let i = strokes.length - 1; i >= 0; i--) { if (strokes[i].mine) { redoStack.push(strokes.splice(i, 1)[0]); redraw(); break; } } };
$('bRedo').onclick = () => { if (!roomId) return toast('Select a room first', 'err'); const s = redoStack.pop(); if (s) { strokes.push(s); drawStroke(s); socket.emit('whiteboard-stroke', { roomId, stroke: s }); } };
$('bClear').onclick = () => { if (!roomId) return toast('Select a room first', 'err'); strokes = strokes.filter((s) => !s.mine); redoStack = []; redraw(); socket.emit('whiteboard-clear-mine', { roomId }); };
function pos(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; }
cv.onpointerdown = (e) => { if (!roomId) return; drawing = true; pts = [pos(e)]; cv.setPointerCapture(e.pointerId); };
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
