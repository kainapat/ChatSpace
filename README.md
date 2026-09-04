# ChatSpace 💬🎥🎨

[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/socket.io-realtime-010101?logo=socket.io&logoColor=white)](https://socket.io/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Private rooms for small-group **realtime chat** with per-room **video calls** and a collaborative **whiteboard**.
Single Node monolith — no Docker, no external DB. `npm install && npm start`.

## ✨ Features

| Area | What you get |
| --- | --- |
| 🔐 Auth | Username + password (bcrypt), session cookies, login / logout / register with toast feedback |
| 🔒 Private rooms | Create rooms, add members by username, leave view anytime, creator-only delete — server-enforced membership on every action |
| 💬 Realtime chat | Socket.IO per-room chat, server timestamps (`4 Sep 2026 15:32`), LINE-style bubbles, per-user name colors |
| 🟢 Presence | Join / leave / send events with timestamps, online user list |
| 🎥 Video | WebRTC mesh (≤6) with camera picker, mute / camera-off indicators (🔇 🚫), per-room sessions |
| 🎨 Whiteboard | Pen / marker / highlighter / eraser, sizes + colors, author name tags, undo-redo (own strokes), clear-only-mine, realtime sync |
| 📱 UI | Dark ethereal-glass theme, Discord-like 3-pane layout (rooms \| chat \| members), skeleton + empty + error states, toasts + confirm modals, video & whiteboard unlock only inside a room |

## 🚀 Quickstart

```bash
npm install
cp .env.example .env   # then put a long random SESSION_SECRET inside
npm start        # or: npm run dev   (auto-restart via nodemon)
```

Open **http://localhost:3000**, then try the full flow with two accounts:

1. Register `john` (+ open a second browser as `jane`)
2. `john` → **+ New Room** → name it `Project A`, members: `jane`
3. Click the room to enter it (video & whiteboard stay locked until you do) → chat realtime 💬
4. **Video Mode** tab → **Join Video** on both → see each other 🎥
5. **Whiteboard** tab → draw together 🎨

## 🧱 Tech stack

| Layer | Choice | Why ([ADRs](docs/adr/)) |
| --- | --- | --- |
| Backend | Express + Socket.IO | One repo for REST + realtime + video signaling |
| Database | `node:sqlite` (built-in) | Zero native deps, file-based, enough for MVP |
| Auth | express-session + bcryptjs + express-rate-limit | httpOnly cookies, session regeneration, server-side permission checks, auth rate limiting |
| Config | dotenv (`.env`, gitignored) | `SESSION_SECRET` per environment; startup warns on insecure default |
| Video | Native WebRTC mesh + public STUN | No SFU to deploy; cap ~6 peers |
| Frontend | Vanilla HTML/CSS/JS + Canvas | No build step, instant load |

See [`docs/adr/`](docs/adr/) for the 5 recorded decisions and [`CONTEXT.md`](CONTEXT.md) for the ubiquitous language.

## 📁 Structure

```
ChatSpace/
├── server.js        # REST API + Socket.IO (auth, rooms, chat, video signaling, whiteboard relay)
├── db.js            # SQLite schema (users, rooms, room_members, messages, room_events)
├── eval-smoke.cjs   # frontend init-order smoke test (`npm test`)
├── public/
│   ├── index.html   # 3-tab layout
│   ├── styles.css   # modern design system (no framework)
│   └── app.js       # Socket.IO client, WebRTC mesh, Canvas whiteboard
├── docs/adr/        # architecture decision records
└── CONTEXT.md       # domain glossary
```

## 🛡️ Security notes

- Passwords hashed with bcrypt; usernames validated (`3-20 chars`); sessions regenerate on login
- Private rooms enforced server-side on every REST + Socket.IO action (never UI-only)
- Auth endpoints rate-limited (30 req / 15 min / IP); whiteboard strokes capped (500 points)
- ⚠️ Set `SESSION_SECRET` in production — startup warns when the insecure default is used

## ✅ Verify

```bash
npm test            # frontend eval smoke (catches init-order bugs)
```

## 🔌 Key API & events

- `POST /api/register|/login|/logout`, `GET /api/me`
- `GET|POST /api/rooms`, `DELETE /api/rooms/:id` (creator only)
- `POST /api/rooms/:id/members`, `GET /api/rooms/:id/messages|events`
- Socket: `join-room`, `send-message`, `video-join|offer|answer`, `whiteboard-stroke|clear-mine`, `presence`

## 📄 License

[MIT](LICENSE) © 2026 kainapat
