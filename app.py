"""
Liora - 个人记忆网络系统
Flask 应用工厂
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

    # 确保上传目录存在
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

    # 初始化 Socket.IO（挂载到 app 以便在路由中访问）
    app.socketio = socketio

    # ========== 初始化服务 ==========
    from services import services
    from services.llm_service import LLMService
    from services.memory_service import MemoryService
    from services.graph_service import GraphService
    from services.embedding_service import EmbeddingService
    from services.temporal_extractor import TemporalExtractor
    from services.enhanced_knowledge_extractor import EnhancedKnowledgeExtractor
    from services.prediction_service import PredictionService
    from services.export_service import ExportService

    # 注册服务
    services.register('temporal_extractor', TemporalExtractor())
    services.register('llm_service', LLMService())
    services.register('memory_service', MemoryService())
    services.register('graph_service', GraphService())
    services.register('embedding_service', EmbeddingService())

    # 增强知识提取器（需要依赖其他服务）
    services.register('enhanced_extractor', EnhancedKnowledgeExtractor(
        llm_service=services.llm_service,
        embedding_service=services.embedding_service,
        memory_service=services.memory_service
    ))

    # 预测服务
    services.register('prediction_service', PredictionService(
        llm_service=services.llm_service,
        graph_service=services.graph_service,
        memory_service=services.memory_service
    ))

    # 导入导出服务
    services.register('export_service', ExportService(
        memory_service=services.memory_service,
        graph_service=services.graph_service
    ))

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

    logger.info("MemoryWeaver 应用已创建")
    return app


# 全局 app 实例（保持向后兼容）
app = create_app()


if __name__ == '__main__':
    logger.info("启动 Liora 服务器...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, allow_unsafe_werkzeug=True)
