# 多媒体课程作业

基于 `WebGL2 + TypeScript + Vite` 的黑洞可视化课程项目，目标是在 Web 端复现黑洞、吸积盘、背景星空与后处理效果，并提供可交互的参数调节能力，便于展示、实验和后续扩展。

## Features

- 基于 `WebGL2` 的实时黑洞场景渲染
- 支持吸积盘、引力透镜等视觉效果调节
- 集成 Bloom、Tonemapping、Gamma 等后处理链路
- 抗锯齿管线（关闭 / FXAA / TAA 三档切换，支持质量参数调节）
- 手势交互（本地 MediaPipe / 服务器双模式）
- 通过 `lil-gui` 实时修改渲染参数
- 提供本地开发与 Docker 容器化运行方式
- 预留多天体、模拟时间扭曲等拓展方向

## Tech Stack

- `WebGL2`
- `TypeScript`
- `Vite`
- `lil-gui`
- `Docker`
- `Nginx`

## Quick Start

### 本地运行

进入 `web` 目录并安装依赖：

```bash
cd web
npm install
```

启动开发服务器：

```bash
npm run dev
```

默认访问地址：

- [http://localhost:5174](http://localhost:5174)

构建生产版本：

```bash
npm run build
```

### Docker 运行

项目根目录的 `docker-compose.yml` 可一键部署前后端：

```bash
# 一键部署前后端（前台运行）
docker compose up --build

# 一键部署前后端（后台运行）
docker compose up --build -d
```

访问：

- http前端：[http://localhost:8080](http://localhost:8080) (http可能无法调用摄像头)
- https前端：[https://localhost:8443](https://localhost:8443)
- 手势服务器：由前端容器通过内部网络代理，不再直接暴露 5000 端口

停止容器：

```bash
docker compose down
```

## Project Structure

```text
.
├── web/                     # Web 端主项目（Vite + TypeScript + WebGL2）
├── server/                  # 手势识别服务端（Python + MediaPipe）
├── docs/                    # 设计与实施过程文档
├── docker-compose.yml       # Docker 容器编排配置（前后端一键部署）
└── 拓展功能.md               # 后续功能拓展方向记录
```
- Docker 方案同时覆盖开发态与生产态，便于本地调试和演示部署

## Roadmap

后续可继续扩展的方向见 `拓展功能.md`，当前已整理的方向包括：

- 更多天体类型
- 多天体与简易轨道
- 进阶视觉物理感
- 模拟时间扭曲
- 在线演示与网站部署

**已实现：**

- 抗锯齿（关闭 / FXAA / TAA 三档切换）
- 摄像头手势交互（本地 + 服务器双模式）
  - 张开手掌：检测到至少4根手指伸展，用于触发视角移动
  - 捏合 (Pinch)：待多星系统开发后实现
  - 拖拽 (Drag)：移动手掌位置来控制视角


## License

当前仓库主要用于课程作业与学习研究。