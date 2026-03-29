# 多媒体课程作业

当前仓库已为 `web` 项目补充 Docker 容器化方案，覆盖开发态和生产态两种使用方式。

## 目录说明

- `web`：WebGL2 + Vite 前端项目
- `Blackhole`：参考项目，不纳入当前容器化范围

## 开发环境

启动开发容器：

```bash
docker compose up web-dev --build
```

访问：

- [http://localhost:5173](http://localhost:5173)

说明：

- 源码目录会挂载进容器
- 依赖保存在容器卷 `web_node_modules` 中
- 已启用适合容器环境的文件监听配置

## 生产环境

启动生产容器：

```bash
docker compose up web-prod --build
```

访问：

- [http://localhost:8080](http://localhost:8080)

## 停止服务

```bash
docker compose down
```
