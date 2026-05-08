# AGENTS.md

## Project overview

- Main app: `web/` Vite + TypeScript + WebGL2 black hole visualizer.
- Optional service: `server/` Python gesture recognition API.
- Root `docker-compose.yml` can build the production web app and gesture service together.

## Cursor Cloud specific instructions

- Use Node.js 20+ for the web app. CI runs from `web/` with `npm ci` then `npm run build`.
- Install web dependencies with `cd web && npm ci`.
- Run the development demo with `cd web && npm run dev -- --host 0.0.0.0`.
- Vite is configured to prefer port `5174`; use the URL printed by Vite if that port is occupied.
- For browser walkthroughs, open the Vite URL and verify the WebGL canvas plus `lil-gui` controls render.
- The Python gesture service is optional for the default visualizer demo. If needed, run it from `server/` with `pip install -r requirements.txt` and `python3 server.py`, then check `http://localhost:5000/health`.

## Verification commands

- `cd web && npm ci`
- `cd web && npm audit --audit-level=high`
- `cd web && npm run build`
- `cd web && npm run dev -- --host 0.0.0.0`
