"""
增强版知识提取器 - 基于上下文记忆的关系抽取
"""

import json
from typing import Dict, List, Any, Optional
from loguru import logger


class EnhancedKnowledgeExtractor:
    """增强版知识提取器 - 利用上下文记忆丰富关系抽取"""
    
    def __init__(self, llm_service, embedding_service, memory_service):
        self.llm = llm_service
        self.embedding = embedding_service
        self.memory = memory_service
    
    def extract_with_context(
        self, 
        current_memory: Dict[str, Any],
        max_context_memories: int = 3,
        min_similarity: float = 0.6
    ) -> Dict[str, Any]:
        """
        基于上下文记忆的关系抽取
        
        Args:
            current_memory: 当前记忆数据
            max_context_memories: 最多使用多少条相关记忆作为上下文
            min_similarity: 相似度阈值
            
        Returns:
            包含实体和关系的字典
        """
        current_id = current_memory['id']
        content = current_memory.get('content', '')
        understanding = current_memory.get('understanding', {})
        
        # 1. 找到相关记忆（排除自己）
        context_memories = self._find_related_memories(
            current_id, content, max_context_memories, min_similarity
        )
        
        logger.info(f"找到 {len(context_memories)} 条相关记忆作为上下文")
        
        # 2. 构建增强的Prompt
        prompt = self._build_enhanced_prompt(
            current_memory=current_memory,
            context_memories=context_memories
        )
        
        # 3. 调用LLM提取
        try:
            response = self.llm.client.chat.completions.create(
                model=self.llm.model_name,
                messages=[
                    {"role": "system", "content": "你是一个专业的知识图谱抽取专家。请基于当前记忆和相关上下文，抽取尽可能多的实体和关系。关系类型请使用中文。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            result = self._extract_json(content)
            result = json.loads(result)
            
            # 后处理：合并重复实体、补全关系
            result = self._post_process(result)
            
            return result
            
        except Exception as e:
            logger.error(f"增强提取失败: {e}")
            # 降级到基础提取
            return self.llm.extract_knowledge(current_memory)
    
    def _find_related_memories(
        self, 
        current_id: str, 
        query: str, 
        limit: int, 
        threshold: float
    ) -> List[Dict]:
        """找到与当前记忆相关的其他记忆"""
        try:
            # 使用向量搜索
            results = self.embedding.search(query, top_k=limit + 1, similarity_threshold=threshold)
            
            related = []
            for r in results:
                memory_id = r['memory_id']
                if memory_id == current_id:
                    continue
                    
                memory = self.memory.get_memory(memory_id)
                if memory:
                    related.append({
                        'memory': memory,
                        'similarity': r['score']
                    })
                    
                if len(related) >= limit:
                    break
                    
            return related
            
        except Exception as e:
            logger.warning(f"查找相关记忆失败: {e}")
            return []
    
    def _build_enhanced_prompt(
        self, 
        current_memory: Dict,
        context_memories: List[Dict]
    ) -> str:
        """构建增强的Prompt"""
        understanding = current_memory.get('understanding', {})
        content = current_memory.get('content', '')
        
        # 当前记忆的信息
        summary = understanding.get('summary', '')
        description = understanding.get('description', '')
        persons = understanding.get('persons', [])
        locations = understanding.get('locations', [])
        events = understanding.get('events', [])
        
        # 构建上下文信息
        context_text = ""
        if context_memories:
            context_text = "\n## 相关记忆（提供额外上下文）\n"
            for i, ctx in enumerate(context_memories, 1):
                mem = ctx['memory']
                score = ctx['similarity']
                ctx_understanding = mem.get('understanding', {})
                ctx_summary = ctx_understanding.get('summary', mem.get('content', '')[:100])
                
                # 提取已有实体和关系作为提示
                ctx_entities = mem.get('entities', [])
                ctx_relations = mem.get('relations', [])
                
                context_text += f"\n### 相关记忆 {i} (相似度: {score:.2f})\n"
                context_text += f"摘要: {ctx_summary}\n"
                
                if ctx_entities:
                    entity_names = [e.get('name', e.get('id', '')) for e in ctx_entities[:5]]
                    context_text += f"已知实体: {', '.join(entity_names)}\n"
                
                if ctx_relations:
                    context_text += "已知关系:\n"
                    for rel in ctx_relations[:3]:
                        context_text += f"  - {rel.get('source')} --{rel.get('type')}--> {rel.get('target')}\n"
        
        prompt = f"""你是一个专业的知识图谱抽取专家。请基于当前记忆和相关上下文，抽取丰富的知识图谱。

## 当前记忆（主要提取来源）

**原文内容**: {content}

**摘要**: {summary}

**详细描述**: {description}

**已识别实体**:
- 人物：{', '.join(persons) if persons else '无'}
- 地点：{', '.join(locations) if locations else '无'}
- 事件：{', '.join(events) if events else '无'}

{context_text}

## 任务要求

基于以上信息，尽可能多地抽取实体和关系。**不要遗漏任何可能的实体关系**！

### 抽取要求：
1. **实体覆盖**: 必须抽取所有提到的人物、地点、组织、事件、物品、概念和**情感**
   - **情感实体（EMOTION）**: 如果文本描述情绪或感受（如孤独、喜悦、愧疚、怀念、愤怒、释然），必须将每个具体情感抽取为 EMOTION 类型实体
   - 每个人物/事件背后隐含的主要情感都应被抽取
   - 示例："他感到很愧疚" → 必须抽取实体 {id: "kui_jiu", name: "愧疚", type: "EMOTION"}
2. **关系丰富度**: 
   - 每对实体之间尽可能抽取多种关系类型
   - 情感实体必须与引发它的人物、地点或事件建立关系（如"产生"、"感受"、"伴随"）
   - 包括但不限于：时间关系、空间关系、社交关系、因果关系、情感关系
3. **推断关系**: 基于上下文推断隐含关系（如"同学聚会"→推断"同学"关系）
4. **属性完整**: 为每个实体提取尽可能多的属性（年龄、职业、地点等）

### 输出格式（必须是合法JSON）:
```json
{{
    "entities": [
        {{
            "id": "英文ID",
            "name": "原名",
            "type": "PERSON|LOCATION|EVENT|OBJECT|CONCEPT|EMOTION",
            "description": "描述",
            "attributes": {{"职业": "工程师", "年龄": "28", "城市": "北京"}},
            "aliases": ["别名"]
        }},
        {{
            "id": "gu_du",
            "name": "孤独",
            "type": "EMOTION",
            "description": "文本中描述的一种情感状态",
            "attributes": {{}},
            "aliases": []
        }}
    ],
    "relations": [
        {{
            "source": "源实体ID",
            "target": "目标实体ID",
            "type": "关系类型（中文）",
            "description": "描述",
            "fact": "关系陈述",
            "confidence": 0.85,
            "temporal_desc": "关系时间描述"
        }}
    ]
}}
```

### 重要规则：
1. **至少抽取10个实体**（如果内容足够）
2. **至少抽取15条关系**（实体间的关系尽可能全覆盖）
3. 关系 type 必须使用中文
4. 充分利用相关记忆中的已知实体，建立跨记忆的关系链接
5. 同一对实体之间可以有多种不同类型的关系

请尽可能丰富地抽取知识图谱："""
        
        return prompt
    
    def _extract_json(self, text: str) -> str:
        """从文本中提取JSON"""
        import re
        
        # 尝试匹配 ```json ... ```
        json_match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if json_match:
            return json_match.group(1)
        
        # 尝试匹配 ``` ... ```
        json_match = re.search(r'```\s*(.*?)\s*```', text, re.DOTALL)
        if json_match:
            return json_match.group(1)
        
        # 尝试匹配 { ... }
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            return json_match.group(0)
        
        return text
    
    def _post_process(self, result: Dict) -> Dict:
        """后处理：去重、补全"""
        entities = result.get('entities', [])
        relations = result.get('relations', [])
        
        # 去重实体（按ID）
        seen_ids = set()
        unique_entities = []
        for e in entities:
            eid = e.get('id', '').lower()
            if eid and eid not in seen_ids:
                seen_ids.add(eid)
                unique_entities.append(e)
        
        # 去重关系（同source+target+type）
        seen_rels = set()
        unique_relations = []
        for r in relations:
            key = (r.get('source', ''), r.get('target', ''), r.get('type', ''))
            if key not in seen_rels:
                seen_rels.add(key)
                unique_relations.append(r)
        
        # 补全：如果关系引用了不存在的实体，创建占位实体
        existing_ids = {e.get('id', '').lower() for e in unique_entities}
        for r in unique_relations:
            for field in ['source', 'target']:
                eid = r.get(field, '').lower()
                if eid and eid not in existing_ids:
                    # 创建占位实体
                    unique_entities.append({
                        'id': eid,
                        'name': eid.replace('_', ' ').title(),
                        'type': 'CONCEPT',
                        'description': '从关系推断的实体'
                    })
                    existing_ids.add(eid)
        
        return {
            'entities': unique_entities,
            'relations': unique_relations,
            'entity_count': len(unique_entities),
            'relation_count': len(unique_relations)
        }
