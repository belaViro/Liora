"""
知识图谱服务 - 管理实体关系图谱
"""

import json
import os
import re
import difflib
import uuid
from datetime import datetime
from typing import Dict, List, Any, Optional
from loguru import logger


class GraphService:
    """知识图谱服务类"""
    
    def __init__(self):
        self.data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        os.makedirs(self.data_dir, exist_ok=True)
        
        self.graph_file = os.path.join(self.data_dir, 'graph.json')
        self.nodes = {}  # 实体节点
        self.edges = []  # 关系边
        
        self._load_graph()
        logger.info(f"图谱服务初始化完成，已加载 {len(self.nodes)} 个实体，{len(self.edges)} 条关系")
    
    def _load_graph(self):
        """加载图谱数据"""
        if os.path.exists(self.graph_file):
            try:
                with open(self.graph_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.nodes = data.get('nodes', {})
                    self.edges = data.get('edges', [])
            except Exception as e:
                logger.error(f"加载图谱失败: {e}")
                self.nodes = {}
                self.edges = []
    
    def _save_graph(self):
        """保存图谱数据"""
        try:
            with open(self.graph_file, 'w', encoding='utf-8') as f:
                json.dump({
                    'nodes': self.nodes,
                    'edges': self.edges
                }, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存图谱失败: {e}")
    
    def _find_similar_entity(self, entity_name: str, entity_type: str) -> Optional[str]:
        """
        查找相似名称的已有实体（实体链接）
        
        Args:
            entity_name: 实体名称
            entity_type: 实体类型
            
        Returns:
            匹配到的实体ID，如果没有则返回None
        """
        import difflib
        
        entity_name_lower = entity_name.lower().strip()
        
        for existing_id, existing_node in self.nodes.items():
            # 类型必须相同
            if existing_node.get('type') != entity_type:
                continue
            
            existing_name = existing_node.get('name', '').lower().strip()
            
            # 1. 完全匹配
            if existing_name == entity_name_lower:
                return existing_id
            
            # 2. 包含关系（如"刘振"和"刘振的母亲"）
            if entity_name_lower in existing_name or existing_name in entity_name_lower:
                # 较长的作为标准名称
                if len(existing_name) >= len(entity_name_lower):
                    return existing_id
            
            # 3. 编辑距离相似度（模糊匹配）
            similarity = difflib.SequenceMatcher(None, entity_name_lower, existing_name).ratio()
            if similarity >= 0.8:  # 80%相似度阈值
                logger.info(f"实体链接: '{entity_name}' -> '{existing_node['name']}' (相似度: {similarity:.2f})")
                return existing_id
            
            # 4. 检查别名
            aliases = existing_node.get('aliases', [])
            for alias in aliases:
                alias_lower = alias.lower().strip()
                if alias_lower == entity_name_lower:
                    return existing_id
                if difflib.SequenceMatcher(None, entity_name_lower, alias_lower).ratio() >= 0.85:
                    return existing_id
        
        return None

    def _normalize_entity_id(self, name: str) -> str:
        """生成标准化的实体ID"""
        import re
        import hashlib
        # 处理中文：保留中文、英文、数字，移除特殊字符
        # 使用 Unicode 属性来匹配字母和数字（包括中文）
        normalized = re.sub(r'[^\w\s\u4e00-\u9fff]', '', name.lower())
        normalized = re.sub(r'\s+', '_', normalized.strip())
        
        # 如果处理后为空（全是特殊字符），使用哈希值
        if not normalized:
            normalized = hashlib.md5(name.encode()).hexdigest()[:8]
        
        return normalized

    def update_graph(self, entities: List[Dict], relations: List[Dict], memory_id: str, 
                     memory_summary: str = '', temporal_info: Optional[Dict] = None):
        """
        更新图谱（添加新记忆时调用）

        Args:
            entities: 实体列表
            relations: 关系列表
            memory_id: 关联的记忆ID
            memory_summary: 记忆内容摘要（用于边详情展示）
            temporal_info: 记忆的时间信息
        """
        current_time = datetime.now().isoformat()
        
        # 实体ID映射（用于处理关系中的ID映射）
        entity_id_mapping = {}
        
        # 添加实体节点
        for entity in entities:
            entity_id = entity['id']
            entity_name = entity['name']
            entity_type = entity['type']
            
            # 1. 首先检查是否有相似名称的已有实体（实体链接）
            similar_id = self._find_similar_entity(entity_name, entity_type)
            
            if similar_id:
                # 找到相似实体，合并信息
                entity_id_mapping[entity_id] = similar_id
                entity_id = similar_id  # 使用已有实体的ID
                
                # 更新已有实体信息
                if memory_id not in self.nodes[entity_id]['memory_ids']:
                    self.nodes[entity_id]['memory_ids'].append(memory_id)
                
                # 合并属性
                if 'attributes' in entity and entity['attributes']:
                    existing_attrs = self.nodes[entity_id].get('attributes', {})
                    existing_attrs.update(entity['attributes'])
                    self.nodes[entity_id]['attributes'] = existing_attrs
                
                # 合并别名
                if 'aliases' in entity and entity['aliases']:
                    existing_aliases = set(self.nodes[entity_id].get('aliases', []))
                    existing_aliases.update(entity['aliases'])
                    existing_aliases.add(entity_name)  # 将新名称也作为别名
                    self.nodes[entity_id]['aliases'] = list(existing_aliases)
                
                # 更新描述（如果新的更详细）
                new_desc = entity.get('description', '')
                old_desc = self.nodes[entity_id].get('description', '')
                if len(new_desc) > len(old_desc):
                    self.nodes[entity_id]['description'] = new_desc
                
                self.nodes[entity_id]['updated_at'] = current_time
                logger.info(f"实体合并: '{entity_name}' -> 已有实体 '{self.nodes[entity_id]['name']}'")
                
            elif entity_id not in self.nodes:
                # 新实体 - 标准化ID
                normalized_id = self._normalize_entity_id(entity_name)
                
                # 如果标准化ID已存在，添加随机后缀
                if normalized_id in self.nodes:
                    normalized_id = f"{normalized_id}_{uuid.uuid4().hex[:4]}"
                
                entity_id_mapping[entity_id] = normalized_id
                entity_id = normalized_id
                
                self.nodes[entity_id] = {
                    'id': entity_id,
                    'name': entity_name,
                    'type': entity_type,
                    'description': entity.get('description', ''),
                    'attributes': entity.get('attributes', {}),
                    'aliases': entity.get('aliases', []),
                    'memory_ids': [memory_id],
                    'created_at': current_time,
                    'updated_at': current_time,
                    'relation_count': 0
                }
            else:
                # ID已存在但名称不同（可能是ID冲突），更新映射
                entity_id_mapping[entity_id] = entity_id
                if memory_id not in self.nodes[entity_id]['memory_ids']:
                    self.nodes[entity_id]['memory_ids'].append(memory_id)
        
        # 添加关系边
        for relation in relations:
            # 使用映射后的实体ID
            source_id = entity_id_mapping.get(relation['source'], relation['source'])
            target_id = entity_id_mapping.get(relation['target'], relation['target'])
            
            # 确保源和目标节点存在
            if source_id not in self.nodes or target_id not in self.nodes:
                logger.warning(f"关系中的实体不存在: {source_id} -> {target_id}")
                continue
            
            # 检查是否已存在相同关系（同类型、同方向）
            exists = False
            for edge in self.edges:
                if (edge['source'] == source_id and 
                    edge['target'] == target_id and 
                    edge['type'] == relation['type']):
                    # 更新现有关系
                    if memory_id not in edge['memory_ids']:
                        edge['memory_ids'].append(memory_id)
                        edge['strength'] = min(1.0, edge.get('strength', 0.5) + 0.1)
                    # 更新 fact（如果有新的描述）
                    if relation.get('fact'):
                        edge['fact'] = relation['fact']
                    exists = True
                    break
            
            if not exists:
                # 构建时间信息（从记忆继承 + 关系特定时间）
                edge_temporal = {
                    'memory_time': temporal_info if temporal_info else {'type': 'unknown'},
                    'relation_time': {                                         # 关系特定时间（如"2010-2014"）
                        'start': relation.get('temporal_start'),               # 关系开始
                        'end': relation.get('temporal_end'),                   # 关系结束
                        'description': relation.get('temporal_desc', '')       # 自然语言描述
                    }
                }
                
                # 创建新关系 - 使用增强的数据结构
                self.edges.append({
                    'id': f"{source_id}_{relation['type']}_{target_id}_{uuid.uuid4().hex[:8]}",  # 唯一ID
                    'source': source_id,
                    'target': target_id,
                    'type': relation['type'],
                    'directed': False,                                           # 默认为无向关系
                    'description': relation.get('description', ''),
                    'fact': relation.get('fact', ''),                           # 关系陈述（核心字段）
                    'episodes': [{                                              # 来源片段
                        'memory_id': memory_id,
                        'snippet': memory_summary[:200] if memory_summary else '',  # 文本片段
                        'timestamp': current_time
                    }],
                    'memory_ids': [memory_id],
                    'memory_summaries': [memory_summary] if memory_summary else [],
                    'temporal_info': edge_temporal,                             # 时间信息（新）
                    'strength': 0.5,
                    'created_at': current_time,
                    'confidence': relation.get('confidence', 0.8)               # 提取置信度
                })
                
                # 更新节点关系计数
                self.nodes[source_id]['relation_count'] = self.nodes[source_id].get('relation_count', 0) + 1
                self.nodes[target_id]['relation_count'] = self.nodes[target_id].get('relation_count', 0) + 1
        
        self._save_graph()
        logger.info(f"图谱已更新，新增 {len(entities)} 个实体，{len(relations)} 条关系")
    
    def get_graph_data(self, entity_types: Optional[List[str]] = None, 
                       center_entity: Optional[str] = None,
                       max_nodes: int = 100) -> Dict[str, Any]:
        """
        获取图谱数据（用于可视化）
        
        Args:
            entity_types: 实体类型过滤
            center_entity: 中心实体（以此为中心展开）
            max_nodes: 最大节点数
            
        Returns:
            图谱数据，包含nodes和edges
        """
        # 过滤节点
        filtered_nodes = {}
        
        if center_entity and center_entity in self.nodes:
            # 以某个实体为中心，获取关联节点
            related_ids = {center_entity}
            
            for edge in self.edges:
                if edge['source'] == center_entity:
                    related_ids.add(edge['target'])
                elif edge['target'] == center_entity:
                    related_ids.add(edge['source'])
            
            for nid in related_ids:
                if nid in self.nodes:
                    if entity_types is None or self.nodes[nid]['type'] in entity_types:
                        filtered_nodes[nid] = self.nodes[nid]
        else:
            # 返回所有节点（或按类型过滤）
            for nid, node in self.nodes.items():
                if entity_types is None or node['type'] in entity_types:
                    filtered_nodes[nid] = node
        
        # 限制节点数量（max_nodes=0 表示不限制）
        if max_nodes > 0 and len(filtered_nodes) > max_nodes:
            # 按关系数量排序，保留最重要的节点
            sorted_nodes = sorted(
                filtered_nodes.items(),
                key=lambda x: x[1].get('relation_count', 0),
                reverse=True
            )
            filtered_nodes = dict(sorted_nodes[:max_nodes])
        
        # 过滤边（只保留两端都在筛选后节点中的边）
        filtered_edges = []
        for edge in self.edges:
            if edge['source'] in filtered_nodes and edge['target'] in filtered_nodes:
                filtered_edges.append(edge)
        
        return {
            'nodes': list(filtered_nodes.values()),
            'edges': filtered_edges,
            'total_nodes': len(self.nodes),
            'total_edges': len(self.edges),
            'filtered_nodes': len(filtered_nodes),
            'filtered_edges': len(filtered_edges)
        }
    
    def get_entity(self, entity_id: str) -> Optional[Dict]:
        """
        获取实体详情
        
        Args:
            entity_id: 实体ID
            
        Returns:
            实体数据
        """
        return self.nodes.get(entity_id)
    
    def get_entity_relations(self, entity_id: str) -> Dict[str, List[Dict]]:
        """
        获取实体的所有关系
        
        Args:
            entity_id: 实体ID
            
        Returns:
            入边和出边
        """
        incoming = []
        outgoing = []
        
        for edge in self.edges:
            if edge['source'] == entity_id:
                outgoing.append(edge)
            elif edge['target'] == entity_id:
                incoming.append(edge)
        
        return {
            'incoming': incoming,
            'outgoing': outgoing
        }
    
    def remove_memory(self, memory_id: str):
        """
        删除记忆时更新图谱
        
        Args:
            memory_id: 记忆ID
        """
        # 从节点中移除记忆引用
        nodes_to_remove = []
        for node_id, node in self.nodes.items():
            if memory_id in node.get('memory_ids', []):
                node['memory_ids'].remove(memory_id)
                # 如果没有其他记忆引用，标记为删除
                if not node['memory_ids']:
                    nodes_to_remove.append(node_id)
        
        # 删除孤立节点
        for node_id in nodes_to_remove:
            del self.nodes[node_id]
        
        # 删除相关边
        self.edges = [
            edge for edge in self.edges 
            if memory_id not in edge.get('memory_ids', []) or len(edge.get('memory_ids', [])) > 1
        ]
        
        # 清理只包含已删除节点的边
        self.edges = [
            edge for edge in self.edges
            if edge['source'] in self.nodes and edge['target'] in self.nodes
        ]
        
        self._save_graph()
        logger.info(f"已移除记忆 {memory_id} 相关的图谱数据")
    
    def search_entities(self, keyword: str, entity_type: Optional[str] = None) -> List[Dict]:
        """
        搜索实体
        
        Args:
            keyword: 关键词
            entity_type: 实体类型过滤
            
        Returns:
            匹配的实体列表
        """
        results = []
        keyword_lower = keyword.lower()
        
        for node_id, node in self.nodes.items():
            # 类型过滤
            if entity_type and node['type'] != entity_type:
                continue
            
            # 名称匹配
            if keyword_lower in node['name'].lower():
                results.append(node)
            # 描述匹配
            elif keyword_lower in node.get('description', '').lower():
                results.append(node)
        
        return results
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        获取图谱统计信息
        
        Returns:
            统计数据
        """
        type_counts = {}
        for node in self.nodes.values():
            t = node['type']
            type_counts[t] = type_counts.get(t, 0) + 1
        
        relation_type_counts = {}
        for edge in self.edges:
            t = edge['type']
            relation_type_counts[t] = relation_type_counts.get(t, 0) + 1
        
        return {
            'total_nodes': len(self.nodes),
            'total_edges': len(self.edges),
            'node_types': type_counts,
            'edge_types': relation_type_counts,
            'average_degree': len(self.edges) * 2 / len(self.nodes) if self.nodes else 0
        }
    
    def update_node(self, node_id: str, updates: Dict[str, Any]) -> bool:
        """
        更新实体信息（限制编辑）
        
        Args:
            node_id: 实体ID
            updates: 更新字段（只允许 name, type, description, attributes）
            
        Returns:
            是否成功
        """
        if node_id not in self.nodes:
            return False
        
        node = self.nodes[node_id]
        
        # 只允许修改特定字段
        allowed_fields = ['name', 'type', 'description', 'attributes']
        for field in allowed_fields:
            if field in updates:
                node[field] = updates[field]
        
        node['updated_at'] = datetime.now().isoformat()
        self._save_graph()
        logger.info(f"实体已更新: {node_id}")
        return True
    
    def update_edge(self, edge_id: str, updates: Dict[str, Any]) -> bool:
        """
        更新关系边信息
        
        Args:
            edge_id: 边索引（或 UUID）
            updates: 更新字段（只允许 type, description）
            
        Returns:
            是否成功
        """
        for edge in self.edges:
            edge_id_in_list = edge.get('id') or edge.get('uuid')
            if edge_id_in_list == edge_id:
                allowed_fields = ['type', 'description', 'fact']
                for field in allowed_fields:
                    if field in updates:
                        edge[field] = updates[field]
                edge['updated_at'] = datetime.now().isoformat()
                self._save_graph()
                logger.info(f"关系边已更新: {edge_id}")
                return True
        return False
    
    def delete_edge(self, edge_id: str) -> bool:
        """
        删除关系边
        
        Args:
            edge_id: 边ID
            
        Returns:
            是否成功
        """
        initial_count = len(self.edges)
        
        # 找到要删除的边，更新节点的关系计数
        edge_to_remove = None
        for edge in self.edges:
            if (edge.get('id') or edge.get('uuid')) == edge_id:
                edge_to_remove = edge
                break
        
        if edge_to_remove:
            source_id = edge_to_remove.get('source')
            target_id = edge_to_remove.get('target')
            
            # 更新节点关系计数
            if source_id in self.nodes:
                self.nodes[source_id]['relation_count'] = max(0, self.nodes[source_id].get('relation_count', 0) - 1)
            if target_id in self.nodes:
                self.nodes[target_id]['relation_count'] = max(0, self.nodes[target_id].get('relation_count', 0) - 1)
        
        self.edges = [e for e in self.edges if (e.get('id') or e.get('uuid')) != edge_id]
        
        if len(self.edges) < initial_count:
            self._save_graph()
            logger.info(f"关系边已删除: {edge_id}")
            return True
        return False
    
    def delete_node(self, node_id: str) -> bool:
        """
        删除实体节点（同时删除所有相关边）
        
        Args:
            node_id: 节点ID
            
        Returns:
            是否成功
        """
        if node_id not in self.nodes:
            return False
        
        # 删除节点
        del self.nodes[node_id]
        
        # 删除所有与该节点相关的边
        initial_edge_count = len(self.edges)
        self.edges = [e for e in self.edges if e.get('source') != node_id and e.get('target') != node_id]
        
        self._save_graph()
        logger.info(f"实体节点已删除: {node_id}, 同时删除 {initial_edge_count - len(self.edges)} 条关系边")
        return True
    
    def merge_nodes(self, keep_id: str, remove_id: str) -> bool:
        """
        合并两个重复实体
        
        Args:
            keep_id: 保留的实体ID
            remove_id: 删除的实体ID
            
        Returns:
            是否成功
        """
        if keep_id not in self.nodes or remove_id not in self.nodes:
            return False
        
        if keep_id == remove_id:
            return False
        
        keep_node = self.nodes[keep_id]
        remove_node = self.nodes[remove_id]
        
        # 合并记忆关联（去重）
        keep_memories = set(keep_node.get('memory_ids', []))
        remove_memories = set(remove_node.get('memory_ids', []))
        merged_memories = list(keep_memories | remove_memories)
        keep_node['memory_ids'] = merged_memories
        
        # 更新所有关系边
        for edge in self.edges:
            if edge.get('source') == remove_id:
                edge['source'] = keep_id
            if edge.get('target') == remove_id:
                edge['target'] = keep_id
        
        # 删除重复实体
        del self.nodes[remove_id]
        
        # 去除可能产生的自环和重复边
        seen_edges = set()
        unique_edges = []
        for edge in self.edges:
            src = edge.get('source')
            tgt = edge.get('target')
            edge_type = edge.get('type', '')
            
            # 跳过自环（除非原本就是自环）
            if src == tgt and src != keep_id:
                continue
                
            # 去重
            edge_key = (src, tgt, edge_type)
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                unique_edges.append(edge)
        
        self.edges = unique_edges
        
        keep_node['updated_at'] = datetime.now().isoformat()
        self._save_graph()
        logger.info(f"实体已合并: {remove_id} → {keep_id}")
        return True
