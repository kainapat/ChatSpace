# Ephemeral whiteboard with stroke sync

Strokes (points + color + size) are broadcast over Socket.IO per-room and rendered on Canvas. Undo/redo applies to own strokes only. Board is ephemeral — reload clears it.

## Considered Options

- Persist strokes in SQLite — preserves history but adds storage and replay complexity.
- Full image sync — simple idea but heavy bandwidth and laggy.
