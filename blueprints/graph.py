"""
图谱路由 Blueprint
简化版：仅保留探索问答端点，其他功能移至前端 IndexedDB
"""

import json
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app
from loguru import logger

graph_bp = Blueprint('graph', __name__, url_prefix='/api/graph')


@graph_bp.route('/explore', methods=['POST'])
def explore_node():
    """
    节点探索问答 - 基于节点上下文回答用户问题
    注意：上下文数据由客户端传入，不读取服务器存储
    """
    try:
        llm_service = current_app.services.llm_service

        data = request.json if isinstance(request.json, dict) else {}
        question = data.get('question', '')
        context = data.get('context', {})
        chat_history = data.get('history', [])
        persona_mode = data.get('persona_mode', False)
        persona_node_name = data.get('persona_node_name', '')
        language = data.get('language', 'Chinese')
        answer_language = 'English' if str(language).lower().startswith('english') else 'Chinese'
        language_instruction = 'Please answer in English.' if answer_language == 'English' else '请用中文回答。'

        if not question:
            error = 'Question cannot be empty' if answer_language == 'English' else '问题不能为空'
            return jsonify({'success': False, 'error': error}), 400

        # 从 context 中提取节点/边信息
        node_data = context.get('node', {})
        edge_data = context.get('edge', {})
        memories = context.get('memories', [])
        graph_summary = context.get('graph_summary', {})

        # 构建上下文字符串
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

        # 添加记忆上下文
        if memories:
            memory_lines = []
            for m in memories[:5]:
                if not isinstance(m, dict):
                    continue
                content = m.get('content', '')[:200]
                understanding = m.get('understanding', {})
                if isinstance(understanding, str):
                    understanding = {}
                summary = understanding.get('summary', '')
                if summary:
                    memory_lines.append(f"- {summary}")
                elif content:
                    memory_lines.append(f"- {content[:100]}")
            if memory_lines:
                context_parts.append("相关记忆:\n" + "\n".join(memory_lines))

        # 添加图谱摘要
        if graph_summary:
            nodes = graph_summary.get('nodes', [])
            if nodes:
                node_info = [f"- {n.get('name', '')} ({n.get('type', '')})" for n in nodes[:10]]
                context_parts.append("知识图谱中的实体:\n" + "\n".join(node_info))

        context_str = '\n'.join(context_parts)

        # 构建系统提示词
        if persona_mode and persona_node_name:
            system_prompt = f"""你扮演「{persona_node_name}」这个人物。现在你要以第一人称的视角，基于用户记忆网络中的内容来回忆和回答问题。
回答风格：
- 第一人称"我"来叙述
- 自然、简洁，像在和人聊天，不要啰嗦
- {language_instruction}
- 回答尽量简短，100字以内
"""
        else:
            system_prompt = f"""你是 Liora 记忆网络的智能助手。Liora 是一个个人记忆管理系统，用户存储的所有内容都是 TA 的记忆。

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
- {language_instruction}
"""

        # 构建对话历史
        messages = [
            {"role": "system", "content": system_prompt}
        ]

        # 添加历史对话
        for msg in chat_history[-6:]:
            role = "user" if msg.get('role') == 'user' else "assistant"
            messages.append({"role": role, "content": msg.get('content', '')})

        # 构建最终 prompt
        if persona_mode and persona_node_name:
            # 构建记忆上下文（30K 字符保护）
            memory_context = ""
            if memories:
                memory_lines = []
                total_chars = 0
                max_chars = 30000
                for m in memories:
                    if not isinstance(m, dict):
                        continue
                    content = m.get('content', '')
                    created = m.get('created_at', '')[:10] if m.get('created_at') else '未知时间'
                    if content:
                        memory_lines.append(f"[{created}] {content}")
                        total_chars += len(content)
                        if total_chars > max_chars:
                            break
                if memory_lines:
                    memory_context = "\n\n以下是用户记忆中与「" + persona_node_name + "」相关的记录：\n" + "\n".join(memory_lines)

            if memory_context:
                prompt = f"""你扮演「{persona_node_name}」这个人物。

{memory_context}

用户问题：{question}

请以第一人称「{persona_node_name}」的视角，基于上述记忆内容回答。如果记忆中没有相关信息，请诚实说明。{language_instruction}"""
            elif context_str:
                prompt = f"""你扮演「{persona_node_name}」这个人物。

{context_str}

请基于上述记忆网络中的信息，以第一人称的视角回答。如果信息不足，请诚实说明。{language_instruction}"""
            else:
                prompt = f"""你扮演「{persona_node_name}」这个人物。

用户问题：{question}

请基于你的角色设定回答。{language_instruction}"""
        else:
            prompt = f"""基于以下节点/关系信息：

{context_str if context_str else '(无节点信息)'}

用户问题：{question}

请基于上述信息回答。如果问题与节点无关，请诚实告知。{language_instruction}"""

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


# ========== 以下端点已移至前端 IndexedDB ==========
# - GET /api/graph/data → 前端 db.getGraphData()
# - GET /api/graph/entity/<id> → 前端 db.getEntity() + db.getMemoriesByEntity()
# - PUT /api/graph/node/<id> → 前端 graphService.updateNode()
# - DELETE /api/graph/node/<id> → 前端 graphService.deleteNode()
# - POST /api/graph/nodes/merge → 前端 graphService.mergeNodes()
# - PUT /api/graph/edge/<id> → 前端 graphService.updateEdge()
# - DELETE /api/graph/edge/<id> → 前端 graphService.deleteEdge()
# - GET /api/graph/predict/<id> → 前端 graphService.predictNextNodes()
# - POST /api/graph/adopt-prediction → 前端直接添加到 IndexedDB
