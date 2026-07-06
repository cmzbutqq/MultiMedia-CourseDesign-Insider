# 服务端手势识别

`server/` 提供一个可选的 Python 后端，用于把手部检测放到浏览器外执行。当前网页主入口 `web/src/main.ts` 已接入该服务，对应客户端是 `web/src/serverGestureClient.ts`。

## 当前实现边界

- 服务端返回 `21` 个关键点、手掌中心位置、张手状态和手指数
- 当前没有独立的 `pinch / drag / rotate` 分类输出
- 网页中的 `服务器识别` 模式本质上只使用 `palm_x / palm_y` 和 `is_open_palm`
- `server/serverHandGesture.ts` 仍在仓库中，但不是当前 `web/` 主入口使用的客户端

## 启动方式

### 推荐：脚本自动创建虚拟环境

```bash
cd server
./start-server.sh
```

脚本会：

- 创建 `venv/`
- 安装 `requirements.txt`
- 尝试探测 CUDA
- 启动 `python3 server.py`

### 手动启动

```bash
cd server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 server.py
```

### 辅助启动器

```bash
cd server
python3 START_SERVER.py
```

这个入口会多做几步检查，但最后仍然运行 `server.py`。

### Docker

```bash
docker compose -f server/docker-compose.yml -p blackhole-server up --build
```

说明：

- 当前 `server/docker-compose.yml` 启动的是 CPU 模式，明确设置了 `CUDA_VISIBLE_DEVICES=-1`
- 根目录 `docker-compose.yml` 也使用同一个服务端镜像，并通过前端 Nginx 代理 `/health` 和 `/api/detect`
- `server/docker-compose.yml` 中的 GPU 配置只是注释示例，默认不会启动

## 前端如何使用

启动服务端后，在前端页面中选择：

`常用操作 -> 手势识别 -> 服务器识别`

如果使用根目录 Docker Compose，则直接访问：

- `http://localhost:8080`
- `https://localhost:8443`

如果使用本地前端开发服务器，则默认由 `web/src/serverGestureClient.ts` 请求：

- `http://localhost:5000/health`
- `http://localhost:5000/api/detect`

## HTTP 接口

### `GET /health`

```bash
curl http://localhost:5000/health
```

返回示例：

```json
{
  "status": "healthy",
  "gesture_detector_initialized": true
}
```

说明：

- 当检测器初始化失败时，接口仍返回 `200`
- 此时 `status` 会变成 `degraded`

### `POST /api/detect`

```bash
curl -X POST http://localhost:5000/api/detect \
  -H "Content-Type: application/json" \
  -d '{"image":"<base64-jpeg>"}'
```

请求体：

- `image`：JPEG 的 base64 字符串；可带或不带 `data:image/...;base64,` 前缀

成功响应示例：

```json
{
  "success": true,
  "hand_detected": true,
  "landmarks": [
    { "x": 0.5, "y": 0.3, "z": 0.0 }
  ],
  "gesture": {
    "hand_detected": true,
    "hand_confidence": 0.8,
    "palm_x": 0.5,
    "palm_y": 0.5,
    "is_open_palm": true,
    "finger_count": 5
  },
  "num_landmarks": 21
}
```

失败时常见状态码：

- `400`：请求体不是合法 JSON，或缺少 `image`
- `413`：图片体积或像素数量超过限制
- `429`：同一客户端请求过快
- `503`：检测器未初始化

## Socket.IO 事件

服务端仍保留 Socket.IO 入口，适合实验或自定义客户端：

- 客户端发送：`video_frame`、`subscribe`、`unsubscribe`
- 服务端返回：`connected`、`hand_results`、`frame_error`、`subscribed`、`unsubscribed`

当前仓库自带网页主入口默认走 HTTP `/health` + `/api/detect`，不是 Socket.IO。

## 当前输出字段

`gesture` 对象当前只包含以下状态：

- `hand_detected`
- `hand_confidence`
- `palm_x`
- `palm_y`
- `is_open_palm`
- `finger_count`

如果你在实验报告或其他文档中描述服务端能力，建议按这组字段写，不要写成已经支持独立的捏合、拖拽、旋转分类。

## 运行时限制

`server.py` 目前内置了几类保护：

- base64 图片大小限制
- 图片像素上限
- 每客户端帧率限制
- 最大客户端数量限制
- Socket 房间名字符合法性与数量限制

这些限制主要通过环境变量调整，而不是通过 `config.json`。

## 配置来源

当前运行配置以 `server.py` 中的默认值和环境变量为准，例如：

- `CORS_ORIGIN`
- `SOCKETIO_ORIGINS`
- `MAX_IMAGE_BYTES`
- `MAX_IMAGE_PIXELS`
- `MAX_CLIENTS`
- `MAX_FRAMES_PER_CLIENT_PER_SECOND`
- `TRUST_PROXY_HEADERS`

`config.json` 目前没有被 `server.py` 读取，修改该文件不会改变实际运行行为。

## 测试

在仓库根目录运行：

```bash
python -m unittest discover -s server/tests -p 'test_*.py'
```

覆盖点主要包括：

- `/health` 状态
- 非法 JSON 与超限图片处理
- 速率限制
- Socket payload 校验
- 启动时模型下载/检测器初始化失败的韧性
