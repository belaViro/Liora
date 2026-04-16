"""
MemoryWeaver Blueprints
路由模块化注册中心
"""

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from flask import Flask


def register_blueprints(app: 'Flask') -> None:
    """注册所有 Blueprint 到 Flask 应用

    Args:
        app: Flask 应用实例
    """
    from .memory import memory_bp, memories_bp
    from .graph import graph_bp
    from .config import config_bp
    from .luoyi import luoyi_bp
    from .compute import compute_bp

    # 注册 Blueprint
    app.register_blueprint(memory_bp)
    app.register_blueprint(memories_bp)  # /api/memories/* 路由（仅 ai-quote）
    app.register_blueprint(graph_bp)  # /api/graph/* 路由（仅 explore）
    app.register_blueprint(config_bp)  # /api/config 路由
    app.register_blueprint(luoyi_bp)  # /api/luoyi/* 路由
    app.register_blueprint(compute_bp)  # /api/compute/* 纯计算路由

    # 注：stats 和 export 路由已移除，数据统计和导入导出由前端 IndexedDB 处理
