# AGENTS.md

## Cursor Cloud specific instructions

This is a **client-side only** WebGL2 + TypeScript + Vite project (no backend, no database). All code lives under `web/`.

### Services

| Service | Command | Port | Notes |
|---|---|---|---|
| Vite Dev Server | `cd web && npm run dev` | 5173 | The only service needed for development |

### Key commands

- **Install deps**: `cd web && npm install`
- **Dev server**: `cd web && npm run dev` (serves at http://localhost:5173)
- **Build**: `cd web && npm run build` (output to `web/dist/`)
- **Type check**: `cd web && npx tsc --noEmit` (note: there is a pre-existing unused import error in `src/bodyBindings.ts`)
- **Preview prod build**: `cd web && npm run preview`

### Caveats

- The project uses `package-lock.json` — use `npm` (not pnpm/yarn).
- Node 20+ is required (matches the Dockerfile base image `node:20-bookworm-slim`).
- The WebGL2 rendering is GPU-intensive; in headless/cloud environments the visualization may become unresponsive when adjusting certain parameters (e.g. `diskDensity`). This is a known app behavior, not an environment issue.
- No linting tool is configured (no ESLint/Prettier in `package.json`).
- Docker Compose is available for containerized dev (`docker compose up web-dev --build`) and prod (`docker compose up web-prod --build`), but is not required for local development.
