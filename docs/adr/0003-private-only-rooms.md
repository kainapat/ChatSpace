# Private-only rooms with allow-list membership

All rooms are private. Creator is auto-member and adds members by username at create and later. Room list shows only rooms where the user is a member. Server checks RoomMember on every join, send, video connect, and whiteboard access.

## Considered Options

- Private + Public — adds a second permission path and public discovery for little MVP value.
- Open join — breaks the private isolation requirement.
