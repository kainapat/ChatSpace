# WebRTC mesh for video, no SFU in MVP

Video is P2P mesh signaled over Socket.IO per-room, grid view with cam/mic toggles and join/leave. Cap ~4-6 participants for stability. No recording or screenshare in MVP.

## Considered Options

- SFU (mediasoup/Janus) — supports 10+ but adds deploy and config cost, overkill for MVP.
- Video stub — fails the real video requirement.
