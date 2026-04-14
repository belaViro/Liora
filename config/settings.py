"""
MemoryWeaver 配置模块
集中管理应用配置常量
"""

import os

# Flask 配置
SECRET_KEY = os.getenv('SECRET_KEY', 'liora-secret-key')

# 上传文件夹
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'static', 'uploads')

# 最大上传大小 (50MB)
MAX_UPLOAD_SIZE = 50 * 1024 * 1024

# Socket.IO CORS
CORS_ALLOWED_ORIGINS = "*"

# 支持的记忆类型
SUPPORTED_MEMORY_TYPES = ['text', 'image', 'audio', 'video']

# LLM 配置
LLM_MODEL_NAME = os.getenv('LLM_MODEL_NAME', 'default')
