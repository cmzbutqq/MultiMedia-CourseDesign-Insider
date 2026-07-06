# 多媒体课程作业

基于 `WebGL2 + TypeScript + Vite` 的黑洞可视化课程项目，当前仓库已包含浏览器前端、可选的服务端手势识别、Docker 联调方案，以及 GitHub Actions 的测试与部署流程。

## 当前能力

- 黑洞、白洞、中子星三类天体，最多 `5` 个活跃天体
- `单天体 / 双天体 / 开普勒演示 / N体演示` 四组场景预设
- 吸积盘、引力透镜、Bloom、Tonemapping、Gamma 等画面特效
- `off / FXAA / TAA` 抗锯齿，以及 `FSR1 / Lanczos / Bicubic` 上采样
- 时间扭曲、轨迹显示、相机模式切换、天体参数实时编辑
- 录制、回放、JSON 导入导出、本地保存
- 本地识别与服务器识别两种手势模式
- 氛围音频
- Docker 一体部署、GitHub Pages 静态部署、GitHub Actions CI

## 手势模式说明

- `本地识别`：浏览器直接调用 MediaPipe Hands
- `服务器识别`：前端请求 `server/` 中的 Python 服务
- 两种模式当前都只使用“手掌位置 + 张开手掌状态”驱动视角，不包含独立的 `pinch / rotate / drag` 分类

## 快速开始

### 仅运行前端

```bash
cd web
npm install
npm run dev
```

默认地址：`http://localhost:5174`

需要稳定的摄像头安全上下文时，可改用：

```bash
cd web
./start-https.sh
```

地址：`https://localhost:5174`

### 启用服务器识别

推荐先启动服务端，再在页面中选择 `常用操作 -> 手势识别 -> 服务器识别`。

方式一：本地虚拟环境

```bash
cd server
./start-server.sh
```

方式二：Docker 一体部署

```bash
docker compose -p blackhole-web up --build
```

访问地址：

- `http://localhost:8080`
- `https://localhost:8443`

说明：

- 当前仓库目录名包含非 ASCII 字符，根目录运行 `docker compose` 时建议显式传 `-p blackhole-web`
- 根目录 Compose 会把 `/health` 和 `/api/detect` 代理到内部服务端容器，不直接暴露宿主机 `5000` 端口

停止容器：

```bash
docker compose -p blackhole-web down
```

## 测试与构建

前端：

```bash
cd web
npm test
npm run build
```

服务端：

```bash
python -m unittest discover -s server/tests -p 'test_*.py'
```

## 自动化

- `.github/workflows/ci.yml`：在 PR 上执行前端测试、前端构建、服务端单测
- `.github/workflows/deploy-pages.yml`：在 `main` 分支推送后构建 `web/dist` 并部署到 GitHub Pages

说明：

- GitHub Pages 只部署静态前端，不包含 `server/` 服务
- Pages 环境下如需手势交互，应使用 `本地识别`，或自行部署服务端后再接入

## 目录

```text
.
├── web/                  # Web 前端（Vite + TypeScript + WebGL2）
├── server/               # 可选手势识别服务（Flask + MediaPipe）
├── .github/workflows/    # CI 与 GitHub Pages 部署
├── docker-compose.yml    # 前后端一体部署
└── THIRD_PARTY_NOTICES.md
```

## 文档

- [server/README.md](server/README.md)：服务端接口、启动方式、限制与联调说明
- [web/HTTPS_SETUP.md](web/HTTPS_SETUP.md)：HTTPS、本地证书与摄像头权限说明
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)：上游参考与归因说明
