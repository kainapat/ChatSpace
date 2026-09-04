# Session cookie auth with bcrypt

Express-session with httpOnly cookie + bcryptjs password hashing, same session reused for Socket.IO handshake. Logout destroys server session. Chosen for MVP monolith simplicity and XSS safety over JWT in localStorage.

## Considered Options

- JWT in localStorage — stateless but XSS-prone and more client auth code.
- Username-only (no password) — fastest demo but fails security requirement.
