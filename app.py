"""
Liora - 个人记忆网络系统
Flask 应用工厂（无状态计算引擎模式）
数据存储在客户端 IndexedDB，服务器仅做纯计算
"""

import os
from flask import Flask
from flask_socketio import SocketIO
from loguru import logger
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# Socket.IO 实例（模块级，供 routes 和 handlers 使用）
socketio = SocketIO(cors_allowed_origins="*")


def create_app():
    """创建并配置 Flask 应用"""
    app = Flask(__name__)

    # 配置
    from config.settings import SECRET_KEY, UPLOAD_FOLDER
    app.config['SECRET_KEY'] = SECRET_KEY
    app.config['TEMPLATES_AUTO_RELOAD'] = True
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0  # 禁用静态文件缓存

    # 确保上传目录存在（仅用于临时文件）
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
    temp_dir = os.path.join(UPLOAD_FOLDER, 'temp')
    os.makedirs(temp_dir, exist_ok=True)

    # 初始化 Socket.IO（挂载到 app 以便在路由中访问）
    app.socketio = socketio

    # ========== 初始化服务（仅保留纯计算服务） ==========
    from services import services
    from services.llm_service import LLMService
    from services.temporal_extractor import TemporalExtractor

    # 注册服务（无状态计算服务）
    services.register('temporal_extractor', TemporalExtractor())
    services.register('llm_service', LLMService())

    # 将 services 挂载到 app 以便通过 current_app 访问
    app.services = services

    # ========== 注册 Blueprints ==========
    from blueprints import register_blueprints
    register_blueprints(app)

    # ========== 初始化 Socket.IO（必须先 init_app 再注册 handlers） ==========
    socketio.init_app(app)

    # ========== 注册 Socket.IO 事件处理器 ==========
    from socket_handlers.events import register_handlers
    register_handlers(socketio)

    # 示例数据路由
    from flask import send_from_directory

    @app.route('/data/<path:filename>')
    def serve_sample_data(filename):
        return send_from_directory(os.path.join(os.path.dirname(__file__), 'data'), filename)

    logger.info("MemoryWeaver 应用已创建（计算引擎模式）")
    return app


# 全局 app 实例（保持向后兼容）
app = create_app()


if __name__ == '__main__':
    logger.info("启动 Liora 服务器...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
