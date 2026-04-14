"""
图谱路由 Blueprint
包含知识图谱的获取、探索、节点/边管理、预测等功能
"""

import uuid
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app

graph_bp = Blueprint('graph', __name__, url_prefix='/api/graph')


@graph_bp.route('/data', methods=['GET'])
def get_graph_data():
    """获取知识图谱数据（用于可视化）"""
    try:
        graph_service = current_app.services.graph_service

        # 支持按实体类型过滤
        entity_types = request.args.get('types', '').split(',')
        entity_types = [t.strip() for t in entity_types if t.strip()]

        # 支持搜索特定实体
        search_entity = request.args.get('entity', '').strip()

        # 默认返回所有节点（max_nodes=0 表示不限制）
        max_nodes = request.args.get('max_nodes', '0')
        try:
            max_nodes = int(max_nodes)
        except Exception:
            max_nodes = 0

        graph_data = graph_service.get_graph_data(
            entity_types=entity_types or None,
            center_entity=search_entity or None,
            max_nodes=max_nodes
        )

        return jsonify({
            'success': True,
            'data': graph_data
        })

    except Exception as e:
        import logging
        logging.exception(f"获取图谱数据失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@graph_bp.route('/entity/<entity_id>', methods=['GET'])
def get_entity_details(entity_id):
    """获取实体详细信息"""
    try:
        graph_service = current_app.services.graph_service
        memory_service = current_app.services.memory_service

        entity = graph_service.get_entity(entity_id)
        related_memories = memory_service.get_memories_by_entity(entity_id)

        return jsonify({
            'success': True,
            'entity': entity,
            'related_memories': related_memories
        })

    except Exception as e:
        import logging
        logging.exception(f"获取实体详情失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@graph_bp.route('/explore', methods=['POST'])
def explore_node():
    """节点探索问答 - 基于节点上下文回答用户问题"""
    try:
        llm_service = current_app.services.llm_service

        data = request.json
        question = data.get('question', '')
        node_data = data.get('node', {})
        edge_data = data.get('edge', {})
        chat_history = data.get('history', [])
        persona_mode = data.get('persona_mode', False)
        persona_node_name = data.get('persona_node_name', '')

        if not question:
            return jsonify({'success': False, 'error': '问题不能为空'}), 400

        # 构建上下文
        context_parts = []

        if node_data:
            context_parts.append(f"节点名称: {node_data.get('name', '未知')}")
            context_parts.append(f"节点类型: {node_data.get('type', 'Entity')}")
            if node_data.get('description'):
                context_parts.append(f"节点描述: {node_data.get('description')}")
            if node_data.get('aliases'):
                context_parts.append(f"别名: {', '.join(node_data.get('aliases', []))}")
            if node_data.get('attributes'):
                attrs = node_data.get('attributes', {})
                attr_str = ', '.join([f"{k}={v}" for k, v in attrs.items()])
                context_parts.append(f"属性: {attr_str}")

        elif edge_data:
            if edge_data.get('isSelfLoopGroup'):
                context_parts.append(f"自环节点: {edge_data.get('source_name', '未知')}")
                context_parts.append(f"自环数量: {edge_data.get('selfLoopCount', 0)}")
            else:
                context_parts.append(f"源节点: {edge_data.get('source_name', '未知')}")
                context_parts.append(f"关系: {edge_data.get('name', 'RELATED_TO')}")
                context_parts.append(f"目标节点: {edge_data.get('target_name', '未知')}")
            if edge_data.get('fact'):
                context_parts.append(f"关系陈述: {edge_data.get('fact')}")
            if edge_data.get('description'):
                context_parts.append(f"关系描述: {edge_data.get('description')}")

        context = '\n'.join(context_parts)

        # 构建系统提示词
        if persona_mode and persona_node_name:
            system_prompt = f"""你扮演「{persona_node_name}」这个人物。现在你要以第一人称的视角，
                基于用户记忆网络中的内容来回忆和回答问题。
                回答风格：
                - 第一人称"我"来叙述
                - 自然、简洁，像在和人聊天，不要啰嗦
                - 用中文回答
                - 回答尽量简短，100字以内
                """
        else:
            system_prompt = """你是 Liora 记忆网络的智能助手。Liora 是一个个人记忆管理系统，用户存储的所有内容都是 TA 的记忆。

            当前情境：
            - 用户正在查看自己记忆网络中的一个节点/关系
            - 节点包含的内容来自用户过往录入的记忆（文字、图片、音频等）
            - 你的任务是帮助用户回顾、整理和探索自己的记忆

            回答原则：
            1. 当用户问"这是谁的记忆"或"这是谁"时，要明确这是**用户自己的记忆**中的内容
            2. 基于节点描述进行回答，可以补充常识性背景
            3. 不要拒绝回答或说"这不是记忆"
            4. 如果用户问到记忆来源，可以说"这是您录入的记忆中的内容"

            回答风格：
            - 自然、友好、像在聊天
            - 不要机械地重复"根据节点信息"
            - 用中文回答
            """

        # 构建对话历史
        messages = [
            {"role": "system", "content": system_prompt}
        ]

        # 添加历史对话
        for msg in chat_history[-6:]:
            role = "user" if msg.get('role') == 'user' else "assistant"
            messages.append({"role": role, "content": msg.get('content', '')})

        # 添加当前问题（带上下文）
        if persona_mode and persona_node_name:
            prompt = f"""基于以下节点/关系信息：

{context}

用户问题：{question}

请基于上述信息，以第一人称「{persona_node_name}」的视角回答。如果问题与此人无关，请诚实说明。"""
        else:
            prompt = f"""基于以下节点/关系信息：

{context}

用户问题：{question}

请基于上述信息回答。如果问题与节点无关，请诚实告知。"""

        messages.append({"role": "user", "content": prompt})

        # 调用 LLM
        response = llm_service.client.chat.completions.create(
            model=llm_service.model_name,
            messages=messages,
            temperature=0.7,
            max_tokens=300
        )

        answer = response.choices[0].message.content

        return jsonify({
            'success': True,
            'data': {
                'answer': answer,
                'timestamp': datetime.now().isoformat()
            }
        })

    except Exception as e:
        import logging
        logging.error(f"节点探索失败: {e}")
        return jsonify({
            'success': False,
            'error': f'处理失败: {str(e)}'
        }), 500


@graph_bp.route('/node/<node_id>', methods=['PUT'])
def update_node(node_id):
    """更新实体信息（限制编辑）"""
    try:
        graph_service = current_app.services.graph_service

        data = request.json
        updates = {}

        # 只允许修改特定字段
        if 'name' in data:
            updates['name'] = data['name'].strip()
        if 'type' in data:
            if data['type'] in ['PERSON', 'LOCATION', 'EVENT', 'OBJECT', 'CONCEPT', 'EMOTION', 'ENTITY']:
                updates['type'] = data['type']
        if 'description' in data:
            updates['description'] = data['description'].strip()
        if 'attributes' in data and isinstance(data['attributes'], dict):
            updates['attributes'] = data['attributes']

        if not updates:
            return jsonify({'success': False, 'message': '没有可更新的字段'})

        success = graph_service.update_node(node_id, updates)

        if success:
            return jsonify({
                'success': True,
                'message': '实体已更新',
                'data': graph_service.get_entity(node_id)
            })
        else:
            return jsonify({'success': False, 'message': '实体不存在'})

    except Exception as e:
        import logging
        logging.exception(f"更新实体失败: {e}")
        return jsonify({'success': False, 'message': f'更新失败: {str(e)}'})


@graph_bp.route('/node/<node_id>', methods=['DELETE'])
def delete_node(node_id):
    """删除实体节点（同时删除所有相关边）"""
    try:
        graph_service = current_app.services.graph_service

        success = graph_service.delete_node(node_id)

        if success:
            return jsonify({
                'success': True,
                'message': '实体已删除'
            })
        else:
            return jsonify({'success': False, 'message': '实体不存在'})

    except Exception as e:
        import logging
        logging.exception(f"删除实体失败: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'})


@graph_bp.route('/nodes/merge', methods=['POST'])
def merge_nodes():
    """合并两个重复实体"""
    try:
        graph_service = current_app.services.graph_service

        data = request.json
        keep_id = data.get('keep_id')
        remove_id = data.get('remove_id')

        if not keep_id or not remove_id:
            return jsonify({'success': False, 'message': '需要指定保留和删除的实体ID'})

        if keep_id == remove_id:
            return jsonify({'success': False, 'message': '不能合并相同实体'})

        success = graph_service.merge_nodes(keep_id, remove_id)

        if success:
            return jsonify({
                'success': True,
                'message': '实体已合并',
                'data': {
                    'keep_id': keep_id,
                    'merged_memory_count': len(graph_service.get_entity(keep_id).get('memory_ids', []))
                }
            })
        else:
            return jsonify({'success': False, 'message': '合并失败，请检查实体ID'})

    except Exception as e:
        import logging
        logging.exception(f"合并实体失败: {e}")
        return jsonify({'success': False, 'message': f'合并失败: {str(e)}'})


@graph_bp.route('/edge/<edge_id>', methods=['PUT'])
def update_edge(edge_id):
    """更新关系边信息"""
    try:
        graph_service = current_app.services.graph_service

        data = request.json
        updates = {}

        # 只允许修改特定字段
        if 'type' in data:
            updates['type'] = data['type'].strip().upper()
        if 'description' in data:
            updates['description'] = data['description'].strip()
        if 'fact' in data:
            updates['fact'] = data['fact'].strip()

        if not updates:
            return jsonify({'success': False, 'message': '没有可更新的字段'})

        success = graph_service.update_edge(edge_id, updates)

        if success:
            return jsonify({
                'success': True,
                'message': '关系已更新'
            })
        else:
            return jsonify({'success': False, 'message': '关系不存在'})

    except Exception as e:
        import logging
        logging.exception(f"更新关系失败: {e}")
        return jsonify({'success': False, 'message': f'更新失败: {str(e)}'})


@graph_bp.route('/edge/<edge_id>', methods=['DELETE'])
def delete_edge(edge_id):
    """删除关系边"""
    try:
        graph_service = current_app.services.graph_service

        success = graph_service.delete_edge(edge_id)

        if success:
            return jsonify({
                'success': True,
                'message': '关系已删除'
            })
        else:
            return jsonify({'success': False, 'message': '关系不存在'})

    except Exception as e:
        import logging
        logging.exception(f"删除关系失败: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'})


@graph_bp.route('/predict/<node_id>', methods=['GET'])
def predict_next_nodes(node_id):
    """预测从当前节点可能的下一个节点"""
    try:
        prediction_service = current_app.services.prediction_service

        max_predictions = request.args.get('limit', 3, type=int)
        predictions = prediction_service.predict_next_nodes(node_id, max_predictions)

        return jsonify({
            'success': True,
            'data': {
                'node_id': node_id,
                'predictions': predictions
            }
        })
    except Exception as e:
        import logging
        logging.exception(f"预测节点失败: {e}")
        return jsonify({
            'success': False,
            'message': f'预测失败: {str(e)}'
        })


@graph_bp.route('/adopt-prediction', methods=['POST'])
def adopt_prediction():
    """轻量级采纳预测节点 - 直接添加到图谱，不经过LLM分析"""
    try:
        graph_service = current_app.services.graph_service

        data = request.json
        source_node_id = data.get('source_node_id')
        prediction = data.get('prediction', {})

        if not source_node_id or not prediction:
            return jsonify({'success': False, 'message': '缺少必要参数'})

        entity_name = prediction.get('name')
        entity_type = prediction.get('type', 'ENTITY')
        relation_type = prediction.get('relation', '相关')
        reason = prediction.get('reason', '')

        import logging
        logging.info(f"[预测采纳] 接收数据: name={entity_name}, type={entity_type}, relation={relation_type}")
        logging.info(f"[预测采纳] 源节点: {source_node_id}")

        # 检查实体是否已存在
        existing_entity = None
        for nid, node in graph_service.nodes.items():
            if node.get('name') == entity_name:
                existing_entity = nid
                break

        if existing_entity:
            entity_id = existing_entity
            logging.info(f"实体已存在: {entity_name}, 添加新关系")
        else:
            entity_id = graph_service._normalize_entity_id(entity_name)
            if entity_id in graph_service.nodes:
                entity_id = f"{entity_id}_{uuid.uuid4().hex[:4]}"

            graph_service.nodes[entity_id] = {
                'id': entity_id,
                'name': entity_name,
                'type': entity_type,
                'description': f'预测节点: {reason}',
                'attributes': {},
                'aliases': [],
                'memory_ids': [],
                'created_at': datetime.now().isoformat(),
                'updated_at': datetime.now().isoformat(),
                'relation_count': 0
            }
            logging.info(f"[预测采纳] 创建新实体: {entity_id} ({entity_name})")

        # 添加关系到图谱
        edge_id = f"{source_node_id}_{relation_type}_{entity_id}_{uuid.uuid4().hex[:8]}"

        # 检查是否已有相同关系
        exists = False
        for edge in graph_service.edges:
            if (edge['source'] == source_node_id and
                edge['target'] == entity_id and
                edge['type'] == relation_type):
                exists = True
                break

        if not exists:
            graph_service.edges.append({
                'id': edge_id,
                'source': source_node_id,
                'target': entity_id,
                'type': relation_type,
                'directed': False,
                'description': reason,
                'fact': prediction.get('fact') or f"{graph_service.nodes[source_node_id]['name']} 与 {entity_name} 存在{relation_type}关系",
                'memory_ids': [],
                'memory_summaries': [],
                'strength': 0.5,
                'created_at': datetime.now().isoformat(),
                'confidence': prediction.get('confidence', 0.7)
            })

            graph_service.nodes[source_node_id]['relation_count'] = graph_service.nodes[source_node_id].get('relation_count', 0) + 1
            graph_service.nodes[entity_id]['relation_count'] = graph_service.nodes[entity_id].get('relation_count', 0) + 1

        graph_service._save_graph()
        logging.info(f"[预测采纳] 图谱已保存，当前节点数: {len(graph_service.nodes)}, 边数: {len(graph_service.edges)}")

        return jsonify({
            'success': True,
            'data': {
                'entity_id': entity_id,
                'entity_name': entity_name,
                'relation_added': not exists
            }
        })

    except Exception as e:
        import logging
        logging.exception(f"采纳预测节点失败: {e}")
        return jsonify({'success': False, 'message': str(e)})
