"""
Socket.IO 事件处理函数
"""

from flask_socketio import emit


def register_handlers(socketio):
    """注册 Socket.IO 事件处理器

    Args:
        socketio: Socket.IO 实例
    """

    @socketio.on('connect')
    def handle_connect():
        from loguru import logger
        from flask import request
        logger.info(f"客户端已连接: {request.sid}")
        emit('connected', {'message': '已连接到Liora'})

    @socketio.on('disconnect')
    def handle_disconnect():
        from loguru import logger
        from flask import request
        logger.info(f"客户端已断开: {request.sid}")
