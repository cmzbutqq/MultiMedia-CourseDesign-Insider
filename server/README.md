# 服务端手势识别系统

## 概述

本系统将手势识别计算从客户端转移到服务端，使用 **MediaPipe Hands** 进行手部检测和手势识别，支持 **GPU 加速**。

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     客户端 (浏览器)                       │
│  ┌─────────────────────────────────────────────────┐   │
│  │  摄像头捕获 → 转换为 JPEG → 发送到服务器          │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           │ WebSocket                   │
│                           ▼                             │
├─────────────────────────────────────────────────────────┤
│                     服务端 (Python)                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Flask + SocketIO 服务器                         │   │
│  │  ┌───────────────────────────────────────────┐   │   │
│  │  │  MediaPipe Hands (GPU 加速)               │   │   │
│  │  │  • 手部检测                                │   │   │
│  │  │  • 21 点关键点提取                        │   │   │
│  │  │  • 手势识别                                │   │   │
│  │  └───────────────────────────────────────────┘   │   │
│  │  ┌───────────────────────────────────────────┐   │   │
│  │  │  手势状态计算                             │   │   │
│  │  │  • 捏合检测                               │   │   │
│  │  │  • 拖动检测                               │   │   │
│  │  │  • 旋转检测                               │   │   │
│  │  └───────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────┘   │
│                           │                             │
│                           │ JSON (关键点 + 手势状态)      │
│                           ▼                             │
└─────────────────────────────────────────────────────────┘
```

## 优势

| 特性 | 客户端版本 | 服务端版本 |
|------|----------|-----------|
| **计算资源** | 受客户端限制 | 服务端高性能 GPU |
| **延迟** | 50-100ms | 100-300ms (含网络) |
| **隐私** | ⚠️ 本地处理 | ✅ 视频不上传存储 |
| **扩展性** | ❌ 固定 | ✅ 弹性扩展 |
| **设备要求** | 现代浏览器 | 网络连接 |

## 快速开始

### 方法 1: 使用 Docker (推荐)

```bash
cd server

# 启动 GPU 版本
docker-compose up -d gesture-server

# 或启动 CPU 版本 (如果没有 GPU)
docker-compose --profile cpu-only up -d gesture-server-cpu
```

### 方法 2: 本地运行

```bash
cd server

# 创建虚拟环境
./start-server.sh

# 或手动
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 server.py
```

## API 端点

### 1. 健康检查

```bash
curl http://localhost:5000/health
```

响应:
```json
{
  "status": "healthy",
  "gesture_detector_initialized": true
}
```

### 2. REST API 手势检测

```bash
curl -X POST http://localhost:5000/api/detect \
  -H "Content-Type: application/json" \
  -d '{"image": "base64编码的JPEG图片"}'
```

响应:
```json
{
  "success": true,
  "hand_detected": true,
  "landmarks": [
    {"x": 0.5, "y": 0.3, "z": 0.0},
    ...
  ],
  "gesture": {
    "is_pinching": true,
    "pinch_strength": 0.8,
    "is_dragging": false,
    "gesture_type": "pinch",
    "hand_detected": true
  }
}
```

### 3. WebSocket 实时通信

```javascript
const socket = io('http://localhost:5000');

socket.on('connect', () => {
  console.log('已连接到服务器');
});

socket.on('hand_results', (data) => {
  console.log('手势结果:', data);
  
  // 处理关键点
  if (data.hand_detected) {
    const landmarks = data.landmarks;
    const gesture = data.gesture;
    // 应用到手势控制
  }
});

socket.on('frame_error', (error) => {
  console.error('处理错误:', error);
});

// 发送视频帧
socket.emit('video_frame', {
  image: base64ImageData,
  timestamp: Date.now()
});
```

## GPU 加速

### NVIDIA GPU 设置

#### Docker 环境 (推荐)

`docker-compose.yml` 已配置 NVIDIA GPU 支持:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

确保安装:
- [NVIDIA Docker 运行时](https://github.com/NVIDIA/nvidia-docker)
- NVIDIA 驱动

#### 本地环境

安装 CUDA 和 cuDNN:

```bash
# 检查 GPU 可用性
python3 -c "import torch; print(torch.cuda.is_available())"
```

MediaPipe 将自动使用 GPU:

```python
base_options = python.BaseOptions(
    delegate=python.BaseOptions.Delegate.GPU  # 使用 GPU
)
```

## 性能基准

| GPU | 处理时间/帧 | 并发用户数 (10 FPS) |
|-----|-----------|-------------------|
| NVIDIA T4 | ~20ms | ~50 |
| NVIDIA A100 | ~5ms | ~200 |
| CPU (高性能) | ~50ms | ~10 |

## 配置

编辑 `config.json`:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 5000
  },
  "gesture_detection": {
    "use_gpu": true,
    "num_hands": 1,
    "min_detection_confidence": 0.7
  },
  "gesture_thresholds": {
    "pinch": 0.07,
    "drag": 0.02,
    "rotate": 0.1
  }
}
```

## 集成到前端

### 使用服务端客户端

```typescript
import { ServerHandGestureController } from './serverHandGesture';

const controller = new ServerHandGestureController('http://localhost:5000');

await controller.initialize(videoElement, canvasElement);

controller.onGesture((results) => {
  if (results.hand_detected) {
    // 应用手势控制
    const { gesture } = results;
    if (gesture.is_dragging) {
      // 拖动控制
    }
  }
});

controller.setEnabled(true);
```

## 故障排除

### 问题 1: GPU 不可用

检查:
```bash
nvidia-smi
python3 -c "import torch; print(torch.cuda.is_available())"
```

解决方案: 使用 CPU 版本或安装 NVIDIA 驱动

### 问题 2: MediaPipe 模型下载失败

手动下载:
```bash
wget https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
mv hand_landmarker.task server/
```

### 问题 3: WebSocket 连接失败

检查:
- 服务器是否运行
- 防火墙设置
- CORS 配置

### 问题 4: 延迟过高

优化建议:
- 降低图片分辨率
- 使用 GPU 加速
- 优化网络连接

## 开发

### 运行测试

```bash
python3 -c "
from server import GestureDetector

detector = GestureDetector()
with open('test.jpg', 'rb') as f:
    result = detector.process_frame(f.read())
    print(result)
"
```

### 性能监控

服务器自动记录:
- 连接数
- 处理帧数
- FPS

查看日志:
```bash
tail -f server.log
```

## 许可

本项目基于 MediaPipe (Apache 2.0) 和其他开源组件。

## 下一步

- [ ] 添加多用户支持
- [ ] 实现手势录制
- [ ] 添加手势识别历史
- [ ] 优化网络传输
- [ ] 添加缓存机制
