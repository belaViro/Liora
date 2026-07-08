"""
Compute Blueprint - 纯计算端点（无状态）
所有计算不存储数据，结果直接返回给客户端
"""

import os
import json
import base64
import httpx
from flask import Blueprint, jsonify, request, current_app
from loguru import logger

compute_bp = Blueprint('compute', __name__, url_prefix='/api/compute')

PREDICTION_TYPES = {'PERSON', 'LOCATION', 'EVENT', 'OBJECT', 'CONCEPT'}


def _safe_int(value, default=5, min_value=1, max_value=10):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(min_value, min(number, max_value))


def _message_content_to_text(message):
    content = getattr(message, 'content', '') or ''
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = item.get('text') or item.get('content')
                if text:
                    parts.append(str(text))
            elif item:
                parts.append(str(item))
        return ''.join(parts).strip()
    return str(content).strip()


def _extract_json_payload(text):
    """Parse a JSON object/array from model output, including fenced JSON."""
    text = (text or '').strip()
    if not text:
        raise ValueError('模型返回内容为空')

    candidates = [text]
    if '```' in text:
        fence_parts = text.split('```')
        for part in fence_parts[1::2]:
            part = part.strip()
            if part.lower().startswith('json'):
                part = part[4:].strip()
            if part:
                candidates.insert(0, part)

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    decoder = json.JSONDecoder()
    for index, char in enumerate(text):
        if char not in '{[':
            continue
        try:
            payload, _ = decoder.raw_decode(text[index:])
            return payload
        except json.JSONDecodeError:
            continue

    raise ValueError('未找到合法 JSON')


def _normalize_prediction_items(payload, max_predictions):
    if isinstance(payload, dict):
        items = payload.get('predictions', [])
    elif isinstance(payload, list):
        items = payload
    else:
        raise ValueError('预测结果 JSON 结构必须是对象或数组')

    predictions = []
    for item in items:
        if not isinstance(item, dict):
            continue

        name = str(item.get('name', '')).strip()
        if not name:
            continue

        entity_type = str(item.get('type') or 'CONCEPT').strip().upper()
        if entity_type not in PREDICTION_TYPES:
            entity_type = 'CONCEPT'

        relation_type = str(
            item.get('relation_type') or item.get('relation') or entity_type
        ).strip() or entity_type
        reasoning = str(item.get('reasoning') or item.get('reason') or '').strip()

        try:
            confidence = float(item.get('confidence', 0.5))
        except (TypeError, ValueError):
            confidence = 0.5
        confidence = max(0.0, min(confidence, 1.0))

        predictions.append({
            'name': name,
            'type': entity_type,
            'relation_type': relation_type,
            'confidence': confidence,
            'reasoning': reasoning,
        })

        if len(predictions) >= max_predictions:
            break

    return predictions

@compute_bp.route('/understand', methods=['POST'])
def compute_understand():
    """
    LLM 理解和抽取（纯计算，不存储）

    输入: { content, type, file_path (可选) }
    输出: { understanding, entities, relations, emotion }
    """
    try:
        data = request.get_json(silent=True) or {}
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

        # 透传内部 success/error 状态
        is_success = result.pop('success', True)
        error = result.pop('error', None)
        return jsonify({
            'success': is_success,
            'data': result,
            'meta': {
                'model': llm_service.model_name,
                'provider': llm_service.provider
            },
            **({'message': error} if error else {})
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
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            http_client=httpx.Client(trust_env=False, timeout=60.0),
        )

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
        client = OpenAI(
            api_key=api_key,
            base_url=base_url,
            http_client=httpx.Client(trust_env=False, timeout=60.0),
        )

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
        data = request.get_json(silent=True) or {}
        node = data.get('node', {}) if isinstance(data.get('node', {}), dict) else {}
        related_nodes = data.get('related_nodes', [])
        if not isinstance(related_nodes, list):
            related_nodes = []
        max_predictions = _safe_int(data.get('max_predictions', 5), default=5, min_value=1, max_value=8)
        language = data.get('language', 'Chinese')
        answer_language = 'English' if str(language).lower().startswith('english') else 'Chinese'

        llm_service = current_app.services.llm_service

        node_type = str(node.get('type') or 'ENTITY').upper()
        node_name = str(node.get('name') or '').strip()
        node_description = str(node.get('description') or '').strip()

        if not node_name:
            return jsonify({'success': False, 'message': '节点名称不能为空'})

        relation_lines = []
        for rel in related_nodes[:12]:
            if not isinstance(rel, dict):
                continue
            rel_type = str(rel.get('type') or 'ENTITY').upper()
            rel_name = str(rel.get('name') or '').strip()
            rel_desc = str(rel.get('description') or '').strip()
            if not rel_name:
                continue
            line = f"- {rel_name} ({rel_type})"
            if rel_desc:
                line += f": {rel_desc[:80]}"
            relation_lines.append(line)

        relations_context = "\n".join(relation_lines) if relation_lines else '- 暂无已知邻接节点'
        language_instruction = (
            'Use English for name, relation_type, and reasoning.'
            if answer_language == 'English'
            else '使用中文填写 name、relation_type 和 reasoning。'
        )
        system_prompt = f"""你是关系预测专家。只输出一个合法 JSON 对象，不要解释，不要 Markdown，不要输出思考过程。
JSON 格式:
{{"predictions":[{{"name":"实体名","type":"PERSON|LOCATION|EVENT|OBJECT|CONCEPT","relation_type":"关系类型","confidence":0.85,"reasoning":"一句话预测理由"}}]}}
要求:
- predictions 数量最多 {max_predictions} 条
- type 只能是 PERSON、LOCATION、EVENT、OBJECT、CONCEPT
- confidence 必须是 0 到 1 的数字
- reasoning 保持一句话，避免编造过度具体的隐私细节
- {language_instruction}"""
        prompt = f"""中心节点:
- 名称: {node_name}
- 类型: {node_type}
- 描述: {node_description or '无'}

已有邻接节点:
{relations_context}

请基于这些图谱线索预测可能缺失的关联节点。"""

        prediction_max_tokens = int(os.getenv('LLM_PREDICTION_MAX_TOKENS', '2000'))
        retry_max_tokens = int(os.getenv('LLM_PREDICTION_RETRY_MAX_TOKENS', '4096'))
        token_attempts = [prediction_max_tokens]
        if retry_max_tokens > prediction_max_tokens:
            token_attempts.append(retry_max_tokens)

        last_error = None
        for max_tokens in token_attempts:
            response = llm_service.client.chat.completions.create(
                model=llm_service.model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=max_tokens
            )

            choice = response.choices[0]
            result_text = _message_content_to_text(choice.message)
            finish_reason = getattr(choice, 'finish_reason', None)

            if not result_text:
                last_error = f'模型返回内容为空，finish_reason={finish_reason}'
                logger.warning(f"预测模型未返回最终内容，max_tokens={max_tokens}, finish_reason={finish_reason}")
                continue

            try:
                payload = _extract_json_payload(result_text)
                predictions = _normalize_prediction_items(payload, max_predictions)
                return jsonify({
                    'success': True,
                    'data': {
                        'predictions': predictions
                    }
                })
            except Exception as e:
                last_error = str(e)
                logger.warning(f"预测结果解析失败: {e}, raw: {result_text[:500]}")

        return jsonify({
            'success': False,
            'message': last_error or '预测结果解析失败',
            'data': {
                'predictions': []
            }
        })

    except Exception as e:
        logger.exception(f'/predict failed: {e}')
        return jsonify({'success': False, 'message': str(e), 'data': {'predictions': []}})

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
        language = data.get('language', 'Chinese')
        answer_language = 'English' if str(language).lower().startswith('english') else 'Chinese'
        language_instruction = 'Please answer in English.' if answer_language == 'English' else '请用中文回答。'

        llm_service = current_app.services.llm_service

        # 构建上下文
        context_parts = []

        # 添加相关记忆
        if memories:
            memory_contexts = []
            for m in memories[:5]:  # 限制数量
                if not isinstance(m, dict):
                    continue
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

请基于上下文回复。如果用户问的是记忆相关内容，结合上面的记忆和图谱信息回答。{language_instruction}"""}
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

