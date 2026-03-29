# Web Containerization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `web` 项目补充同时适用于开发和生产的 Docker/Compose 运行方式。

**Architecture:** 使用 `web/Dockerfile` 统一定义开发、构建和生产三个阶段；根目录 `docker-compose.yml` 提供 `web-dev` 与 `web-prod` 两个可直接启动的服务。生产态通过 `nginx` 托管 Vite 构建产物。

**Tech Stack:** Docker, Docker Compose, Node 20, Vite, Nginx

---

### Task 1: Add container build files

**Files:**
- Create: `web/Dockerfile`
- Create: `web/.dockerignore`
- Create: `web/nginx.conf`

- [ ] **Step 1: Add the Docker multi-stage build**

Create a `Dockerfile` with `dev`, `build`, and `prod` stages.

- [ ] **Step 2: Add Docker context exclusions**

Exclude `node_modules`, `dist`, and transient build artifacts from the image context.

- [ ] **Step 3: Add Nginx runtime config**

Serve built files from `/usr/share/nginx/html` and keep a fallback to `index.html`.

- [ ] **Step 4: Verify the image can build**

Run: `docker build -f web/Dockerfile --target prod web`
Expected: build exits with code `0`

### Task 2: Add compose entrypoints

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Define the development service**

Mount `./web` into the container, keep `node_modules` inside the container via a dedicated volume, and expose Vite on `5173`.

- [ ] **Step 2: Define the production service**

Build the `prod` target and expose `nginx` on `8080`.

- [ ] **Step 3: Verify compose config**

Run: `docker compose config`
Expected: config renders successfully without validation errors

- [ ] **Step 4: Verify hot reload assumptions**

Ensure Vite listens on `0.0.0.0` and uses the mapped client port for HMR.

### Task 3: Add usage documentation

**Files:**
- Create: `README.md`

- [ ] **Step 1: Document development startup**

Include the `docker compose up web-dev --build` command and access URL.

- [ ] **Step 2: Document production startup**

Include the `docker compose up web-prod --build` command and access URL.

- [ ] **Step 3: Document stop/cleanup**

Include the `docker compose down` command.

### Task 4: Verify end-to-end behavior

**Files:**
- Modify: `docker-compose.yml`
- Modify: `web/Dockerfile`
- Modify: `README.md`

- [ ] **Step 1: Build the production image**

Run: `docker compose build web-prod`
Expected: build succeeds

- [ ] **Step 2: Validate the final compose file**

Run: `docker compose config`
Expected: exit code `0`

- [ ] **Step 3: Adjust docs if commands differ**

Make documentation match the actual verified commands.
