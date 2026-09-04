# ChatSpace

Private rooms for small-group chat with per-room video and whiteboard.

## Language

**User**:
A person with a unique username who can log in and participate in rooms.
_Avoid_: account, client

**Room**:
A private conversation scope with its own messages, video session, and whiteboard.
_Avoid_: channel, space, group

**Member**:
A User authorized to access a Room.
_Avoid_: allowed user, participant

**Message**:
Text sent by a Member into a Room, ordered by server time.
_Avoid_: chat, text

**RoomEvent**:
A join, leave, or send occurrence in a Room with a timestamp.
_Avoid_: activity, presence, log

**VideoSession**:
The live per-room video call Members join and leave, ephemeral.
_Avoid_: video mode, conference, call

**Whiteboard**:
A shared drawing surface per Room, ephemeral for the live session.
_Avoid_: canvas, board

**Stroke**:
A single freehand drawing action by a Member with color and size.
_Avoid_: drawing, line
