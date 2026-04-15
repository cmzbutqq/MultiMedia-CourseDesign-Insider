# 多媒体课程作业

基于 `WebGL2 + TypeScript + Vite` 的黑洞可视化课程项目，目标是在 Web 端复现黑洞、吸积盘、背景星空与后处理效果，并提供可交互的参数调节能力，便于展示、实验和后续扩展。

## Features

- 基于 `WebGL2` 的实时黑洞场景渲染
- 支持吸积盘、引力透镜等视觉效果调节
- 集成 Bloom、Tonemapping、Gamma 等后处理链路
- 通过 `lil-gui` 实时修改渲染参数
- 提供本地开发与 Docker 容器化运行方式
- 预留多天体、手势交互、在线部署等拓展方向

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

- [http://localhost:5173](http://localhost:5173)

构建生产版本：

```bash
npm run build
```

### Docker 运行

开发模式：

```bash
docker compose up web-dev --build
```

访问：

- [http://localhost:5173](http://localhost:5173)

生产模式：

```bash
docker compose up web-prod --build
```

访问：

- [http://localhost:8080](http://localhost:8080)

停止容器：

```bash
docker compose down
```

## Project Structure

```text
.
├── web/                     # Web 端主项目（Vite + TypeScript + WebGL2）
├── docs/                    # 设计与实施过程文档
├── 拓展功能.md               # 后续功能拓展方向记录
└── Blackhole/               # 参考项目
```

## Development Notes

- 当前核心交付内容为 `web` 目录下的 Web 端实现
- `Blackhole` 目录作为参考项目保留，不属于当前主要改造范围
- Docker 方案同时覆盖开发态与生产态，便于本地调试和演示部署

## Roadmap

后续可继续扩展的方向见 `拓展功能.md`，当前已整理的方向包括：

- 更多天体类型
- 多天体与简易轨道
- 摄像头手势交互
- 进阶视觉物理感
- 抗锯齿
- 模拟时间扭曲
- 在线演示与网站部署

## License

当前仓库主要用于课程作业与学习研究。