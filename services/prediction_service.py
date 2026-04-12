"""
节点预测服务 - 预测可能的下一个节点
"""

import json
from typing import List, Dict, Any
from loguru import logger


class PredictionService:
    """节点预测服务 - 结合记忆上下文进行智能预测"""
    
    def __init__(self, llm_service, graph_service, memory_service):
        self.llm_service = llm_service
        self.graph_service = graph_service
        self.memory_service = memory_service
    
    def predict_next_nodes(self, node_id: str, max_predictions: int = 3) -> List[Dict[str, Any]]:
        """
        预测从当前节点出发，可能的下一个节点
        
        Args:
            node_id: 当前节点ID
            max_predictions: 最大预测数量
            
        Returns:
            预测节点列表，每个包含 name, type, reason, confidence
        """
        # 获取当前节点信息
        node = self.graph_service.get_entity(node_id)
        if not node:
            return []
        
        # 获取节点的已有关系
        relations = self.graph_service.get_entity_relations(node_id)
        related_nodes = self._get_related_nodes_info(node_id, relations)
        
        # 构建预测提示 - 基于关系推理
        prompt = self._build_prediction_prompt(node, related_nodes)
        
        try:
            # 调用 LLM 预测
            response = self.llm_service.client.chat.completions.create(
                model=self.llm_service.model_name,
                messages=[
                    {"role": "system", "content": "你是知识图谱分析专家。基于现有信息，预测可能的关联节点。返回JSON数组格式。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=800
            )
            
            content = response.choices[0].message.content
            predictions = self._parse_predictions(content)
            
            # 过滤掉已存在的节点
            existing_names = {node['name'].lower()}
            existing_names.update([n['name'].lower() for n in related_nodes])
            
            predictions = [
                p for p in predictions 
                if p['name'].lower() not in existing_names
            ][:max_predictions]
            
            return predictions
            
        except Exception as e:
            logger.error(f"预测节点失败: {e}")
            return []
    
    def _get_related_nodes_info(self, node_id: str, relations: Dict) -> List[Dict]:
        """获取相关节点信息"""
        related = []
        
        for edge in relations.get('outgoing', []):
            target = self.graph_service.get_entity(edge['target'])
            if target:
                related.append({
                    'name': target['name'],
                    'type': target['type'],
                    'relation': edge.get('type', '相关'),
                    'direction': 'out'
                })
        
        for edge in relations.get('incoming', []):
            source = self.graph_service.get_entity(edge['source'])
            if source:
                related.append({
                    'name': source['name'],
                    'type': source['type'],
                    'relation': edge.get('type', '相关'),
                    'direction': 'in'
                })
        
        return related
    
    def _get_related_memories_context(self, node: Dict, max_memories: int = 3, max_chars: int = 800) -> str:
        """
        获取相关记忆的上下文摘要
        
        Args:
            node: 当前节点
            max_memories: 最多取几条记忆
            max_chars: 上下文总长度限制
            
        Returns:
            记忆上下文文本
        """
        memory_ids = node.get('memory_ids', [])
        if not memory_ids:
            return ""
        
        contexts = []
        total_chars = 0
        
        for memory_id in memory_ids[:max_memories]:
            try:
                memory = self.memory_service.get_memory(memory_id)
                if not memory:
                    continue
                
                # 优先使用 understanding 的摘要
                understanding = memory.get('understanding', {})
                content = understanding.get('description', '') or memory.get('content', '')
                
                # 截取适当长度
                if len(content) > 200:
                    content = content[:200] + "..."
                
                # 检查总长度限制
                if total_chars + len(content) > max_chars:
                    remaining = max_chars - total_chars
                    if remaining > 50:
                        content = content[:remaining] + "..."
                    else:
                        break
                
                contexts.append(content)
                total_chars += len(content)
                
            except Exception as e:
                logger.warning(f"获取记忆 {memory_id} 失败: {e}")
                continue
        
        if not contexts:
            return ""
        
        return "\n\n".join(contexts)
    
    def _build_prediction_prompt(self, node: Dict, related_nodes: List[Dict]) -> str:
        """构建预测提示 - 基于关系推理，而非文本挖掘"""
        node_type = node.get('type', 'ENTITY')
        node_name = node.get('name', '未知')
        node_desc = node.get('description', '')
        
        related_text = '\n'.join([
            f"- {r['name']} ({r['type']}) [{r['relation']}]" 
            for r in related_nodes[:10]
        ]) or "暂无已知关联"
        
        prompts = {
            'PERSON': f"""当前节点是一个人物：{node_name}
描述：{node_desc}

已知关系网络：
{related_text}

请基于逻辑推理，预测这个人物**可能还存在但尚未记录**的关联节点。

这是推理任务，不是文本提取。请根据人物关系常识进行推断：
- 如果有"同事"关系，推理：上司、下属、其他部门同事、公司/组织
- 如果有"朋友"关系，推理：共同朋友、朋友的朋友、社交圈子
- 如果有"家庭成员"关系，推理：其他亲属（叔伯、姑姨、堂亲）、配偶的父母
- 如果有"同学"关系，推理：老师、班主任、其他班级同学、学校
- 如果提到工作地点，推理：客户、合作伙伴、竞争对手
- 如果提到兴趣爱好，推理：同好、社团、相关品牌/装备

重要：预测那些**文本中未明确提及但逻辑上很可能存在**的节点。

返回格式（JSON数组）：
[{{"name": "节点名称", "type": "PERSON/LOCATION/EVENT/OBJECT/CONCEPT", "relation": "关系类型", "reason": "推理依据（说明为什么这个节点可能存在）", "confidence": 0.8}}]""",

            'LOCATION': f"""当前节点是一个地点：{node_name}
描述：{node_desc}

已知关系网络：
{related_text}

请基于逻辑推理，预测这个地点**可能还存在但尚未记录**的关联节点。

这是推理任务，不是文本提取。请根据地理和场景常识进行推断：
- 如果是"公司/单位"，推理：周边餐厅、停车场、前台、保安、保洁
- 如果是"家/住所"，推理：物业、邻居、附近的商店/超市、快递点
- 如果是"学校"，推理：校长、教导主任、门卫、食堂、图书馆
- 如果是"城市"，推理：地标建筑、著名景点、交通枢纽、代表性企业
- 如果是"餐厅/咖啡馆"，推理：店长、服务员、熟客、供应商
- 如果是"医院"，推理：医生、护士、挂号处、药房

重要：预测那些**文本中未明确提及但逻辑上很可能存在**的节点。

返回格式（JSON数组）：
[{{"name": "节点名称", "type": "PERSON/LOCATION/EVENT/OBJECT/CONCEPT", "relation": "关系类型", "reason": "推理依据（说明为什么这个节点可能存在）", "confidence": 0.8}}]""",

            'EVENT': f"""当前节点是一个事件：{node_name}
描述：{node_desc}

已知关系网络：
{related_text}

请基于逻辑推理，预测这个事件**可能还存在但尚未记录**的关联节点。

这是推理任务，不是文本提取。请根据事件发展逻辑进行推断：
- 如果是"会议/聚会"，推理：发起人、记录者、未出席但被邀请的人
- 如果是"旅行"，推理：旅行社、导游、酒店前台、遇到的当地人
- 如果是"比赛/考试"，推理：监考/裁判、其他参赛者、赞助商
- 如果是"事故/意外"，推理：目击者、救援人员、保险公司
- 如果是"庆祝/节日"，推理：组织者、表演者、供应商
- 如果有"结果/后果"，推理：受影响的人、后续跟进事件

重要：预测那些**文本中未明确提及但逻辑上很可能存在**的节点。

返回格式（JSON数组）：
[{{"name": "节点名称", "type": "PERSON/LOCATION/EVENT/OBJECT/CONCEPT", "relation": "关系类型", "reason": "推理依据（说明为什么这个节点可能存在）", "confidence": 0.8}}]""",
        }
        
        return prompts.get(node_type, prompts['PERSON'])
    
    def _parse_predictions(self, content: str) -> List[Dict]:
        """解析预测结果"""
        try:
            # 尝试直接解析 JSON
            predictions = json.loads(content)
            if isinstance(predictions, list):
                return predictions
            elif isinstance(predictions, dict) and 'predictions' in predictions:
                return predictions['predictions']
        except json.JSONDecodeError:
            pass
        
        # 尝试从代码块中提取
        import re
        json_match = re.search(r'```json\s*(.*?)\s*```', content, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except:
                pass
        
        # 尝试匹配方括号内容
        bracket_match = re.search(r'\[.*\]', content, re.DOTALL)
        if bracket_match:
            try:
                return json.loads(bracket_match.group(0))
            except:
                pass
        
        return []
