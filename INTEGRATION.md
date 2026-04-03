# 服务端手势识别集成指南

## 概述

本指南说明如何将手势识别从客户端迁移到服务端 GPU。

## 系统要求

### 服务端
- Python 3.8+
- NVIDIA GPU (可选，用于加速)
- Docker (可选)
- 网络连接

### 客户端
- 现代浏览器
- WebSocket 支持

## 快速开始

### 步骤 1: 启动服务端

#### 选项 A: Docker (推荐用于 GPU)

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/server

# 启动 GPU 版本
docker-compose up -d gesture-server

# 查看日志
docker logs -f blackhole-gesture-server
```

#### 选项 B: 本地运行

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/server

# 安装依赖
pip install -r requirements.txt

# 下载模型
python3 START_SERVER.py

# 或直接启动
python3 server.py
```

### 步骤 2: 验证服务端

```bash
curl http://localhost:5000/health
```

应该返回:
```json
{"status": "healthy", "gesture_detector_initialized": true}
```

### 步骤 3: 启动前端

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/web
npm run dev
```

## 架构说明

### 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                          客户端                             │
│                                                             │
│   摄像头 ──► Canvas ──► Base64 JPEG ──► WebSocket ──►       │
│                320x240                                      │
│                                                             │
│                    ◄── JSON 关键点 ─── JSON 手势 ───        │
│                              ◄── WebSocket                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 网络
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                          服务端                             │
│                                                             │
│   WebSocket ──► Base64 解码 ──► NumPy 数组 ──►              │
│                                                             │
│            ┌────────────────────────────────┐               │
│            │    MediaPipe Hands (GPU)       │               │
│            │                                │               │
│            │  1. 手部检测                   │               │
│            │  2. 21点关键点提取             │               │
│            │  3. 手势分类                   │               │
│            └────────────────────────────────┘               │
│                         │                                   │
│                         ▼                                   │
│              ┌─────────────────────┐                       │
│              │   手势状态计算      │                       │
│              │  • 捏合距离         │                       │
│              │  • 拖动方向         │                       │
│              │  • 旋转角度         │                       │
│              └─────────────────────┘                       │
│                         │                                   │
└─────────────────────────┼───────────────────────────────────┘
                          │
                          ▼
               ┌─────────────────────┐
               │   JSON 响应        │
               │ {                  │
               │   landmarks: [],   │
               │   gesture: {...}  │
               │ }                  │
               └─────────────────────┘
```

### 性能对比

| 指标 | 客户端 (CPU) | 客户端 (WASM) | 服务端 (GPU) |
|------|-------------|--------------|--------------|
| 延迟 | 50-100ms | 30-60ms | 100-300ms* |
| 准确性 | 高 | 中 | 高 |
| 设备要求 | 现代浏览器 | 现代浏览器 | 网络 |
| 隐私 | ⚠️ 视频本地 | ⚠️ 视频本地 | ✅ 仅关键点 |

*含网络延迟

## 前端集成

### 使用服务端客户端

1. 复制 `server/serverHandGesture.ts` 到 `web/src/`

2. 在 `main.ts` 中导入:

```typescript
import { ServerHandGestureController } from './serverHandGesture.js';

let handGestureController: ServerHandGestureController | null = null;

async function initHandGesture(): Promise<boolean> {
  handVideo = document.createElement('video');
  // ... 视频元素配置 ...

  handGestureController = new ServerHandGestureController('http://localhost:5000');
  return await handGestureController.initialize(handVideo, handCanvas);
}
```

### 选择模式

在 GUI 中添加切换:

```typescript
gui.add(params, 'useServerGesture').name('使用服务端手势').onChange(async (enabled: boolean) => {
  if (enabled) {
    // 连接到服务端
    await initHandGesture();
  } else {
    // 使用本地客户端
    await initLocalHandGesture();
  }
});
```

## API 参考

### REST API

#### POST /api/detect

检测单张图片中的手势。

**请求:**
```json
{
  "image": "base64编码的JPEG图片"
}
```

**响应:**
```json
{
  "success": true,
  "hand_detected": true,
  "landmarks": [
    {"x": 0.5, "y": 0.3, "z": 0.0},
    {"x": 0.51, "y": 0.29, "z": 0.0},
    ...
  ],
  "gesture": {
    "is_pinching": true,
    "pinch_strength": 0.8,
    "is_dragging": false,
    "is_rotating": false,
    "rotation_angle": 0,
    "gesture_type": "pinch",
    "hand_detected": true
  },
  "num_landmarks": 21
}
```

### WebSocket 事件

#### 客户端 → 服务端

**video_frame**
```json
{
  "image": "base64编码的JPEG图片",
  "timestamp": 1234567890
}
```

#### 服务端 → 客户端

**hand_results**
```json
{
  "success": true,
  "hand_detected": true,
  "landmarks": [...],
  "gesture": {...},
  "num_landmarks": 21
}
```

**frame_error**
```json
{
  "error": "错误描述"
}
```

## 故障排除

### 问题: WebSocket 连接失败

检查:
1. 服务端是否运行: `curl http://localhost:5000/health`
2. 防火墙设置
3. CORS 配置

### 问题: GPU 不被使用

确保:
1. NVIDIA 驱动已安装
2. Docker 使用了 GPU 支持
3. MediaPipe 可以访问 GPU

```bash
# 检查 NVIDIA
nvidia-smi

# 检查 PyTorch CUDA
python3 -c "import torch; print(torch.cuda.is_available())"
```

### 问题: 高延迟

优化:
1. 降低图片分辨率 (320x240 → 160x120)
2. 减少发送频率 (30 FPS → 10 FPS)
3. 使用有线网络

## 部署

### 生产环境

1. 使用 Nginx 反向代理
2. 配置 SSL/TLS
3. 设置 WebSocket 负载均衡
4. 监控性能

### Docker Compose 示例

```yaml
services:
  gesture-server:
    build: .
    ports:
      - "5000:5000"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: always
```

## 安全考虑

1. **CORS**: 生产环境应限制 origins
2. **速率限制**: 防止滥用
3. **认证**: 添加 API 密钥
4. **SSL**: 使用 HTTPS

## 扩展

### 多用户支持

使用 SocketIO 房间:

```python
@socketio.on('subscribe')
def handle_subscribe(data):
    room = data.get('room')
    join_room(room)
    emit('subscribed', {'room': room})

@socketio.on('video_frame')
def handle_frame(data):
    room = request.sid
    # 只处理当前用户的帧
    results = detector.process_frame(data['image'])
    emit('hand_results', results, room=room)
```

### 集群部署

使用 Redis 消息队列:

```python
from flask_socketio import SocketIO, emit

socketio = SocketIO(
    app,
    cors_allowed_origins="*",
    message_queue='redis://localhost:6379'
)
```

## 下一步

- [ ] 添加用户认证
- [ ] 实现手势录制
- [ ] 添加历史记录
- [ ] 优化网络传输
- [ ] 添加缓存

## 获取帮助

如有问题，请提供:
1. 服务端日志
2. 客户端控制台输出
3. 网络延迟测试结果
