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
    from .stats import stats_bp
    from .export import export_bp
    from .config import config_bp

    # 注册 Blueprint，使用 url_prefix 保持原有路径
    app.register_blueprint(memory_bp)
    app.register_blueprint(memories_bp)  # /api/memories/* 路由
    app.register_blueprint(graph_bp)
    app.register_blueprint(stats_bp)
    app.register_blueprint(export_bp)
    app.register_blueprint(config_bp)
