# Node monorepo for ChatSpace MVP

Single Node repo: Express + Socket.IO + node:sqlite (built-in) + bcryptjs, vanilla HTML/CSS/JS + Canvas frontend. `npm install && npm start`, no external DB. Video is native WebRTC mesh signaled over Socket.IO per-room. Whiteboard strokes relayed over Socket.IO per-room.

## Considered Options

- Split Vite + Express + Postgres + Prisma — scalable but needs Docker/DB, slower for MVP.
- Next.js fullstack + Prisma + SQLite — modern but heavier for realtime video/whiteboard.
