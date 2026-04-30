# 手势识别调试指南

## 摄像头已正常工作

✅ 摄像头可以正常访问
❌ 但手势识别不工作

## 请检查浏览器控制台日志

打开浏览器开发者工具（F12），切换到 **Console（控制台）** 标签，查看以下日志信息：

### 正常流程日志应该显示：

```
[HandGesture] === 摄像头初始化开始 ===
[HandGesture] navigator.mediaDevices: {...}
[HandGesture] getUserMedia 函数: function() { [native code] }
[HandGesture] 正在请求摄像头权限...
[HandGesture] 尝试约束: {...}
[HandGesture] 摄像头权限已获得

[HandGesture] 正在加载 MediaPipe Hands 模型...
[HandGesture] MediaPipe Hands 模型加载完成

[HandGesture] 手势控制初始化成功
[HandGesture] 视频元素状态: {
  readyState: 4,        ← 4 表示视频已完全加载
  videoWidth: 320,      ← 应该有实际宽度
  videoHeight: 240,     ← 应该有实际高度
  paused: false,
  ended: false,
}
[HandGesture] MediaPipe Hands 已准备好，请将手放到摄像头前...

[HandGesture] processFrame: 发送帧到 MediaPipe...  ← 每100ms调用一次
[HandGesture] processFrame: 帧处理完成
[HandGesture] onResults 被调用
[HandGesture] 检测到手数量: 0  ← 正常，未检测到手时显示0

[HandGesture] processFrame: 发送帧到 MediaPipe...
[HandGesture] processFrame: 帧处理完成
[HandGesture] onResults 被调用
[HandGesture] 检测到手数量: 1  ← 发现手了！
[HandGesture] 检测到手部关键点数量: 21
```

### 常见问题及解决方案

#### ❌ 问题 1：看不到 processFrame 日志

**原因**：`updateHandGesture` 函数未被调用

**检查项**：
1. ✅ GUI 中是否勾选了"手势控制"选项
2. ✅ 页面是否正在渲染（没有卡死）

#### ❌ 问题 2：MediaPipe Hands 模型加载失败

**错误信息**：
```
[HandGesture] MediaPipe Hands 初始化警告: Error: ...
```

**解决方案**：
1. 检查网络连接（需要下载 MediaPipe 模型）
2. 尝试刷新页面
3. 清除浏览器缓存后重试

#### ❌ 问题 3：视频元素状态异常

**错误信息**：
```
[HandGesture] 视频元素状态: {
  readyState: 0,        ← 0 表示没有加载任何数据
  videoWidth: 0,
  videoHeight: 0,
}
```

**解决方案**：
1. 等待几秒让视频加载
2. 检查摄像头是否正常工作
3. 尝试刷新页面

#### ❌ 问题 4：onResults 频繁报错

**错误信息**：
```
[HandGesture] MediaPipe 处理帧失败: Error: ...
```

**解决方案**：
1. 可能是 MediaPipe 模型加载不完全
2. 尝试降低摄像头分辨率
3. 检查是否有 JavaScript 错误

## 测试手势识别

### 基本测试步骤

1. **确保摄像头正对您**
   - 建议使用前置摄像头（笔记本摄像头或外置USB摄像头）
   - 手部距离摄像头 30-60 厘米

2. **光线充足**
   - 避免背光
   - 避免过暗或过亮
   - 自然光或室内灯光均可

3. **手部姿势测试**
   - ✋ **检测测试**：将张开的手掌对着摄像头
   - ✅ 正常情况下，应该能看到左下角的骨架图
   - ✅ 控制台应该显示 "检测到手数量: 1"

4. **手势识别测试**
   - 🤏 **捏合**：拇指尖触碰食指尖
   - ✋ **拖动**：捏合时移动手部
   - 🔄 **旋转**：转动手腕

### 摄像头预览窗口

页面左下角应该有：
- 📹 **摄像头预览**（160x120像素）
  - 显示实时摄像头画面
  - 镜像显示（左右反转）
- 🎨 **骨架可视化**（160x120像素）
  - 检测到手部时显示绿色骨架
  - 21个关键点用绿色圆点标记

如果能看到摄像头预览但看不到骨架，说明 MediaPipe Hands 没有检测到手部。

## 性能优化建议

### 如果检测不灵敏

1. **调整 MediaPipe 参数**
   ```typescript
   this.hands.setOptions({
     maxNumHands: 1,
     modelComplexity: 0,        // 0=快速，1=准确
     minDetectionConfidence: 0.5,  // 降低检测阈值
     minTrackingConfidence: 0.5,   // 降低跟踪阈值
   });
   ```

2. **优化摄像头设置**
   ```typescript
   const constraints = {
     video: {
       width: { ideal: 320 },   // 不要太高分辨率
       height: { ideal: 240 },
       frameRate: { ideal: 15 }, // 不要太高帧率
     },
     audio: false,
   };
   ```

3. **环境优化**
   - ✅ 光线充足
   - ✅ 背景简洁
   - ✅ 手部清晰可见
   - ❌ 避免多人同时出现在画面中

## 常见错误代码

| 错误代码 | 含义 | 解决方案 |
|---------|------|---------|
| `NotAllowedError` | 摄像头权限被拒绝 | 允许浏览器访问摄像头 |
| `NotFoundError` | 未找到摄像头 | 检查摄像头连接 |
| `NotReadableError` | 摄像头被占用 | 关闭其他使用摄像头的应用 |
| `OverconstrainedError` | 摄像头不支持指定参数 | 使用更宽松的约束 |

## 获取帮助

如果问题仍然存在，请提供以下信息：

1. **浏览器类型和版本**：
   - Chrome: 设置 → 关于 Chrome
   - Firefox: 设置 → 关于 Firefox
   - Edge: 设置 → 关于 Microsoft Edge

2. **操作系统**：
   - Windows 10/11
   - macOS Ventura/Sonoma
   - Linux (Ubuntu/Debian等)

3. **摄像头类型**：
   - 笔记本内置摄像头
   - 外置 USB 摄像头
   - 手机摄像头（通过某些应用）

4. **控制台日志**：
   - 打开 F12 → Console 标签
   - 复制所有 `[HandGesture]` 开头的日志

5. **问题描述**：
   - 能看到摄像头预览吗？
   - 能看到手部骨架吗？
   - 什么手势不工作？
   - 是一直不工作还是偶尔不工作？

## 调试技巧

### 使用浏览器的 Media 面板

1. 打开 Chrome DevTools
2. 点击 "..." → More tools → Media
3. 可以看到摄像头状态和帧率

### 测试 MediaPipe 官方演示

访问 MediaPipe Hands 官方演示页面：
https://storage.googleapis.com/mediapipe-assets/documentation.md

如果官方演示也不工作，说明是 MediaPipe 本身的问题或环境配置问题。

---

**注意**：MediaPipe Hands 需要从 CDN 下载模型文件，请确保网络连接稳定。
