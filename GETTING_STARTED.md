# 服务端手势识别 - 快速开始指南

## 🎯 完成的工作

已创建完整的服务端手势识别系统，将计算从客户端转移到服务端 GPU。

## 📁 项目结构

```
/mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/
├── server/                          # 服务端代码
│   ├── server.py                    # 主服务器 (Flask + SocketIO)
│   ├── serverHandGesture.ts         # 前端客户端 (TypeScript)
│   ├── requirements.txt             # Python 依赖
│   ├── config.json                 # 配置文件
│   ├── Dockerfile                   # Docker 配置
│   ├── docker-compose.yml           # Docker Compose
│   ├── start-server.sh             # 启动脚本 (Shell)
│   ├── START_SERVER.py             # 启动脚本 (Python)
│   └── README.md                   # 服务端文档
├── web/                            # 前端代码 (已有)
│   └── src/
│       └── handGesture.ts          # 本地客户端
└── INTEGRATION.md                   # 集成指南

## 🚀 快速开始

### 1. 启动服务端 (Docker + GPU)

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/server

# 使用 Docker Compose 启动
docker-compose up -d gesture-server

# 查看日志
docker logs -f blackhole-gesture-server
```

### 2. 启动前端

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/web
npm run dev
```

### 3. 测试

1. 打开浏览器访问 `https://localhost:5174`
2. 勾选"手势控制"
3. 将手放到摄像头前

## ⚙️ 工作原理

```
客户端                          服务端
  │                               │
  │  ───── 摄像头画面 (JPEG) ────►│
  │                               │
  │                               │  ┌──────────────────┐
  │                               │  │ MediaPipe Hands  │
  │                               │  │ (GPU 加速)       │
  │                               │  │ • 手部检测       │
  │                               │  │ • 21点关键点     │
  │                               │  │ • 手势分类       │
  │                               │  └──────────────────┘
  │                               │
  │  ◄─── 手势结果 (JSON) ────────│
  │                               │
```

## 📊 性能对比

| 版本 | 计算位置 | 延迟 | GPU |
|------|---------|------|-----|
| 本地 (当前) | 客户端浏览器 | 50-100ms | ❌ |
| 服务端 (新) | 服务器 | 100-300ms* | ✅ |

*含网络传输延迟

## 🔧 配置

### 服务端地址

在 `serverHandGesture.ts` 中修改:

```typescript
const controller = new ServerHandGestureController('http://localhost:5000');
```

### GPU/CPU 模式

Docker:
```bash
# GPU 版本
docker-compose up -d gesture-server

# CPU 版本
docker-compose --profile cpu-only up -d gesture-server-cpu
```

## 📚 文档

- [服务 README](server/README.md) - 详细服务端文档
- [集成指南](INTEGRATION.md) - 如何集成到现有项目
- [HTTPS 设置](../web/HTTPS_SETUP.md) - 摄像头权限配置

## 🐛 故障排除

### 问题: WebSocket 连接失败

```bash
# 检查服务端是否运行
curl http://localhost:5000/health
```

### 问题: GPU 不工作

```bash
# 检查 NVIDIA
nvidia-smi

# 检查 Docker GPU 支持
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi
```

### 问题: 延迟过高

降低图片分辨率:
```typescript
canvas.width = 160;  // 从 320 降到 160
canvas.height = 120; // 从 240 降到 120
```

## 🎨 架构

### 服务端 (Python)

```python
# server.py
from flask import Flask
from flask_socketio import SocketIO
import mediapipe as mp

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# GPU 加速的 MediaPipe
mp_hands = mp.tasks.vision.HandLandmarker(
    base_options=BaseOptions(delegate=Delegate.GPU)
)

@socketio.on('video_frame')
def handle_frame(data):
    # 处理帧
    results = mp_hands.detect(data['image'])
    emit('hand_results', results)
```

### 客户端 (TypeScript)

```typescript
// serverHandGesture.ts
class ServerHandGestureController {
  private socket: Socket;
  
  async processFrame() {
    // 捕获摄像头帧
    const image = canvas.toDataURL('image/jpeg');
    
    // 发送到服务器
    this.socket.emit('video_frame', {
      image: base64,
      timestamp: Date.now()
    });
  }
}
```

## 📈 下一步

1. [ ] 将 `serverHandGesture.ts` 集成到 `web/src/main.ts`
2. [ ] 添加服务端/本地切换开关
3. [ ] 优化网络传输
4. [ ] 添加性能监控

## 💡 提示

- 服务端需要稳定的网络连接
- GPU 加速需要 NVIDIA 显卡
- 首次运行会下载 MediaPipe 模型 (~50MB)

## 📞 获取帮助

查看详细文档:
- `server/README.md`
- `INTEGRATION.md`
- `web/HAND_TRACKING_DEBUG.md`
