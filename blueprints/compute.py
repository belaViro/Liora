"""
Compute Blueprint - 纯计算端点（无状态）
所有计算不存储数据，结果直接返回给客户端
"""

import os
import json
import base64
from flask import Blueprint, jsonify, request, current_app
from loguru import logger

compute_bp = Blueprint('compute', __name__, url_prefix='/api/compute')


@compute_bp.route('/understand', methods=['POST'])
def compute_understand():
    """
    LLM 理解和抽取（纯计算，不存储）

    输入: { content, type, file_path (可选) }
    输出: { understanding, entities, relations, emotion }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        content = data.get('content', '')
        memory_type = data.get('type', 'text')
        file_path = data.get('file_path')

        if not content and not file_path:
            return jsonify({'success': False, 'message': '内容不能为空'})

        llm_service = current_app.services.llm_service

        # 构建记忆数据格式
        memory_data = {
            'content': content,
            'type': memory_type,
            'file_path': file_path
        }

        # 调用 LLM 理解和抽取
        result = llm_service.understand_and_extract(memory_data)

        return jsonify({
            'success': True,
            'data': result,
            'meta': {
                'model': llm_service.model_name,
                'provider': llm_service.provider
            }
        })

    except Exception as e:
        logger.exception(f'/understand failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/temporal', methods=['POST'])
def compute_temporal():
    """
    时间信息提取（纯计算）

    输入: { content, type, file_path (可选) }
    输出: { temporal_info }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        content = data.get('content', '')
        memory_type = data.get('type', 'text')
        file_path = data.get('file_path')

        temporal_extractor = current_app.services.temporal_extractor

        memory_data = {
            'content': content,
            'type': memory_type,
            'file_path': file_path
        }

        result = temporal_extractor.extract(memory_data)

        return jsonify({
            'success': True,
            'data': {
                'temporal_info': result
            }
        })

    except Exception as e:
        logger.exception(f'/temporal failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/embed', methods=['POST'])
def compute_embed():
    """
    计算文本向量（供客户端向量搜索使用）

    输入: { text }
    输出: { vector: [...], dimension: int }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        text = data.get('text', '')

        if not text:
            return jsonify({'success': False, 'message': '文本不能为空'})

        # 获取 embedding 模型配置
        api_key = os.getenv('LLM_API_KEY')
        base_url = os.getenv('LLM_BASE_URL', 'https://api.minimaxi.chat/v1')
        model_name = os.getenv('EMBEDDING_MODEL', 'BAAI/bge-large-zh-v1.5')

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)

        # 调用 embedding 模型
        response = client.embeddings.create(
            model=model_name,
            input=text
        )

        vector = response.data[0].embedding
        dimension = len(vector)

        return jsonify({
            'success': True,
            'data': {
                'vector': vector,
                'dimension': dimension
            }
        })

    except Exception as e:
        logger.exception(f'/embed failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/search-rank', methods=['POST'])
def compute_search_rank():
    """
    服务器辅助搜索排名（当客户端向量搜索结果不足时）

    输入: { query, memories: [...], top_k: int }
    输出: { results: [{memory, score}] }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        query = data.get('query', '')
        memories = data.get('memories', [])
        top_k = data.get('top_k', 10)

        if not query or not memories:
            return jsonify({'success': True, 'data': {'results': []}})

        # 获取 embedding 模型配置
        api_key = os.getenv('LLM_API_KEY')
        base_url = os.getenv('LLM_BASE_URL', 'https://api.minimaxi.chat/v1')
        model_name = os.getenv('EMBEDDING_MODEL', 'BAAI/bge-large-zh-v1.5')

        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)

        # 获取查询向量
        query_response = client.embeddings.create(
            model=model_name,
            input=query
        )
        query_vector = query_response.data[0].embedding

        # 获取记忆文本的向量
        memory_texts = []
        for m in memories:
            understanding = m.get('understanding', {})
            if isinstance(understanding, str):
                understanding = {}
            text = understanding.get('description', '') or m.get('content', '')
            memory_texts.append(text[:1000])  # 限制长度

        if not any(memory_texts):
            return jsonify({'success': True, 'data': {'results': []}})

        memory_response = client.embeddings.create(
            model=model_name,
            input=memory_texts
        )

        # 计算余弦相似度
        results = []
        for i, m in enumerate(memories):
            mem_vector = memory_response.data[i].embedding

            # 余弦相似度
            dot = sum(a * b for a, b in zip(query_vector, mem_vector))
            norm_q = sum(a * a for a in query_vector) ** 0.5
            norm_m = sum(a * a for a in mem_vector) ** 0.5
            score = dot / (norm_q * norm_m) if norm_q > 0 and norm_m > 0 else 0

            results.append({'memory': m, 'score': score})

        # 排序
        results.sort(key=lambda x: x['score'], reverse=True)

        return jsonify({
            'success': True,
            'data': {
                'results': results[:top_k]
            }
        })

    except Exception as e:
        logger.exception(f'/search-rank failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/predict', methods=['POST'])
def compute_predict():
    """
    节点预测（基于已有关系网络推理）

    输入: { node, related_nodes: [...], max_predictions: int }
    输出: { predictions: [...] }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        node = data.get('node', {})
        related_nodes = data.get('related_nodes', [])
        max_predictions = data.get('max_predictions', 5)

        llm_service = current_app.services.llm_service

        # 获取节点类型
        node_type = node.get('type', 'ENTITY')
        node_name = node.get('name', '')
        node_description = node.get('description', '')

        # 构建已有关系信息
        relations_info = []
        for rel in related_nodes:
            rel_type = rel.get('type', '')
            rel_name = rel.get('name', '')
            rel_desc = rel.get('description', '')
            if rel_type and rel_name:
                relations_info.append(f"- {node_name} --[{rel_type}]--> {rel_name}")

        # 根据节点类型构建不同的预测提示
        type_prompts = {
            'PERSON': f"根据关于 {node_name} 的已知信息({node_description})和关系:\n" + "\n".join(relations_info) + f"\n\n预测 {node_name} 可能还认识哪些人、去哪里、做什么事情？",
            'LOCATION': f"根据地点 {node_name} 的已知信息({node_description})和关联:\n" + "\n".join(relations_info) + f"\n\n预测这个地点可能关联哪些人物、活动或其他地点？",
            'EVENT': f"根据事件 {node_name} 的已知信息({node_description})和参与:\n" + "\n".join(relations_info) + f"\n\n预测这个事件可能涉及哪些人物或地点？",
            'EMOTION': f"根据情感状态 {node_name} 的描述({node_description})和关联:\n" + "\n".join(relations_info) + f"\n\n预测这种情感可能与哪些记忆或事件相关？"
        }

        prompt = type_prompts.get(node_type, type_prompts['PERSON'])

        system_prompt = """你是一个关系预测专家。基于已有的实体关系，预测可能的下一个关系节点。
请返回合法的JSON数组格式:
{
  "predictions": [
    {
      "name": "预测的实体名称",
      "type": "PERSON|LOCATION|EVENT|OBJECT|CONCEPT",
      "relation_type": "预测的关系类型",
      "confidence": 0.85,
      "reasoning": "预测理由"
    }
  ]
}
"""

        response = llm_service.client.chat.completions.create(
            model=llm_service.model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=800
        )

        result_text = response.choices[0].message.content.strip()

        # 解析 JSON
        predictions = []
        try:
            # 尝试提取 JSON
            json_str = result_text
            if '```json' in result_text:
                json_str = result_text.split('```json')[1].split('```')[0]
            elif '```' in result_text:
                json_str = result_text.split('```')[1].split('```')[0]

            result = json.loads(json_str)
            predictions = result.get('predictions', [])[:max_predictions]
        except Exception as e:
            logger.warning(f"预测结果解析失败: {e}, raw: {result_text[:200]}")

        return jsonify({
            'success': True,
            'data': {
                'predictions': predictions
            }
        })

    except Exception as e:
        logger.exception(f'/predict failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/chat', methods=['POST'])
def compute_chat():
    """
    洛忆聊天（传入记忆数据，不读取服务器存储）

    输入: { message, history: [...], memories: [...], graph_summary: {} }
    输出: { reply, context_used }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        message = data.get('message', '')
        history = data.get('history', [])
        memories = data.get('memories', [])
        graph_summary = data.get('graph_summary', {})

        llm_service = current_app.services.llm_service

        # 构建上下文
        context_parts = []

        # 添加相关记忆
        if memories:
            memory_contexts = []
            for m in memories[:5]:  # 限制数量
                content = m.get('content', '')[:200]
                understanding = m.get('understanding', {})
                if isinstance(understanding, str):
                    understanding = {}
                summary = understanding.get('summary', '')
                if summary:
                    memory_contexts.append(f"- {summary}")
                elif content:
                    memory_contexts.append(f"- {content[:100]}")
            if memory_contexts:
                context_parts.append("相关记忆:\n" + "\n".join(memory_contexts))

        # 添加图谱摘要
        if graph_summary:
            nodes = graph_summary.get('nodes', [])
            if nodes:
                node_info = [f"- {n.get('name', '')} ({n.get('type', '')})" for n in nodes[:10]]
                context_parts.append("知识图谱中的实体:\n" + "\n".join(node_info))

        context = "\n\n".join(context_parts) if context_parts else "暂无相关上下文"

        # 构建消息历史
        messages = [
            {"role": "system", "content": f"""你是洛忆，用户最好的朋友。你说话直接、真诚，不喜欢用大词。你很会观察细节，总能看到别人看不到的点。
当前对话上下文：
{context}

请基于上下文回复。如果用户问的是记忆相关内容，结合上面的记忆和图谱信息回答。"""}
        ]

        # 添加历史
        for h in history[-6:]:  # 限制历史长度
            role = 'assistant' if h.get('role') == 'luoyi' else 'user'
            messages.append({"role": role, "content": h.get('content', '')})

        messages.append({"role": "user", "content": message})

        # 调用 LLM
        response = llm_service.client.chat.completions.create(
            model=llm_service.model_name,
            messages=messages,
            temperature=0.8,
            max_tokens=500
        )

        reply = response.choices[0].message.content

        return jsonify({
            'success': True,
            'data': {
                'reply': reply,
                'context_used': len(context_parts) > 0
            }
        })

    except Exception as e:
        logger.exception(f'/chat failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/upload-chunk', methods=['POST'])
def upload_chunk():
    """
    大文件分块上传（临时存储）

    输入: FormData { upload_id, chunk_index, total_chunks, chunk }
    输出: { success }
    """
    try:
        upload_id = request.form.get('upload_id')
        chunk_index = int(request.form.get('chunk_index', 0))
        total_chunks = int(request.form.get('total_chunks', 1))
        chunk = request.files.get('chunk')

        if not upload_id or not chunk:
            return jsonify({'success': False, 'message': '参数错误'})

        # 保存分块到临时目录
        from config.settings import UPLOAD_FOLDER
        temp_dir = os.path.join(UPLOAD_FOLDER, 'temp', upload_id)
        os.makedirs(temp_dir, exist_ok=True)

        chunk_path = os.path.join(temp_dir, f'chunk_{chunk_index:04d}')
        chunk.save(chunk_path)

        return jsonify({
            'success': True,
            'data': {
                'chunk_index': chunk_index,
                'received': total_chunks
            }
        })

    except Exception as e:
        logger.exception(f'/upload-chunk failed: {e}')
        return jsonify({'success': False, 'message': str(e)})


@compute_bp.route('/merge-chunks', methods=['POST'])
def merge_chunks():
    """
    合并分块文件

    输入: { upload_id }
    输出: { success, file_path }
    """
    try:
        data = request.json if isinstance(request.json, dict) else {}
        upload_id = data.get('upload_id')

        if not upload_id:
            return jsonify({'success': False, 'message': 'upload_id 不能为空'})

        from config.settings import UPLOAD_FOLDER
        temp_dir = os.path.join(UPLOAD_FOLDER, 'temp', upload_id)

        if not os.path.exists(temp_dir):
            return jsonify({'success': False, 'message': '分块不存在'})

        # 获取所有分块
        chunks = sorted([f for f in os.listdir(temp_dir) if f.startswith('chunk_')],
                       key=lambda x: int(x.split('_')[1]))

        if not chunks:
            return jsonify({'success': False, 'message': '没有分块'})

        # 合并
        import uuid
        file_ext = '.bin'  # 默认扩展名
        output_name = f"{uuid.uuid4().hex}{file_ext}"
        output_path = os.path.join(UPLOAD_FOLDER, output_name)

        with open(output_path, 'wb') as out:
            for chunk_name in chunks:
                chunk_path = os.path.join(temp_dir, chunk_name)
                with open(chunk_path, 'rb') as f:
                    out.write(f.read())

        # 清理分块
        import shutil
        shutil.rmtree(temp_dir)

        return jsonify({
            'success': True,
            'data': {
                'file_path': output_path
            }
        })

    except Exception as e:
        logger.exception(f'/merge-chunks failed: {e}')
        return jsonify({'success': False, 'message': str(e)})
