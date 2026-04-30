#!/bin/bash

echo "=========================================="
echo "黑洞 Web - HTTPS 开发服务器"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

if [ ! -f localhost-key.pem ] || [ ! -f localhost.pem ]; then
    echo "正在生成 SSL 证书..."
    openssl req -x509 -newkey rsa:4096 -keyout localhost-key.pem -out localhost.pem -days 365 -nodes -subj "/CN=localhost" 2>&1 | grep -v "^+" | grep -v "^\."
    echo "SSL 证书已生成"
    echo ""
fi

echo "启动 HTTPS 开发服务器..."
echo "访问地址: https://localhost:5174"
echo ""
echo "重要提示:"
echo "1. 浏览器会显示安全警告，点击'高级' -> '继续前往localhost'"
echo "2. 允许摄像头权限"
echo "3. 手势控制功能已启用"
echo ""
echo "按 Ctrl+C 停止服务器"
echo "=========================================="
echo ""

npm run dev
