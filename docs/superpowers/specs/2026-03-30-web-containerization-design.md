# Web Containerization Design

## Goal

为仓库中的 `web` 项目补充容器化方案，同时覆盖本地开发和生产演示两种使用场景，不涉及 `Blackhole` 参考项目。

## Scope

- 仅容器化 `web`
- 提供开发态容器，支持 Vite 热更新
- 提供生产态容器，构建后以静态资源方式提供访问
- 提供简短使用说明

## Chosen Approach

采用单个 `Dockerfile` 配合根目录 `docker-compose.yml` 的方案：

- `Dockerfile` 使用多阶段构建
  - `dev` 阶段：安装依赖并运行 Vite 开发服务器
  - `build` 阶段：生成 `dist`
  - `prod` 阶段：使用 `nginx` 托管打包结果
- `docker-compose.yml`
  - `web-dev` 服务：挂载源码目录，暴露开发端口
  - `web-prod` 服务：构建生产镜像，暴露演示端口

## Why This Approach

- 对当前纯前端静态项目足够简单
- 开发和生产入口清晰，适合课程作业演示
- 后续若新增后端服务，也可以继续沿用 Compose 扩展

## Files

- Create: `web/Dockerfile`
- Create: `web/.dockerignore`
- Create: `web/nginx.conf`
- Create: `docker-compose.yml`
- Create: `README.md`

## Runtime Notes

- 开发态需要将 Vite 绑定到 `0.0.0.0`
- 开发态通过卷挂载源码目录，并单独保留容器内 `node_modules`
- 开发态显式指定 HMR 客户端端口，减少端口映射下热更新失效的概率
- macOS/容器卷挂载下文件监听可能不稳定，因此启用轮询监听
- 生产态默认通过 `nginx` 的 80 端口提供服务

## Risks

- 开发态热更新依赖宿主机 Docker 文件同步性能，首次启动会比本地 Node 稍慢
- 生产态只适合静态站点；若后续引入 API，需要新增服务或反向代理配置
