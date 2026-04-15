#!/bin/bash

echo "=========================================="
echo "黑洞 Web - 服务端手势识别服务器"
echo "GPU 加速版本"
echo "=========================================="
echo ""

cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "创建虚拟环境..."
    python3 -m venv venv
    echo "虚拟环境创建完成"
    echo ""
fi

echo "激活虚拟环境..."
source venv/bin/activate

echo "安装依赖..."
pip install -q -r requirements.txt

if [ $? -ne 0 ]; then
    echo "错误: 依赖安装失败"
    exit 1
fi

echo ""
echo "=========================================="
echo "检查 GPU 支持..."
echo "=========================================="

python3 -c "
try:
    import torch
except ModuleNotFoundError:
    print('⚠ 未安装 torch，跳过 CUDA 探测（服务仍可运行）')
else:
    if torch.cuda.is_available():
        print(f'✓ GPU 可用: {torch.cuda.get_device_name(0)}')
        print(f'  CUDA 版本: {torch.version.cuda}')
        print(f'  GPU 数量: {torch.cuda.device_count()}')
    else:
        print('⚠ GPU 不可用，将使用 CPU')
"

echo ""
echo "=========================================="
echo "启动服务器..."
echo "=========================================="
echo ""
echo "访问地址:"
echo "  - HTTP API:  http://localhost:5000/api/detect"
echo "  - WebSocket: ws://localhost:5000"
echo "  - 健康检查:  http://localhost:5000/health"
echo ""
echo "按 Ctrl+C 停止服务器"
echo "=========================================="
echo ""

python3 server.py
