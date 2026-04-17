#!/usr/bin/env python3
"""
黑洞 Web - 服务端手势识别系统
使用 MediaPipe Hands 进行手部检测和手势识别
GPU 加速版本
"""

import base64
import binascii
import io
import json
import os
import time
import logging
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, asdict
from enum import Enum

import cv2
import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', os.urandom(32).hex())

# Limit payload size to reduce DoS risk from oversized frames.
MAX_IMAGE_BYTES = int(os.environ.get('MAX_IMAGE_BYTES', str(2 * 1024 * 1024)))
MAX_IMAGE_BASE64_CHARS = ((MAX_IMAGE_BYTES + 2) // 3) * 4
MAX_SOCKETIO_BUFFER_SIZE = int(
    os.environ.get('MAX_SOCKETIO_BUFFER_SIZE', str(MAX_IMAGE_BASE64_CHARS + 1024))
)
app.config['MAX_CONTENT_LENGTH'] = int(
    os.environ.get('MAX_CONTENT_LENGTH', str(MAX_IMAGE_BASE64_CHARS + 1024))
)

_cors_origins = [
    os.environ.get('CORS_ORIGIN', 'http://localhost:5173'),
]
CORS(app, origins=[o for o in _cors_origins if o])

socketio = SocketIO(app,
    cors_allowed_origins=os.environ.get('SOCKETIO_ORIGINS', 'http://localhost:5173').split(','),
    async_mode='eventlet',
    max_http_buffer_size=MAX_SOCKETIO_BUFFER_SIZE
)

def _strip_data_url_prefix(image_b64: str) -> str:
    """Strip optional data URL prefix from base64 image data."""
    return image_b64.split(',', 1)[1] if ',' in image_b64 else image_b64

def _decode_image_payload(image_b64: Any) -> bytes:
    """Validate and decode image payload, raising ValueError on invalid input."""
    if not isinstance(image_b64, str) or not image_b64.strip():
        raise ValueError('image 必须是非空 base64 字符串')

    payload = _strip_data_url_prefix(image_b64.strip())
    if len(payload) > MAX_IMAGE_BASE64_CHARS:
        raise ValueError(f'image payload 过大，最大允许 {MAX_IMAGE_BYTES} 字节原始图像')

    try:
        return base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError('image 不是有效的 base64 编码') from exc

@app.errorhandler(413)
def request_too_large(_error):
    return jsonify({'error': f'请求体过大，最大允许 {MAX_IMAGE_BYTES} 字节图像'}), 413

class GestureType(Enum):
    NONE = "none"
    PINCH = "pinch"
    DRAG = "drag"
    ROTATE = "rotate"

@dataclass
class HandLandmark:
    x: float
    y: float
    z: float
    visibility: float = 0.0

@dataclass
class GestureState:
    hand_detected: bool = False
    hand_confidence: float = 0.0
    palm_x: float = 0.5
    palm_y: float = 0.5
    is_open_palm: bool = False
    finger_count: int = 0

class GestureDetector:
    """手势检测器 - MediaPipe Hands GPU 加速版本"""
    
    def __init__(self):
        self.hands: Optional[mp.tasks.vision.HandLandmarker] = None
        self.initialized = False
        self.frame_counter = 0
        
        self._initialize_detector()
    
    def _initialize_detector(self):
        """初始化 MediaPipe Hands 检测器"""
        try:
            logger.info("正在初始化 MediaPipe Hands 检测器...")
            
            base_options = python.BaseOptions(
                model_asset_path='hand_landmarker.task',
                delegate=python.BaseOptions.Delegate.GPU
            )
            options = vision.HandLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.VIDEO,
                num_hands=1,
                min_hand_detection_confidence=0.5,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5
            )
            
            self.hands = vision.HandLandmarker.create_from_options(options)
            self.initialized = True
            logger.info("MediaPipe Hands 检测器初始化成功 (GPU 加速)")
            
        except Exception as e:
            logger.error(f"MediaPipe 初始化失败: {e}")
            logger.info("回退到 CPU 模式...")
            self._initialize_cpu()
    
    def _initialize_cpu(self):
        """CPU 回退模式"""
        try:
            base_options = python.BaseOptions(
                model_asset_path='hand_landmarker.task',
                delegate=python.BaseOptions.Delegate.CPU
            )
            options = vision.HandLandmarkerOptions(
                base_options=base_options,
                running_mode=vision.RunningMode.VIDEO,
                num_hands=1,
                min_hand_detection_confidence=0.5,
                min_hand_presence_confidence=0.5,
                min_tracking_confidence=0.5
            )
            
            self.hands = vision.HandLandmarker.create_from_options(options)
            self.initialized = True
            logger.info("MediaPipe Hands 检测器初始化成功 (CPU 模式)")
            
        except Exception as e:
            logger.error(f"CPU 初始化也失败: {e}")
            raise
    
    def process_frame(self, image_data: bytes, timestamp_ms: int = 0) -> Dict[str, Any]:
        """
        处理单帧图像，返回手势识别结果
        
        Args:
            image_data: JPEG 图片的字节数据
            timestamp_ms: 时间戳（毫秒）
            
        Returns:
            包含检测结果的字典
        """
        if not self.initialized or not self.hands:
            return {
                'success': False,
                'error': '检测器未初始化',
                'landmarks': [],
                'gesture': asdict(GestureState())
            }
        
        try:
            nparr = np.frombuffer(image_data, np.uint8)
            frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            
            if frame is None:
                return {
                    'success': False,
                    'error': '无法解码图片',
                    'landmarks': [],
                    'gesture': asdict(GestureState())
                }
            
            frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=frame_rgb)
            
            self.frame_counter += 1
            timestamp_ms = self.frame_counter * 33
            
            hand_results = self.hands.detect_for_video(mp_image, timestamp_ms)
            
            if not hand_results.hand_landmarks or len(hand_results.hand_landmarks) == 0:
                gesture_state = GestureState()
                self._reset_state()
                return {
                    'success': True,
                    'hand_detected': False,
                    'landmarks': [],
                    'gesture': asdict(gesture_state)
                }
            
            landmarks = hand_results.hand_landmarks[0]
            gesture_state = self._process_gestures(landmarks)
            
            landmarks_dict = [
                {
                    'x': lm.x,
                    'y': lm.y,
                    'z': lm.z if hasattr(lm, 'z') else 0.0
                }
                for lm in landmarks
            ]
            
            return {
                'success': True,
                'hand_detected': True,
                'landmarks': landmarks_dict,
                'gesture': asdict(gesture_state),
                'num_landmarks': len(landmarks)
            }
            
        except Exception as e:
            logger.error(f"处理帧时出错: {e}")
            return {
                'success': False,
                'error': str(e),
                'landmarks': [],
                'gesture': asdict(GestureState())
            }
    
    def _process_gestures(self, landmarks) -> GestureState:
        """处理手势识别逻辑 - 简化为手掌位置和开合检测"""
        state = GestureState()
        
        if len(landmarks) < 21:
            return state
        
        palm_center = landmarks[9]
        
        state.palm_x = palm_center.x
        state.palm_y = palm_center.y
        state.hand_detected = True
        state.hand_confidence = 0.8
        
        finger_count = self._count_extended_fingers(landmarks)
        state.finger_count = finger_count
        state.is_open_palm = finger_count >= 4
        
        return state
    
    def _count_extended_fingers(self, landmarks) -> int:
        """计算伸展的手指数量"""
        finger_tips = [8, 12, 16, 20]
        finger_mids = [6, 10, 14, 18]
        
        extended_count = 0
        
        for tip_idx, mid_idx in zip(finger_tips, finger_mids):
            tip = landmarks[tip_idx]
            mid = landmarks[mid_idx]
            pip = landmarks[mid_idx - 1]
            
            if tip.y < mid.y and tip.y < pip.y:
                extended_count += 1
        
        thumb_tip = landmarks[4]
        thumb_ip = landmarks[3]
        wrist = landmarks[0]
        
        thumb_extended = (thumb_tip.x - wrist.x) > (thumb_ip.x - wrist.x) if wrist.x < 0.5 else (thumb_tip.x - wrist.x) < (thumb_ip.x - wrist.x)
        
        if thumb_extended:
            extended_count += 1
        
        return extended_count
    
    def _get_distance(self, p1, p2) -> float:
        """计算两点间的距离"""
        dx = p1.x - p2.x
        dy = p1.y - p2.y
        dz = (p1.z if hasattr(p1, 'z') else 0) - (p2.z if hasattr(p2, 'z') else 0)
        return np.sqrt(dx*dx + dy*dy + dz*dz)
    
    def _reset_state(self):
        """重置手势状态"""
        pass

gesture_detector: Optional[GestureDetector] = None
clients: Dict[str, Any] = {}

@app.route('/health')
def health():
    """健康检查端点"""
    return jsonify({
        'status': 'healthy',
        'gesture_detector_initialized': gesture_detector.initialized if gesture_detector else False
    })

@app.route('/api/detect', methods=['POST'])
def detect_hand():
    """
    REST API: 检测单张图片中的手势
    接收 base64 编码的 JPEG 图片
    """
    try:
        data = request.get_json()
        if not data or 'image' not in data:
            return jsonify({'error': '缺少 image 字段'}), 400

        if gesture_detector is None:
            return jsonify({'error': '检测器未初始化'}), 503

        try:
            image_data = _decode_image_payload(data['image'])
        except ValueError as exc:
            err = str(exc)
            status = 413 if '过大' in err else 400
            return jsonify({'error': err}), status

        result = gesture_detector.process_frame(image_data)

        return jsonify(result)

    except Exception as e:
        logger.error(f"API 处理错误: {e}")
        return jsonify({'error': str(e)}), 500

@socketio.on('connect')
def handle_connect():
    """处理客户端连接"""
    client_id = request.sid
    logger.info(f"客户端连接: {client_id}")
    clients[client_id] = {
        'connected_at': time.time(),
        'frames_processed': 0,
        'last_frame_time': 0
    }
    emit('connected', {
        'client_id': client_id,
        'message': '已连接到手势识别服务器'
    })

@socketio.on('disconnect')
def handle_disconnect():
    """处理客户端断开"""
    client_id = request.sid
    if client_id in clients:
        logger.info(f"客户端断开: {client_id}, 处理了 {clients[client_id]['frames_processed']} 帧")
        del clients[client_id]

@socketio.on('video_frame')
def handle_video_frame(data):
    """
    处理实时视频帧
    期望 data 格式: {
        'image': base64编码的JPEG图片（不带 data:image/jpeg;base64, 前缀）,
        'timestamp': 时间戳（可选）
    }
    """
    client_id = request.sid
    
    try:
        if gesture_detector is None:
            emit('frame_error', {'error': '检测器未初始化'})
            return

        if 'image' not in data:
            emit('frame_error', {'error': '缺少 image 字段'})
            return

        try:
            image_data = _decode_image_payload(data['image'])
        except ValueError as exc:
            emit('frame_error', {'error': str(exc)})
            return

        timestamp = data.get('timestamp', int(time.time() * 1000))

        result = gesture_detector.process_frame(image_data, timestamp)
        
        if client_id in clients:
            clients[client_id]['frames_processed'] += 1
            clients[client_id]['last_frame_time'] = time.time()
        
        if result['success']:
            emit('hand_results', result)
        else:
            emit('frame_error', {'error': result.get('error', '处理失败')})
            
    except Exception as e:
        logger.error(f"处理帧时出错 ({client_id}): {e}")
        emit('frame_error', {'error': str(e)})

@socketio.on('subscribe')
def handle_subscribe(data):
    """订阅特定房间（用于多用户支持）"""
    room = data.get('room', 'default')
    join_room(room)
    logger.info(f"客户端 {request.sid} 加入房间 {room}")
    emit('subscribed', {'room': room})

@socketio.on('unsubscribe')
def handle_unsubscribe(data):
    """取消订阅房间"""
    room = data.get('room', 'default')
    leave_room(room)
    logger.info(f"客户端 {request.sid} 离开房间 {room}")
    emit('unsubscribed', {'room': room})

def initialize_detector():
    """初始化手势检测器"""
    global gesture_detector
    gesture_detector = GestureDetector()

def print_stats():
    """打印服务器统计信息"""
    if clients:
        logger.info(f"当前连接数: {len(clients)}")
        for cid, info in clients.items():
            fps = info['frames_processed'] / (time.time() - info['connected_at']) if info['frames_processed'] > 0 else 0
            logger.info(f"  客户端 {cid}: {info['frames_processed']} 帧, {fps:.1f} FPS")

if __name__ == '__main__':
    logger.info("=" * 60)
    logger.info("黑洞 Web - 服务端手势识别系统")
    logger.info("=" * 60)
    
    logger.info("正在下载 MediaPipe 模型...")
    import urllib.request
    model_url = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'
    model_path = 'hand_landmarker.task'
    if not os.path.exists(model_path):
        try:
            urllib.request.urlretrieve(model_url, model_path)
            logger.info("模型下载完成")
        except Exception as e:
            logger.warning(f"模型下载失败: {e}")
            logger.warning("请手动下载模型或使用 CPU 模式")
    
    logger.info("初始化手势检测器...")
    initialize_detector()
    
    logger.info("=" * 60)
    logger.info("服务器启动成功!")
    logger.info("  - HTTP API: http://0.0.0.0:5000/api/detect")
    logger.info("  - WebSocket: ws://0.0.0.0:5000")
    logger.info("  - 健康检查: http://0.0.0.0:5000/health")
    logger.info("=" * 60)
    
    socketio.run(
        app,
        host='0.0.0.0',
        port=5000,
        debug=False,
        use_reloader=False
    )
