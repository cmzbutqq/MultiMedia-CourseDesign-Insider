# HTTPS 配置说明

## 为什么需要 HTTPS？

现代浏览器要求在非 localhost 环境下必须使用 HTTPS 才能访问以下功能：
- 摄像头 (`getUserMedia`)
- 麦克风
- 位置信息
- 通知

您的应用中的**手势控制功能**需要访问摄像头，因此必须使用 HTTPS。

## 已完成的配置

✅ 已生成自签名 SSL 证书：
- `localhost.pem` - SSL 证书
- `localhost-key.pem` - SSL 私钥

✅ 已配置 Vite 使用 HTTPS

## 如何启动

### 方法 1：使用启动脚本（推荐）

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/web
./start-https.sh
```

### 方法 2：手动启动

```bash
cd /mnt/DOC/Projects/MultiMedia-CourseDesign-Insider/web
npm run dev
```

## 首次访问设置

1. 在浏览器中访问：`https://localhost:5174`

2. 浏览器会显示安全警告：
   - **Chrome/Edge**: 点击"高级" → "继续前往 localhost（不安全）"
   - **Firefox**: 点击"高级" → "接受风险并继续"

3. 在页面中勾选"手势控制"选项

4. 浏览器会请求摄像头权限，点击"允许"

## 测试手势控制

1. 确保摄像头已连接并正常工作
2. 在摄像头前伸出手
3. 应该能在左下角看到：
   - 摄像头预览画面
   - 手部骨架可视化
   - 手势状态显示

## 故障排除

### 问题 1：摄像头无法访问

**检查项：**
- ✅ 摄像头已正确连接
- ✅ 没有被其他应用占用
- ✅ 浏览器已授权摄像头权限
- ✅ 使用的是 HTTPS 地址（不是 HTTP）

### 问题 2：手势检测不灵敏

**调整方法：**
1. 保持手部在摄像头范围内
2. 确保光线充足
3. 避免背景过于复杂
4. 慢慢移动手部

### 问题 3：自签名证书警告

这是正常的！自签名证书不被浏览器信任，但可以正常使用。

## 安全说明

⚠️ **重要**：
- 本 SSL 证书仅用于本地开发
- 请勿在生产环境使用自签名证书
- `.gitignore` 已配置，不会将证书提交到仓库
- 如果需要新证书，运行：`openssl req -x509 -newkey rsa:4096 -keyout localhost-key.pem -out localhost.pem -days 365 -nodes -subj "/CN=localhost"`

## 相关文件

- `vite.config.ts` - Vite 配置文件（含 HTTPS 设置）
- `localhost.pem` - SSL 证书
- `localhost-key.pem` - SSL 私钥
- `start-https.sh` - 启动脚本

## 技术细节

### Vite HTTPS 配置

```typescript
server: {
  https: {
    key: './localhost-key.pem',
    cert: './localhost.pem',
  },
  host: '0.0.0.0',  // 允许外部访问
  port: 5174,
  cors: true,  // 允许跨域
}
```

### 浏览器安全策略

- `https://` + 非 localhost → 需要用户授权摄像头
- `http://localhost` → 自动允许（开发环境例外）
- `http://<IP>` → 需要 HTTPS

## 常见错误

### Error: "getUserMedia is not a function"

**原因**：浏览器不支持或摄像头 API 被禁用

**解决**：
1. 检查是否使用 HTTPS
2. 检查浏览器是否支持 `getUserMedia`
3. 尝试使用 Chrome 或 Firefox

### Error: "Permission denied"

**原因**：摄像头权限被拒绝

**解决**：
1. 检查浏览器权限设置
2. 尝试刷新页面并重新授权
3. 检查是否有其他应用占用摄像头

## 获取帮助

如果在设置过程中遇到问题，请提供：
1. 浏览器类型和版本
2. 控制台错误信息
3. 是否能看到摄像头预览
4. 手势控制的状态显示

---

**项目支持的手势：**
- ✋ 捏合（Pinch）- 选中对象
- ✋ 拖动（Drag）- 平移视角
- 🔄 旋转（Rotate）- 旋转相机

享受手势控制的乐趣！🚀
