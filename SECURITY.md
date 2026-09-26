# Security

- Never commit a wallet private key or seed phrase.
- HELIX binds to localhost by default.
- Paper mode is the default execution boundary.
- Live transaction signing is intentionally separated from the dashboard backend.
- Treat Pump.fun/JWT tokens as secrets and rotate them if exposed.
- Keep the repository free of `.env`, database files and local config.
