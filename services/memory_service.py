"""
记忆服务 - 记忆的存储、检索和管理
"""

import json
import os
from typing import Dict, List, Any, Optional
from datetime import datetime
from loguru import logger


class MemoryService:
    """记忆服务类"""
    
    def __init__(self):
        self.data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        os.makedirs(self.data_dir, exist_ok=True)
        
        self.memories_file = os.path.join(self.data_dir, 'memories.json')
        self.memories = self._load_memories()
        
        logger.info(f"记忆服务初始化完成，已加载 {len(self.memories)} 条记忆")
    
    def _load_memories(self) -> Dict[str, Dict]:
        """加载记忆数据"""
        if os.path.exists(self.memories_file):
            try:
                with open(self.memories_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"加载记忆失败: {e}")
                return {}
        return {}
    
    def _save_memories(self):
        """保存记忆数据"""
        try:
            with open(self.memories_file, 'w', encoding='utf-8') as f:
                json.dump(self.memories, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"保存记忆失败: {e}")
    
    def save_memory(self, memory_data: Dict[str, Any]):
        """
        保存记忆
        
        Args:
            memory_data: 记忆数据
        """
        memory_id = memory_data['id']
        self.memories[memory_id] = memory_data
        self._save_memories()
        logger.info(f"记忆已保存: {memory_id}")
    
    def get_memory(self, memory_id: str) -> Optional[Dict]:
        """
        获取单个记忆
        
        Args:
            memory_id: 记忆ID
            
        Returns:
            记忆数据或None
        """
        return self.memories.get(memory_id)
    
    def delete_memory(self, memory_id: str):
        """
        删除记忆
        
        Args:
            memory_id: 记忆ID
        """
        if memory_id in self.memories:
            # 删除关联的文件
            file_path = self.memories[memory_id].get('file_path')
            if file_path and os.path.exists(file_path):
                try:
                    os.remove(file_path)
                except Exception as e:
                    logger.warning(f"删除文件失败: {e}")
            
            del self.memories[memory_id]
            self._save_memories()
            logger.info(f"记忆已删除: {memory_id}")
    
    def search(self, query: str, intent: Dict, limit: int = 10) -> List[Dict]:
        """
        搜索记忆（增强版关键词搜索）

        Args:
            query: 查询字符串
            intent: 查询意图
            limit: 返回数量限制

        Returns:
            匹配的记忆列表
        """
        import re

        results = []
        keywords = intent.get('keywords', [])
        # 添加查询本身作为关键词
        if query and query not in keywords:
            keywords.insert(0, query)

        entities = intent.get('entities', [])
        time_range = intent.get('time_range', {})
        emotion_filter = intent.get('emotion_filter', 'any')

        # 分词处理查询
        query_words = self._tokenize(query.lower())

        for memory_id, memory in self.memories.items():
            score = 0

            # 收集所有可搜索文本
            content = memory.get('content', '')
            understanding = memory.get('understanding', {})
            description = understanding.get('description', '')
            summary = understanding.get('summary', '')
            memory_keywords = understanding.get('keywords', [])
            memory_persons = understanding.get('persons', [])
            memory_locations = understanding.get('locations', [])
            memory_events = understanding.get('events', [])

            text_to_search = f"{content} {description} {summary}".lower()
            text_words = set(self._tokenize(text_to_search))

            # 1. 完整查询匹配（最高权重）
            if query.lower() in text_to_search:
                score += 5

            # 2. 关键词匹配
            for keyword in keywords:
                keyword_lower = keyword.lower()
                if keyword_lower in text_to_search:
                    # 完整词匹配比部分匹配权重更高
                    if keyword_lower in text_words or f' {keyword_lower} ' in text_to_search:
                        score += 2
                    else:
                        score += 1

            # 3. 分词匹配（模糊匹配）
            matched_words = 0
            for word in query_words:
                if len(word) > 1 and word in text_words:  # 只匹配长度>1的词
                    matched_words += 1
            score += matched_words * 0.5  # 每个匹配词加0.5分

            # 4. 实体匹配（高权重）
            memory_entities = memory.get('entities', [])
            for entity in memory_entities:
                entity_name = entity.get('name', '')
                if entity_name in entities:
                    score += 4  # 查询中提到的实体
                # 检查实体名是否在查询中
                if entity_name.lower() in query.lower():
                    score += 3

            # 5. 关键词列表匹配
            for kw in memory_keywords:
                if kw.lower() in query.lower():
                    score += 2

            # 6. 人物、地点、事件匹配
            for person in memory_persons:
                if person.lower() in query.lower():
                    score += 2
            for location in memory_locations:
                if location.lower() in query.lower():
                    score += 2
            for event in memory_events:
                if event.lower() in query.lower():
                    score += 2

            # 情感过滤
            if emotion_filter != 'any':
                emotion = memory.get('emotion', {})
                valence = emotion.get('valence', 0)

                if emotion_filter == 'positive' and valence <= 0:
                    continue
                if emotion_filter == 'negative' and valence >= 0:
                    continue

            if score > 0:
                results.append({
                    'memory': memory,
                    'score': score
                })

        # 按分数排序
        results.sort(key=lambda x: x['score'], reverse=True)

        # 返回前limit个
        return [r['memory'] for r in results[:limit]]

    def _tokenize(self, text: str) -> List[str]:
        """
        简单中文分词（按非字符分割）

        Args:
            text: 输入文本

        Returns:
            分词结果列表
        """
        import re
        # 保留中文字符、英文单词、数字
        words = re.findall(r'[\u4e00-\u9fa5]+|[a-zA-Z]+|\d+', text.lower())
        return words
    
    def get_memories_by_entity(self, entity_id: str) -> List[Dict]:
        """
        获取与实体相关的所有记忆
        
        Args:
            entity_id: 实体ID
            
        Returns:
            记忆列表
        """
        results = []
        
        for memory in self.memories.values():
            entities = memory.get('entities', [])
            for entity in entities:
                if entity['id'] == entity_id:
                    results.append(memory)
                    break
        
        return results
    
    def get_timeline(self, start_date: Optional[str] = None, end_date: Optional[str] = None) -> List[Dict]:
        """
        获取时间线数据
        
        Args:
            start_date: 开始日期（ISO格式）
            end_date: 结束日期（ISO格式）
            
        Returns:
            按时间排序的记忆列表
        """
        memories_list = list(self.memories.values())
        
        # 按时间过滤
        if start_date or end_date:
            filtered = []
            for memory in memories_list:
                created_at = memory.get('created_at', '')
                if start_date and created_at < start_date:
                    continue
                if end_date and created_at > end_date:
                    continue
                filtered.append(memory)
            memories_list = filtered
        
        # 按时间排序
        memories_list.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        return memories_list
    
    def get_all_memories(self) -> List[Dict]:
        """
        获取所有记忆
        
        Returns:
            记忆列表
        """
        return list(self.memories.values())
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        获取记忆统计信息
        
        Returns:
            统计数据
        """
        total = len(self.memories)
        
        type_counts = {}
        for memory in self.memories.values():
            mtype = memory.get('type', 'unknown')
            type_counts[mtype] = type_counts.get(mtype, 0) + 1
        
        # 获取所有实体
        all_entities = []
        for memory in self.memories.values():
            all_entities.extend(memory.get('entities', []))
        
        entity_counts = {}
        for entity in all_entities:
            entity_type = entity.get('type', 'unknown')
            entity_counts[entity_type] = entity_counts.get(entity_type, 0) + 1
        
        return {
            'total_memories': total,
            'type_distribution': type_counts,
            'entity_distribution': entity_counts,
            'total_entities': len(set(e['id'] for e in all_entities))
        }
