"""
记忆路由 Blueprint
包含记忆的创建、搜索、删除、时间线等功能
"""

import os
import uuid
from datetime import datetime
from flask import Blueprint, jsonify, request, current_app

memory_bp = Blueprint('memory', __name__, url_prefix='/api/memory')


@memory_bp.route('/preprocess', methods=['POST'])
def preprocess_file():
    """预处理文件：识别类型并提取内容，返回给前端填入文本框"""
    import logging

    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'})

    file = request.files['file']
    if not file.filename:
        return jsonify({'success': False, 'message': '文件名为空'})

    from config.settings import UPLOAD_FOLDER
    file_ext = os.path.splitext(file.filename)[1]
    file_name = f"{uuid.uuid4().hex}{file_ext}"
    file_path = os.path.join(UPLOAD_FOLDER, file_name)
    file.save(file_path)

    # 自动识别类型
    mime = file.content_type.lower()
    ext = file_ext.lower().strip('.')
    if mime.startswith('image/') or ext in ['jpg','jpeg','png','gif','webp','bmp']:
        memory_type = 'image'
    elif mime.startswith('audio/') or ext in ['mp3','wav','ogg','m4a','flac','aac']:
        memory_type = 'audio'
    elif mime.startswith('video/') or ext in ['mp4','avi','mov','mkv','webm']:
        memory_type = 'video'
    else:
        memory_type = 'text'

    content = ''
    llm_service = current_app.services.llm_service

    if memory_type == 'image':
        logging.info(f"预处理图片: {file_path}")
        try:
            content = llm_service.describe_image(file_path)
        except Exception as e:
            logging.error(f"图片理解失败: {e}")

    elif memory_type == 'audio':
        logging.info(f"预处理音频: {file_path}")
        try:
            content = llm_service.transcribe_audio(file_path)
        except Exception as e:
            logging.error(f"音频转写失败: {e}")

    # 返回文件路径（正式提交时用）和提取的内容
    return jsonify({
        'success': True,
        'data': {
            'file_path': file_path,
            'type': memory_type,
            'content': content
        }
    })


@memory_bp.route('/create', methods=['POST'])
def create_memory():
    """创建新记忆（手动输入）支持文本、图片、音频等多种输入"""
    try:
        memory_service = current_app.services.memory_service
        graph_service = current_app.services.graph_service
        embedding_service = current_app.services.embedding_service
        llm_service = current_app.services.llm_service
        temporal_extractor = current_app.services.temporal_extractor
        socketio = current_app.socketio

        data = request.form
        content = data.get('content', '').strip()
        memory_type = data.get('type', 'text')

        if not content and 'file' not in request.files:
            return jsonify({'success': False, 'message': '内容不能为空'})

        # 处理文件上传
        file_path = None
        if 'file' in request.files:
            file = request.files['file']
            if file.filename:
                from config.settings import UPLOAD_FOLDER
                file_ext = os.path.splitext(file.filename)[1]
                file_name = f"{uuid.uuid4().hex}{file_ext}"
                file_path = os.path.join(UPLOAD_FOLDER, file_name)
                file.save(file_path)
                import logging
                logging.info(f"文件已保存: {file_path}")

        # 构建记忆数据
        memory_data = {
            'id': str(uuid.uuid4()),
            'type': memory_type,
            'content': content,
            'file_path': file_path,
            'created_at': datetime.now().isoformat(),
            'metadata': {
                'source': 'manual_input',
                'timestamp': datetime.now().isoformat()
            }
        }

        # 时间信息提取（多模态）
        socketio.emit('processing_status', {'status': 'processing', 'message': '正在分析时间信息...'})
        temporal_info = temporal_extractor.extract(memory_data)

        # 如果置信度低，尝试用LLM增强
        if temporal_info['confidence'] < 0.5:
            temporal_info = temporal_extractor.enhance_with_llm(
                memory_data,
                {'description': content, 'summary': content}
            )

        memory_data['temporal_info'] = temporal_info
        import logging
        logging.info(f"时间信息: {temporal_info}")

        # 合并 LLM 调用：同时理解和抽取知识
        socketio.emit('processing_status', {'status': 'processing', 'message': '洛忆正在分析记忆内容...'})
        logging.info(f"开始处理记忆: {content[:50]}...")

        # 使用单次 LLM 调用完成理解和知识抽取
        extraction_result = llm_service.understand_and_extract(memory_data)

        logging.info(f"处理完成: {len(extraction_result.get('entities', []))} 实体, {len(extraction_result.get('relations', []))} 关系")

        memory_data['understanding'] = extraction_result.get('understanding', {})
        memory_data['entities'] = extraction_result.get('entities', [])
        memory_data['relations'] = extraction_result.get('relations', [])
        memory_data['emotion'] = extraction_result.get('emotion', {})

        # 保存记忆
        logging.info(f"保存记忆: {memory_data['id']}")
        memory_service.save_memory(memory_data)
        logging.info(f"记忆已保存到 memories.json")

        # 更新知识图谱
        logging.info(f"开始更新图谱，实体数: {len(memory_data['entities'])}, 关系数: {len(memory_data['relations'])}")
        graph_service.update_graph(
            entities=memory_data['entities'],
            relations=memory_data['relations'],
            memory_id=memory_data['id'],
            memory_summary=memory_data['understanding'].get('summary', ''),
            temporal_info=memory_data.get('temporal_info')
        )
        logging.info(f"图谱更新完成")

        # 添加向量索引
        try:
            text_for_embedding = memory_data['understanding'].get('description', '') or content
            if text_for_embedding:
                embedding_service.add_memory(memory_data['id'], text_for_embedding)
                logging.info(f"向量索引已添加")
        except Exception as e:
            logging.error(f"添加向量索引失败: {e}")

        socketio.emit('processing_status', {'status': 'completed', 'message': '记忆已保存'})

        return jsonify({
            'success': True,
            'message': '记忆创建成功',
            'data': {
                'memory_id': memory_data['id'],
                'entities': memory_data['entities'],
                'relations': memory_data['relations']
            }
        })

    except Exception as e:
        import logging
        logging.exception(f"创建记忆失败: {e}")
        return jsonify({'success': False, 'message': f'创建失败: {str(e)}'})


@memory_bp.route('/search', methods=['POST'])
def search_memories():
    """搜索记忆支持自然语言查询（向量检索 + 关键词匹配）"""
    try:
        embedding_service = current_app.services.embedding_service
        memory_service = current_app.services.memory_service
        llm_service = current_app.services.llm_service
        graph_service = current_app.services.graph_service

        data = request.get_json()
        query = data.get('query', '').strip()

        if not query:
            return jsonify({'success': False, 'message': '查询不能为空'})

        limit = data.get('limit', 10)
        use_vector = data.get('use_vector', True)

        # 搜索结果字典: memory_id -> {memory, vector_score, keyword_score}
        search_scores = {}

        # 1. 向量搜索
        vector_working = False
        vector_error = None
        if use_vector:
            try:
                vector_results = embedding_service.search(query, top_k=limit * 2, similarity_threshold=0.5)
                vector_working = True

                for r in vector_results:
                    memory = memory_service.get_memory(r['memory_id'])
                    if memory:
                        search_scores[memory['id']] = {
                            'memory': memory,
                            'vector_score': r['score'],
                            'keyword_score': 0
                        }
            except Exception as e:
                vector_error = str(e)
                import logging
                logging.error(f"向量搜索失败: {e}")

        # 2. 关键词搜索（补充）
        keyword_working = False
        keyword_error = None
        try:
            query_intent = llm_service.parse_query(query)
            keyword_results = memory_service.search(
                query=query,
                intent=query_intent,
                limit=limit * 2
            )
            keyword_working = True

            for memory in keyword_results:
                memory_id = memory['id']
                if memory_id in search_scores:
                    search_scores[memory_id]['keyword_score'] = 0.3
                else:
                    search_scores[memory_id] = {
                        'memory': memory,
                        'vector_score': 0,
                        'keyword_score': 0.5
                    }
        except Exception as e:
            keyword_error = str(e)
            import logging
            logging.error(f"关键词搜索失败: {e}")

        # 3. 计算综合分数并排序
        results = []
        for memory_id, scores in search_scores.items():
            combined_score = scores['vector_score'] * 0.7 + scores['keyword_score'] * 0.3

            if scores['vector_score'] > 0 and scores['keyword_score'] > 0:
                match_type = 'both'
            elif scores['vector_score'] > 0:
                match_type = 'vector'
            else:
                match_type = 'keyword'

            results.append({
                'memory': scores['memory'],
                'score': combined_score,
                'vector_score': scores['vector_score'],
                'keyword_score': scores['keyword_score'],
                'match_type': match_type
            })

        results.sort(key=lambda x: x['score'], reverse=True)
        results = results[:limit]

        # 4. 同时搜索图谱节点（名称匹配）
        matched_nodes = []
        query_lower = query.lower()
        for node_id, node in graph_service.nodes.items():
            node_name = node.get('name', '')
            if query_lower == node_name.lower() or query_lower in node_name.lower():
                matched_nodes.append({
                    'id': node_id,
                    'name': node_name,
                    'type': node.get('type', 'ENTITY'),
                    'description': node.get('description', '')
                })

        matched_nodes = matched_nodes[:limit]

        response_data = {
            'success': True,
            'results': [r['memory'] for r in results],
            'scores': [{'combined': r['score'], 'vector': r['vector_score'], 'keyword': r['keyword_score']} for r in results],
            'match_types': [r['match_type'] for r in results],
            'matched_nodes': matched_nodes,
            'search_info': {
                'vector_enabled': use_vector and vector_working,
                'keyword_enabled': keyword_working,
                'total_results': len(results),
                'matched_nodes_count': len(matched_nodes),
                'query': query
            }
        }

        if vector_error:
            response_data['search_info']['vector_error'] = vector_error
        if keyword_error:
            response_data['search_info']['keyword_error'] = keyword_error

        return jsonify(response_data)

    except Exception as e:
        import logging
        logging.exception(f"搜索记忆失败: {e}")
        return jsonify({'success': False, 'message': f'搜索失败: {str(e)}'})


@memory_bp.route('/<memory_id>', methods=['GET'])
def get_memory(memory_id):
    """获取单个记忆详情"""
    try:
        memory_service = current_app.services.memory_service
        memory = memory_service.get_memory(memory_id)
        if not memory:
            return jsonify({'success': False, 'message': '记忆不存在'})

        return jsonify({
            'success': True,
            'data': memory
        })

    except Exception as e:
        import logging
        logging.exception(f"获取记忆失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@memory_bp.route('/<memory_id>', methods=['DELETE'])
def delete_memory(memory_id):
    """删除记忆"""
    try:
        memory_service = current_app.services.memory_service
        graph_service = current_app.services.graph_service
        embedding_service = current_app.services.embedding_service

        memory_service.delete_memory(memory_id)
        graph_service.remove_memory(memory_id)
        embedding_service.remove_memory(memory_id)

        return jsonify({
            'success': True,
            'message': '记忆已删除'
        })

    except Exception as e:
        import logging
        logging.exception(f"删除记忆失败: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'})


# ========== 以下路由不属于 /api/memory 前缀，放在单独的 blueprint 中 ==========


memories_bp = Blueprint('memories', __name__, url_prefix='/api/memories')


@memories_bp.route('/timeline', methods=['GET'])
def get_timeline():
    """获取时间线数据"""
    try:
        memory_service = current_app.services.memory_service

        start_date = request.args.get('start')
        end_date = request.args.get('end')

        memories = memory_service.get_timeline(
            start_date=start_date,
            end_date=end_date
        )

        return jsonify({
            'success': True,
            'memories': memories
        })

    except Exception as e:
        import logging
        logging.exception(f"获取时间线失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@memories_bp.route('/on-this-day', methods=['GET'])
def get_memories_on_this_day():
    """获取往年今日的记忆，如果没有则随机返回不同的记忆"""
    try:
        import random

        memory_service = current_app.services.memory_service

        today = datetime.now()
        current_year = today.year
        current_month = today.month
        current_day = today.day

        all_memories = memory_service.get_all_memories()

        if not all_memories:
            return jsonify({
                'success': True,
                'data': {
                    'memories': [],
                    'quote': "开始记录你的第一条记忆吧。",
                    'today': today.strftime('%m月%d日'),
                    'count': 0
                }
            })

        on_this_day = []
        other_memories = []

        for memory in all_memories:
            created = memory.get('created_at', '')
            if created:
                try:
                    mem_date = datetime.fromisoformat(created.replace('Z', '+00:00'))
                    days_diff = (today - mem_date).days

                    memory_data = {
                        'memory': memory,
                        'date': mem_date.strftime('%Y年%m月%d日'),
                        'days_diff': days_diff
                    }

                    if (mem_date.month == current_month and
                        mem_date.day == current_day and
                        mem_date.year != current_year):
                        on_this_day.append(memory_data)
                    else:
                        other_memories.append(memory_data)
                except Exception:
                    continue

        if on_this_day:
            on_this_day.sort(key=lambda x: x['days_diff'], reverse=True)
            selected = on_this_day[:3]
            quotes = [
                "这些记忆如同时光的礼物，在今天重新展现。",
                "往年的今天，你留下了这些印记。",
                "时间是个圆，今天你回到了过去的这一天。",
                "特定的日期，特别的回忆。"
            ]
        else:
            random.shuffle(other_memories)
            selected = other_memories[:3]
            quotes = [
                "随机浮现的记忆，恰好是生命的礼物。",
                "这些片段，构成了独一无二的你。",
                "回忆如漫天星辰，随机而美丽。",
                "今天，这些记忆想与你相见。"
            ]

        quote = random.choice(quotes)

        return jsonify({
            'success': True,
            'data': {
                'memories': selected,
                'quote': quote,
                'today': today.strftime('%m月%d日'),
                'count': len(selected),
                'has_on_this_day': len(on_this_day) > 0
            }
        })

    except Exception as e:
        import logging
        logging.exception(f"获取往年今日记忆失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@memories_bp.route('/ai-quote', methods=['POST'])
def generate_ai_quote():
    """为记忆生成AI洛忆的评价和摘要"""
    try:
        llm_service = current_app.services.llm_service

        data = request.json
        memory_content = data.get('content', '')
        days_ago = data.get('days_ago', 365)
        emotion = data.get('emotion', {})

        if not memory_content:
            return jsonify({'success': False, 'message': '记忆内容不能为空'})

        # 构建提示
        emotion_desc = ""
        if emotion:
            valence = emotion.get('valence', 0)
            if valence > 0.3:
                emotion_desc = "当时感觉挺好的"
            elif valence < -0.3:
                emotion_desc = "当时心情不太好"
            else:
                emotion_desc = "当时心情还行"

        content_length = len(memory_content)
        if content_length <= 80:
            summary = memory_content
        else:
            summary = None

        # 根据情绪设定洛忆的回复风格
        valence = emotion.get('valence', 0) if emotion else 0
        if valence > 0.3:
            tone_instruction = """用户当时心情不错。你的回应要偏搞怪、调侃、有趣一点，像个捞天的朋友。
例如："好家伙，这波装到了" "又来？你是不是暗恋人家" "这不给我带点？绝交了"""
        elif valence < -0.3:
            tone_instruction = """用户当时心情不太好。你的回应要偏安慰、共情、温暖，让对方感觉被理解。
例如："抱抱，那时候挺难的吧" "都过去了，你已经很棒了" "我在，想聊的话随时说"""
        else:
            tone_instruction = """用户当时心情比较平静。你的回应要温和、像伙件，像一起慢慢生活的朋友。
例如："这种日子挺好的" "看着就觉得安静" "这样的时光最轻松了"""

        prompt = f"""你是洛忆，用户最好的朋友。看到了用户{days_ago}天前的这条记忆：

{memory_content[:300]}

请返两行结果：

第一行（SUMMARY）：用一句话摘要这条记忆的核心内容，25-35字左右。不要进行价值判断，只说事实。
例如："周末在咖啡店偶遇老同学，聊了很久大学时光" "下雨天一个人在家看电影，很放松的一天"

第二行（QUOTE）：你的回应。不要用大词，不要教育用户，不要超过25字。
{tone_instruction}"""

        response = llm_service.client.chat.completions.create(
            model=llm_service.model_name,
            messages=[
                {"role": "system", "content": "你是洛忆，用户的朋友。你说话直接、真诚，不喜欢用大词。你很会观察细节，总能看到别人看不到的点。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.9,
            max_tokens=150
        )

        result_text = response.choices[0].message.content.strip()

        quote = ""
        if summary is None:
            lines = [line.strip() for line in result_text.split('\n') if line.strip()]
            for line in lines:
                if line.startswith('SUMMARY') or line.startswith('摘要'):
                    summary = line.split('：', 1)[-1].split(':', 1)[-1].strip().strip('"').strip("'")
                elif line.startswith('QUOTE') or line.startswith('回应'):
                    quote = line.split('：', 1)[-1].split(':', 1)[-1].strip().strip('"').strip("'")
            if not quote and result_text:
                quote = result_text.split('\n')[0].strip().strip('"')
            if not summary:
                summary = memory_content[:80] + '...' if len(memory_content) > 80 else memory_content
        else:
            quote = result_text.split('\n')[0].strip().strip('"') if result_text else "这个细节我还记得。"

        return jsonify({
            'success': True,
            'data': {
                'quote': quote,
                'summary': summary
            }
        })

    except Exception as e:
        import logging
        logging.exception(f"生成AI评价失败: {e}")
        return jsonify({
            'success': True,
            'data': {
                'quote': "时间会淡去伤痛，留下的都是成长的印记。"
            }
        })
