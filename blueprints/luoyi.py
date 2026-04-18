"""
洛忆聊天 Blueprint
Liora 记忆网络的 AI 伙伴聊天接口（无状态版）
注意：记忆数据由客户端传入，不读取服务器存储
"""

import json
from flask import Blueprint, jsonify, request, current_app
from loguru import logger

luoyi_bp = Blueprint('luoyi', __name__)


@luoyi_bp.route('/api/luoyi/chat', methods=['POST'])
def chat():
    """
    洛忆聊天接口
    注意：数据由客户端传入，不读取服务器存储
    """
    try:
        llm_service = current_app.services.llm_service

        data = request.json if isinstance(request.json, dict) else {}
        message = data.get('message', '')
        history = data.get('history', [])
        memories = data.get('memories', [])  # 客户端传入的记忆数据
        graph_summary = data.get('graph_summary', {})  # 客户端传入的图谱摘要

        if not message:
            return jsonify({'success': False, 'error': '消息不能为空'}), 400

        # 构建记忆上下文
        memory_context, context_used = _build_memory_context(memories)

        # 如果记忆为空或太多，尝试使用图谱上下文
        graph_context = ""
        if context_used == "graph" or (context_used == "none" and not memory_context):
            graph_context = _build_graph_context(graph_summary)
            context_used = "graph" if graph_context else "none"

        # 分析情感分布
        emotion_stats = _analyze_emotions(memories)

        # 构建系统提示词
        system_prompt = _build_system_prompt(memory_context, graph_context, context_used, emotion_stats)

        # 构建消息列表
        messages = [
            {"role": "system", "content": system_prompt}
        ]

        # 添加对话历史（最近6轮）
        for msg in history[-6:]:
            role = "user" if msg.get('role') == 'user' else "assistant"
            messages.append({"role": role, "content": msg.get('content', '')})

        # 添加当前消息
        messages.append({"role": "user", "content": message})

        # 调用 LLM
        try:
            response = llm_service.client.chat.completions.create(
                model=llm_service.model_name,
                messages=messages,
                temperature=0.7,
                max_tokens=500
            )
            reply = response.choices[0].message.content
        except Exception as e:
            logger.error(f"LLM 调用失败: {e}")
            reply = "抱歉,我现在有点累了...稍后再和我聊天吧。"

        return jsonify({
            'success': True,
            'reply': reply,
            'context_used': context_used
        })

    except Exception as e:
        logger.error(f"洛忆聊天失败: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _build_memory_context(memories, max_chars=30000):
    """构建记忆上下文,超过限制时截断"""
    if not memories:
        return "", "none"

    memory_lines = []
    total_chars = 0

    # 按时间倒序排列（最新的记忆在前）
    sorted_memories = sorted(
        memories,
        key=lambda m: m.get('created_at', ''),
        reverse=True
    )

    for m in sorted_memories:
        content = m.get('content', '')
        created = m.get('created_at', '')[:10] if m.get('created_at') else '未知时间'
        emotion = m.get('emotion', {})
        emotion_label = emotion.get('dominant_emotion', '') if emotion else ''

        if content:
            line = f"[{created}] {content}"
            if emotion_label:
                line = f"[{created} · {emotion_label}] {content}"
            memory_lines.append(line)
            total_chars += len(line)

            if total_chars > max_chars:
                break

    if not memory_lines:
        return "", "none"

    context = "\n\n以下是用户的记忆记录：\n" + "\n".join(memory_lines)
    context_used = "memories" if total_chars <= max_chars else "graph"

    return context, context_used


def _build_graph_context(graph_summary):
    """构建图谱上下文（当记忆太多时使用）"""
    try:
        nodes = graph_summary.get('nodes', [])
        edges = graph_summary.get('edges', [])

        if not nodes:
            return ""

        # 统计高频实体
        entity_count = {}
        for edge in edges:
            src = edge.get('source', '')
            tgt = edge.get('target', '')
            entity_count[src] = entity_count.get(src, 0) + 1
            entity_count[tgt] = entity_count.get(tgt, 0) + 1

        # 获取 Top 实体
        top_entities = sorted(entity_count.items(), key=lambda x: x[1], reverse=True)[:20]
        top_node_ids = [e[0] for e in top_entities]

        # 构建图谱摘要
        lines = ["【知识图谱摘要】"]
        lines.append(f"共有 {len(nodes)} 个实体，{len(edges)} 条关系")

        # 添加高频实体
        lines.append("\n主要人物/实体：")
        for node_id in top_node_ids[:10]:
            node = next((n for n in nodes if n.get('id') == node_id), None)
            if node:
                name = node.get('name', node_id)
                n_type = node.get('type', 'ENTITY')
                count = entity_count.get(node_id, 0)
                lines.append(f"- {name}（{n_type}，关联 {count} 条）")

        return "\n".join(lines)
    except Exception as e:
        logger.warning(f"构建图谱上下文失败: {e}")
        return ""


def _analyze_emotions(memories):
    """分析记忆情感分布"""
    if not memories:
        return {
            "total": 0,
            "positive": 0,
            "neutral": 0,
            "negative": 0,
            "dominant": "none",
            "valence_avg": 0
        }

    positive = 0
    neutral = 0
    negative = 0
    total_valence = 0
    counted = 0

    for m in memories:
        emotion = m.get('emotion', {})
        if not emotion:
            continue

        valence = emotion.get('valence', 0)
        total_valence += valence
        counted += 1

        if valence > 0.2:
            positive += 1
        elif valence < -0.2:
            negative += 1
        else:
            neutral += 1

    # 确定主导情感
    counts = {"positive": positive, "neutral": neutral, "negative": negative}
    dominant = max(counts, key=counts.get)

    # 计算平均 valence
    valence_avg = total_valence / counted if counted > 0 else 0

    return {
        "total": len(memories),
        "positive": positive,
        "neutral": neutral,
        "negative": negative,
        "dominant": dominant,
        "valence_avg": round(valence_avg, 2),
        "counted": counted
    }


def _get_tone_instruction(emotion_stats):
    """根据情感分布生成语气指导"""
    if emotion_stats["total"] == 0:
        return ""

    dominant = emotion_stats["dominant"]
    valence_avg = emotion_stats["valence_avg"]

    # 根据主导情感选择语气
    if dominant == "positive":
        return f"""【当前语气】用户记忆整体偏积极愉快。
语气要求：轻松活泼，可以调侃打趣，像分享好消息的老友。
示例语气："好家伙！这波回忆杀太甜了！"""
    elif dominant == "negative":
        return f"""【当前语气】用户记忆整体偏深沉或有些低落。
语气要求：温柔温暖，多倾听少说，像安静陪伴的老友。
示例语气："抱抱，那种感觉很不容易，但都过去了..." """
    elif dominant == "neutral":
        # 根据 valence 细分
        if valence_avg > 0:
            return f"""【当前语气】用户记忆整体平静中带点温暖。
语气要求：平和自然，温和分享。
示例语气："嗯，这种日子也挺好的，平平淡淡才是真。"""
        else:
            return f"""【当前语气】用户记忆整体平静有些复杂。
语气要求：沉稳内敛，适度共情。
示例语气："看得出这段记忆有点复杂，我陪你慢慢聊。"""
    else:
        return ""


def _build_system_prompt(memory_context, graph_context, context_used, emotion_stats):
    """构建洛忆的系统提示词"""

    # 获取语气指导
    tone_instruction = _get_tone_instruction(emotion_stats)

    base_prompt = f"""你是洛忆，Liora 记忆网络的 AI 伙伴。

{tone_instruction}

性格特点：
- 温暖陪伴，像用户的老朋友
- 可以主动串联相关记忆，"你之前也提过..."
- 根据上文情感调整语气

回答要求：
- 简短自然，100字以内
- 像朋友聊天，不要机器人口吻
- 用中文回答
- 不要重复用户说过的话"""

    # 根据上下文类型添加不同引导
    if context_used == "memories" and memory_context:
        return base_prompt + f"\n\n{memory_context}"
    elif context_used == "graph" and graph_context:
        return base_prompt + f"\n\n{graph_context}\n\n（由于记忆较多，以上是图谱摘要）"
    else:
        return base_prompt + "\n\n（用户还没有录入任何记忆，你可以打个招呼~）"
