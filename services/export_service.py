"""
记忆导入导出服务 - .loyi 文件格式处理
"""

import json
import os
import zipfile
import io
from datetime import datetime
from typing import Dict, Any
from loguru import logger


class ExportService:
    """导入导出服务类"""

    VERSION = "1.0"

    def __init__(self, memory_service, graph_service):
        self.memory_service = memory_service
        self.graph_service = graph_service

    def export_all(self) -> bytes:
        """
        导出全部记忆为 .loyi 格式（ZIP压缩包）
        Returns:
            ZIP 文件的字节数据
        """
        buffer = io.BytesIO()

        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            # 1. manifest.json
            manifest = self._create_manifest()
            zf.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))

            # 2. 记忆数据
            memories = self.memory_service.get_all_memories()
            for memory in memories:
                memory_id = memory['id']
                zf.writestr(f'memories/{memory_id}.json', json.dumps(memory, ensure_ascii=False, indent=2))

            # 3. 图谱数据
            zf.writestr('graph/nodes.json', json.dumps(self.graph_service.nodes, ensure_ascii=False, indent=2))
            zf.writestr('graph/edges.json', json.dumps(self.graph_service.edges, ensure_ascii=False, indent=2))

            # 4. 附件
            for memory in memories:
                file_path = memory.get('file_path')
                if file_path and os.path.exists(file_path):
                    original_name = os.path.basename(file_path)
                    zf.write(file_path, f'attachments/{memory["id"]}_{original_name}')

        buffer.seek(0)
        return buffer.getvalue()

    def _create_manifest(self) -> Dict[str, Any]:
        """创建导出清单"""
        return {
            'version': self.VERSION,
            'exported_at': datetime.now().isoformat(),
            'memory_count': len(self.memory_service.memories),
            'node_count': len(self.graph_service.nodes),
            'edge_count': len(self.graph_service.edges),
            'app': 'MemoryWeaver'
        }

    def import_from_file(self, file_data: bytes) -> Dict[str, Any]:
        """
        从 .loyi 文件导入
        Returns:
            导入结果统计
        """
        result = {
            'imported_memories': 0,
            'imported_nodes': 0,
            'imported_edges': 0,
            'skipped': 0,
            'errors': []
        }

        buffer = io.BytesIO(file_data)
        with zipfile.ZipFile(buffer, 'r') as zf:
            if 'manifest.json' not in zf.namelist():
                raise ValueError("无效的 .loyi 文件")

            manifest = json.loads(zf.read('manifest.json'))
            logger.info(f"导入 .loyi: {manifest.get('memory_count', 0)} 条记忆")

            existing_ids = set(self.memory_service.memories.keys())

            # 导入记忆
            for name in zf.namelist():
                if name.startswith('memories/') and name.endswith('.json'):
                    try:
                        memory_data = json.loads(zf.read(name))
                        if memory_data.get('id') in existing_ids:
                            result['skipped'] += 1
                            continue
                        self.memory_service.save_memory(memory_data)
                        result['imported_memories'] += 1
                        self._import_attachment(zf, memory_data)
                    except Exception as e:
                        result['errors'].append(f"记忆导入失败: {name}")

            # 导入图谱
            try:
                if 'graph/nodes.json' in zf.namelist():
                    nodes = json.loads(zf.read('graph/nodes.json'))
                    for nid, node in nodes.items():
                        if nid not in self.graph_service.nodes:
                            self.graph_service.nodes[nid] = node
                            result['imported_nodes'] += 1

                if 'graph/edges.json' in zf.namelist():
                    edges = json.loads(zf.read('graph/edges.json'))
                    existing_edge_ids = {e.get('id') for e in self.graph_service.edges}
                    for edge in edges:
                        if edge.get('id') not in existing_edge_ids:
                            self.graph_service.edges.append(edge)
                            result['imported_edges'] += 1

                if result['imported_nodes'] or result['imported_edges']:
                    self.graph_service._save_graph()
            except Exception as e:
                result['errors'].append(f"图谱导入失败: {e}")

        logger.info(f"导入完成: {result}")
        return result

    def _import_attachment(self, zf: zipfile.ZipFile, memory_data: Dict):
        """解压附件"""
        file_path = memory_data.get('file_path')
        if not file_path:
            return
        original_name = os.path.basename(file_path)
        arcname = f'attachments/{memory_data["id"]}_{original_name}'
        if arcname in zf.namelist():
            upload_dir = os.path.join(os.path.dirname(__file__), '..', 'static', 'uploads')
            os.makedirs(upload_dir, exist_ok=True)
            dest = os.path.join(upload_dir, f'{memory_data["id"]}_{original_name}')
            with zf.open(arcname) as src, open(dest, 'wb') as dst:
                dst.write(src.read())
