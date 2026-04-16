# Liora Services

from typing import Any, Optional


class ServiceRegistry:
    """服务注册中心 - 提供应用服务的集中访问

    使用 Flask 的 current_app 实现延迟访问，解决循环依赖问题。

    用法:
        # app.py 中初始化
        from services import services
        services.register('llm_service', LLMService())
        app.services = services

        # 路由中访问
        from flask import current_app
        llm_service = current_app.services.llm_service
    """

    def __init__(self):
        self._services = {}

    def register(self, name: str, service: Any) -> None:
        """注册服务实例"""
        self._services[name] = service

    def get(self, name: str) -> Optional[Any]:
        """按名称获取服务"""
        return self._services.get(name)

    @property
    def llm_service(self):
        return self._services.get('llm_service')

    @property
    def temporal_extractor(self):
        return self._services.get('temporal_extractor')


# 全局服务注册表实例
services = ServiceRegistry()
