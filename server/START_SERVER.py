#!/usr/bin/env python3
"""
黑洞 Web - 服务端手势识别快速启动器
"""

import os
import sys
import subprocess
import webbrowser
import time

def print_banner():
    print("=" * 70)
    print("  黑洞 Web - 服务端手势识别系统 (GPU 加速)")
    print("=" * 70)
    print()

def check_python():
    """检查 Python 版本"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 8):
        print("❌ 错误: 需要 Python 3.8 或更高版本")
        print(f"   当前版本: Python {version.major}.{version.minor}.{version.micro}")
        return False
    print(f"✓ Python 版本: {version.major}.{version.minor}.{version.micro}")
    return True

def check_cuda():
    """检查 CUDA/GPU 支持"""
    try:
        import torch
        if torch.cuda.is_available():
            print(f"✓ GPU 可用: {torch.cuda.get_device_name(0)}")
            print(f"  CUDA 版本: {torch.version.cuda}")
            return True
        else:
            print("⚠ GPU 不可用，将使用 CPU 模式")
            return False
    except ImportError:
        print("⚠ PyTorch 未安装，将使用 CPU 模式")
        return False

def check_dependencies():
    """检查依赖是否安装"""
    try:
        import flask
        import socketio
        import cv2
        import mediapipe
        print("✓ 所有 Python 依赖已安装")
        return True
    except ImportError as e:
        print(f"❌ 缺少依赖: {e.name}")
        print("\n请运行以下命令安装依赖:")
        print("  pip install -r requirements.txt")
        return False

def download_model():
    """下载 MediaPipe 模型"""
    model_path = 'hand_landmarker.task'
    if os.path.exists(model_path):
        print(f"✓ 模型已存在: {model_path}")
        return True
    
    print("\n正在下载 MediaPipe 模型...")
    try:
        import urllib.request
        url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
        urllib.request.urlretrieve(url, model_path)
        print(f"✓ 模型下载完成: {model_path}")
        return True
    except Exception as e:
        print(f"⚠ 模型下载失败: {e}")
        print("  服务器将尝试在线加载模型")
        return False

def start_server(gpu_mode=True):
    """启动服务器"""
    print("\n" + "=" * 70)
    print("启动服务器...")
    print("=" * 70)
    print()
    
    env = os.environ.copy()
    if not gpu_mode:
        env['CUDA_VISIBLE_DEVICES'] = '-1'
    
    try:
        print("按 Ctrl+C 停止服务器")
        print()
        
        subprocess.run([
            sys.executable, 'server.py'
        ], env=env)
        
    except KeyboardInterrupt:
        print("\n\n服务器已停止")

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    print_banner()
    
    if not check_python():
        sys.exit(1)
    
    gpu_available = check_cuda()
    
    if not check_dependencies():
        print("\n是否现在安装依赖? (y/n)")
        response = input("> ").strip().lower()
        if response == 'y':
            subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'])
        else:
            print("无法启动服务器")
            sys.exit(1)
    
    download_model()
    
    print()
    print("=" * 70)
    print("服务器信息")
    print("=" * 70)
    print(f"  加速模式: {'GPU' if gpu_available else 'CPU'}")
    print(f"  HTTP API:  http://localhost:5000/api/detect")
    print(f"  WebSocket: ws://localhost:5000")
    print(f"  健康检查:  http://localhost:5000/health")
    print()
    
    start_server(gpu_available)

if __name__ == '__main__':
    main()
