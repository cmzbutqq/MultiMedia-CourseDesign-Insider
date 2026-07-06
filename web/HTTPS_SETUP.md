# HTTPS 与摄像头

## 什么时候需要 HTTPS

以下场景建议直接使用 HTTPS：

- 通过局域网 IP 或非 `localhost` 域名访问前端
- 需要稳定的摄像头安全上下文
- 想和根目录 Docker 部署的 `https://localhost:8443` 保持一致

如果只是本机调试，`http://localhost:5174` 通常也可以正常申请摄像头权限，不是必须先上 HTTPS。

## 本地 HTTPS 启动

```bash
cd web
./start-https.sh
```

脚本会在缺少证书时自动生成：

- `localhost.pem`
- `localhost-key.pem`

然后启动 Vite，默认地址：

- `https://localhost:5174`

## 首次访问

首次访问自签名证书地址时，浏览器通常会提示风险。继续访问本地站点即可，然后允许摄像头权限。

## 与手势模式配合

前端页面中的入口是：

`常用操作 -> 手势识别 -> 关闭 / 本地识别 / 服务器识别`

- `本地识别`：仅需要浏览器摄像头权限
- `服务器识别`：还需要先启动 `server/` 服务，见 `../server/README.md`

当前手势逻辑只使用“张开手掌 + 手掌位置”控制视角，不包含独立的捏合、旋转分类。

## 常见问题

### 浏览器提示证书不安全

本地自签名证书的正常表现。继续访问 `localhost` 即可。

### 页面拿不到摄像头

优先检查：

- 浏览器是否已授予摄像头权限
- 摄像头是否被其他应用占用
- 当前访问地址是否是 `localhost` 或 HTTPS

### 服务器识别模式无法连接

先确认服务端健康检查是否正常：

```bash
curl http://localhost:5000/health
```

或者直接使用根目录部署：

```bash
docker compose -p blackhole-web up --build
```

### 只想本机调试，不想处理证书

直接运行：

```bash
cd web
npm run dev
```

访问 `http://localhost:5174` 即可。
