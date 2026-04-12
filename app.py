"""
Liora - 个人记忆网络系统
Flask主应用
"""

import os
import json
import uuid
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response
from flask_socketio import SocketIO, emit
from loguru import logger
from dotenv import load_dotenv

from services.llm_service import LLMService
from services.memory_service import MemoryService
from services.graph_service import GraphService
from services.embedding_service import EmbeddingService
from services.temporal_extractor import TemporalExtractor, format_temporal_display
from services.enhanced_knowledge_extractor import EnhancedKnowledgeExtractor

# 初始化时间提取器
temporal_extractor = TemporalExtractor()

# 加载环境变量
load_dotenv()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'liora-secret-key')
socketio = SocketIO(app, cors_allowed_origins="*")

# 初始化服务
llm_service = LLMService()
memory_service = MemoryService()
graph_service = GraphService()
embedding_service = EmbeddingService()

# 初始化增强知识提取器（需要依赖其他服务）
enhanced_extractor = EnhancedKnowledgeExtractor(
    llm_service=llm_service,
    embedding_service=embedding_service,
    memory_service=memory_service
)

# 确保上传目录存在
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)


@app.route('/')
def index():
    """主页 - 知识图谱展示页面"""
    return render_template('index.html')


@app.route('/api/memory/create', methods=['POST'])
def create_memory():
    """
    创建新记忆（手动输入）
    支持文本、图片、音频等多种输入
    """
    try:
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
                file_ext = os.path.splitext(file.filename)[1]
                file_name = f"{uuid.uuid4().hex}{file_ext}"
                file_path = os.path.join(UPLOAD_FOLDER, file_name)
                file.save(file_path)
                logger.info(f"文件已保存: {file_path}")
        
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
        
        # ========== 时间信息提取（多模态） ==========
        socketio.emit('processing_status', {'status': 'processing', 'message': '正在分析时间信息...'})
        temporal_info = temporal_extractor.extract(memory_data)
        
        # 如果置信度低，尝试用LLM增强
        if temporal_info['confidence'] < 0.5:
            temporal_info = temporal_extractor.enhance_with_llm(
                memory_data, 
                {'description': content, 'summary': content}
            )
        
        memory_data['temporal_info'] = temporal_info
        logger.info(f"时间信息: {temporal_info}")
        
        # ========== 合并 LLM 调用：同时理解和抽取知识 ==========
        socketio.emit('processing_status', {'status': 'processing', 'message': 'AI正在分析记忆内容...'})
        logger.info(f"开始处理记忆: {content[:50]}...")

        # 使用单次 LLM 调用完成理解和知识抽取
        extraction_result = llm_service.understand_and_extract(memory_data)
        
        logger.info(f"处理完成: {len(extraction_result.get('entities', []))} 实体, {len(extraction_result.get('relations', []))} 关系")
        
        memory_data['understanding'] = extraction_result.get('understanding', {})
        memory_data['entities'] = extraction_result.get('entities', [])
        memory_data['relations'] = extraction_result.get('relations', [])
        memory_data['emotion'] = extraction_result.get('emotion', {})
        
        # 保存记忆
        logger.info(f"保存记忆: {memory_data['id']}")
        memory_service.save_memory(memory_data)
        logger.info(f"记忆已保存到 memories.json")

        # 更新知识图谱
        logger.info(f"开始更新图谱，实体数: {len(memory_data['entities'])}, 关系数: {len(memory_data['relations'])}")
        graph_service.update_graph(
            entities=memory_data['entities'],
            relations=memory_data['relations'],
            memory_id=memory_data['id'],
            memory_summary=memory_data['understanding'].get('summary', ''),
            temporal_info=memory_data.get('temporal_info')
        )
        logger.info(f"图谱更新完成")

        # 添加向量索引
        try:
            text_for_embedding = memory_data['understanding'].get('description', '') or content
            if text_for_embedding:
                embedding_service.add_memory(memory_data['id'], text_for_embedding)
                logger.info(f"向量索引已添加")
        except Exception as e:
            logger.error(f"添加向量索引失败: {e}")
        
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
        logger.exception(f"创建记忆失败: {e}")
        return jsonify({'success': False, 'message': f'创建失败: {str(e)}'})


@app.route('/api/memory/search', methods=['POST'])
def search_memories():
    """
    搜索记忆
    支持自然语言查询（向量检索 + 关键词匹配）
    """
    try:
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
                # 使用相似度阈值0.5过滤低质量向量匹配
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
                logger.error(f"向量搜索失败: {e}")

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
                    # 已存在向量匹配，累加关键词分数
                    search_scores[memory_id]['keyword_score'] = 0.3  # 关键词匹配基础分
                else:
                    # 新增关键词匹配
                    search_scores[memory_id] = {
                        'memory': memory,
                        'vector_score': 0,
                        'keyword_score': 0.5
                    }
        except Exception as e:
            keyword_error = str(e)
            logger.error(f"关键词搜索失败: {e}")

        # 3. 计算综合分数并排序
        # 加权融合: 向量分数 * 0.7 + 关键词分数 * 0.3
        results = []
        for memory_id, scores in search_scores.items():
            combined_score = scores['vector_score'] * 0.7 + scores['keyword_score'] * 0.3

            # 确定匹配类型
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

        # 按综合分数排序
        results.sort(key=lambda x: x['score'], reverse=True)
        results = results[:limit]

        # 构建返回结果
        response_data = {
            'success': True,
            'results': [r['memory'] for r in results],
            'scores': [{'combined': r['score'], 'vector': r['vector_score'], 'keyword': r['keyword_score']} for r in results],
            'match_types': [r['match_type'] for r in results],
            'search_info': {
                'vector_enabled': use_vector and vector_working,
                'keyword_enabled': keyword_working,
                'total_results': len(results),
                'query': query
            }
        }

        if vector_error:
            response_data['search_info']['vector_error'] = vector_error
        if keyword_error:
            response_data['search_info']['keyword_error'] = keyword_error

        return jsonify(response_data)

    except Exception as e:
        logger.exception(f"搜索记忆失败: {e}")
        return jsonify({'success': False, 'message': f'搜索失败: {str(e)}'})


@app.route('/api/graph/data', methods=['GET'])
def get_graph_data():
    """
    获取知识图谱数据（用于可视化）
    """
    try:
        # 支持按实体类型过滤
        entity_types = request.args.get('types', '').split(',')
        entity_types = [t.strip() for t in entity_types if t.strip()]
        
        # 支持搜索特定实体
        search_entity = request.args.get('entity', '').strip()
        
        graph_data = graph_service.get_graph_data(
            entity_types=entity_types or None,
            center_entity=search_entity or None,
            max_nodes=100
        )
        
        return jsonify({
            'success': True,
            'data': graph_data
        })
        
    except Exception as e:
        logger.exception(f"获取图谱数据失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@app.route('/api/graph/entity/<entity_id>', methods=['GET'])
def get_entity_details(entity_id):
    """
    获取实体详细信息
    """
    try:
        entity = graph_service.get_entity(entity_id)
        related_memories = memory_service.get_memories_by_entity(entity_id)
        
        return jsonify({
            'success': True,
            'entity': entity,
            'related_memories': related_memories
        })
        
    except Exception as e:
        logger.exception(f"获取实体详情失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@app.route('/api/memory/<memory_id>', methods=['GET'])
def get_memory(memory_id):
    """
    获取单个记忆详情
    """
    try:
        memory = memory_service.get_memory(memory_id)
        if not memory:
            return jsonify({'success': False, 'message': '记忆不存在'})
        
        return jsonify({
            'success': True,
            'data': memory
        })
        
    except Exception as e:
        logger.exception(f"获取记忆失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@app.route('/api/memory/<memory_id>', methods=['DELETE'])
def delete_memory(memory_id):
    """
    删除记忆
    """
    try:
        memory_service.delete_memory(memory_id)
        graph_service.remove_memory(memory_id)
        embedding_service.remove_memory(memory_id)

        return jsonify({
            'success': True,
            'message': '记忆已删除'
        })
        
    except Exception as e:
        logger.exception(f"删除记忆失败: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'})


@app.route('/api/memories/timeline', methods=['GET'])
def get_timeline():
    """
    获取时间线数据
    """
    try:
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
        logger.exception(f"获取时间线失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@app.route('/api/config', methods=['GET'])
def get_config():
    """
    获取配置信息（前端用）
    """
    return jsonify({
        'success': True,
        'config': {
            'llm_model': os.getenv('LLM_MODEL_NAME', 'default'),
            'supported_types': ['text', 'image', 'audio', 'video'],
            'max_upload_size': 50 * 1024 * 1024  # 50MB
        }
    })


@app.route('/data/relation_types.json', methods=['GET'])
def get_relation_types():
    """
    获取关系类型映射配置（前端用）
    """
    try:
        relation_types_file = os.path.join(os.path.dirname(__file__), 'data', 'relation_types.json')
        if os.path.exists(relation_types_file):
            with open(relation_types_file, 'r', encoding='utf-8') as f:
                config = json.load(f)
            return jsonify(config)
        else:
            return jsonify({})
    except Exception as e:
        logger.error(f"加载关系类型配置失败: {e}")
        return jsonify({})


@app.route('/api/graph/explore', methods=['POST'])
def explore_node():
    """
    节点探索问答 - 基于节点上下文回答用户问题
    """
    try:
        data = request.json
        question = data.get('question', '')
        node_data = data.get('node', {})
        edge_data = data.get('edge', {})
        chat_history = data.get('history', [])
        
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
        
        # 构建对话历史
        messages = [
            {"role": "system", "content": """
你是 Liora 记忆网络的智能助手。Liora 是一个个人记忆管理系统，用户存储的所有内容都是 TA 的记忆。

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
- 自然、友好、像在与朋友聊天
- 不要机械地重复"根据节点信息"
- 用中文回答
"""}
        ]
        
        # 添加历史对话
        for msg in chat_history[-6:]:  # 只保留最近6轮
            role = "user" if msg.get('role') == 'user' else "assistant"
            messages.append({"role": role, "content": msg.get('content', '')})
        
        # 添加当前问题（带上下文）
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
            max_tokens=800
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
        logger.error(f"节点探索失败: {e}")
        return jsonify({
            'success': False,
            'error': f'处理失败: {str(e)}'
        }), 500


@app.route('/api/graph/node/<node_id>', methods=['PUT'])
def update_node(node_id):
    """
    更新实体信息（限制编辑）
    """
    try:
        data = request.json
        updates = {}
        
        # 只允许修改特定字段
        if 'name' in data:
            updates['name'] = data['name'].strip()
        if 'type' in data:
            if data['type'] in ['PERSON', 'LOCATION', 'EVENT', 'ENTITY']:
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
        logger.exception(f"更新实体失败: {e}")
        return jsonify({'success': False, 'message': f'更新失败: {str(e)}'})


@app.route('/api/graph/edge/<edge_id>', methods=['PUT'])
def update_edge(edge_id):
    """
    更新关系边信息
    """
    try:
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
        logger.exception(f"更新关系失败: {e}")
        return jsonify({'success': False, 'message': f'更新失败: {str(e)}'})


@app.route('/api/graph/edge/<edge_id>', methods=['DELETE'])
def delete_edge(edge_id):
    """
    删除关系边
    """
    try:
        success = graph_service.delete_edge(edge_id)
        
        if success:
            return jsonify({
                'success': True,
                'message': '关系已删除'
            })
        else:
            return jsonify({'success': False, 'message': '关系不存在'})
            
    except Exception as e:
        logger.exception(f"删除关系失败: {e}")
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'})


@app.route('/api/graph/nodes/merge', methods=['POST'])
def merge_nodes():
    """
    合并两个重复实体
    """
    try:
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
        logger.exception(f"合并实体失败: {e}")
        return jsonify({'success': False, 'message': f'合并失败: {str(e)}'})


# Socket.IO 事件处理
@socketio.on('connect')
def handle_connect():
    logger.info(f"客户端已连接: {request.sid}")
    emit('connected', {'message': '已连接到Liora'})


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """
    获取详细统计数据
    """
    try:
        # 获取所有节点和边
        nodes = graph_service.nodes
        edges = graph_service.edges
        memories = memory_service.get_all_memories()
        
        # 实体类型分布
        entity_types = {}
        for node in nodes.values():
            node_type = node.get('type', 'ENTITY')
            entity_types[node_type] = entity_types.get(node_type, 0) + 1
        
        # 关系类型分布
        relation_types = {}
        for edge in edges:
            rel_type = edge.get('type', 'UNKNOWN')
            relation_types[rel_type] = relation_types.get(rel_type, 0) + 1
        
        # 记忆时间分布（近30天）
        from datetime import datetime, timedelta
        today = datetime.now().date()
        daily_stats = {}
        for i in range(30):
            date = today - timedelta(days=i)
            daily_stats[date.isoformat()] = 0
        
        for memory in memories:
            created = memory.get('created_at', '')
            if created:
                try:
                    date = datetime.fromisoformat(created.replace('Z', '+00:00')).date()
                    if date.isoformat() in daily_stats:
                        daily_stats[date.isoformat()] += 1
                except:
                    pass
        
        # 情感分布
        emotion_stats = {'positive': 0, 'neutral': 0, 'negative': 0}
        for memory in memories:
            emotion = memory.get('emotion', {})
            valence = emotion.get('valence', 0)
            if valence > 0.3:
                emotion_stats['positive'] += 1
            elif valence < -0.3:
                emotion_stats['negative'] += 1
            else:
                emotion_stats['neutral'] += 1
        
        # 最活跃实体TOP5
        entity_activity = []
        for node_id, node in nodes.items():
            memory_count = len(memory_service.get_memories_by_entity(node_id))
            entity_activity.append({
                'id': node_id,
                'name': node.get('name', '未知'),
                'type': node.get('type', 'ENTITY'),
                'memory_count': memory_count
            })
        entity_activity.sort(key=lambda x: x['memory_count'], reverse=True)
        top_entities = entity_activity[:5]
        
        return jsonify({
            'success': True,
            'data': {
                'total_nodes': len(nodes),
                'total_edges': len(edges),
                'total_memories': len(memories),
                'entity_types': entity_types,
                'relation_types': relation_types,
                'daily_stats': daily_stats,
                'emotion_stats': emotion_stats,
                'top_entities': top_entities
            }
        })
        
    except Exception as e:
        logger.exception(f"获取统计数据失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@app.route('/api/memories/on-this-day', methods=['GET'])
def get_memories_on_this_day():
    """
    获取往年今日的记忆，如果没有则随机返回不同的记忆
    """
    try:
        from datetime import datetime
        import random
        
        today = datetime.now()
        current_year = today.year
        current_month = today.month
        current_day = today.day
        
        # 获取所有记忆
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
        
        # 筛选往年今日的记忆
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
                    
                    # 检查是否是今天（月日相同）但不是今年
                    if (mem_date.month == current_month and 
                        mem_date.day == current_day and 
                        mem_date.year != current_year):
                        on_this_day.append(memory_data)
                    else:
                        other_memories.append(memory_data)
                except:
                    continue
        
        # 如果有往年今日的记忆，优先展示（最多3条）
        if on_this_day:
            # 按时间排序，随机选取最多3条
            on_this_day.sort(key=lambda x: x['days_diff'], reverse=True)
            selected = on_this_day[:3]
            quotes = [
                "这些记忆如同时光的礼物，在今天重新展现。",
                "往年的今天，你留下了这些印记。",
                "时间是个圆，今天你回到了过去的这一天。",
                "特定的日期，特别的回忆。"
            ]
        else:
            # 没有往年今日的记忆，从其他记忆中随机选择（最多3条）
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
        logger.exception(f"获取往年今日记忆失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})


@app.route('/api/memories/ai-quote', methods=['POST'])
def generate_ai_quote():
    """
    为记忆生成AI洛忆的评价和摘要
    """
    try:
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
        
        # 短记忆直接使用，长记忆需要摘要
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
            tone_instruction = """用户当时心情比较平静。你的回应要温和、伴侣，像一起慢慢生活的朋友。
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
        
        # 解析响应
        quote = ""
        if summary is None:
            # 需要解析AI返回的摘要
            lines = [line.strip() for line in result_text.split('\n') if line.strip()]
            for line in lines:
                if line.startswith('SUMMARY') or line.startswith('摘要'):
                    summary = line.split('：', 1)[-1].split(':', 1)[-1].strip().strip('"').strip("'")
                elif line.startswith('QUOTE') or line.startswith('回应'):
                    quote = line.split('：', 1)[-1].split(':', 1)[-1].strip().strip('"').strip("'")
            # 如果没解析出来，整体当做quote
            if not quote and result_text:
                quote = result_text.split('\n')[0].strip().strip('"')
            if not summary:
                summary = memory_content[:80] + '...' if len(memory_content) > 80 else memory_content
        else:
            # 短记忆，整体当做quote
            quote = result_text.split('\n')[0].strip().strip('"') if result_text else "这个细节我还记得。"
        
        return jsonify({
            'success': True,
            'data': {
                'quote': quote,
                'summary': summary
            }
        })
        
    except Exception as e:
        logger.exception(f"生成AI评价失败: {e}")
        return jsonify({
            'success': True,
            'data': {
                'quote': "时间会淡去伤痛，留下的都是成长的印记。"
            }
        })


@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"客户端已断开: {request.sid}")


if __name__ == '__main__':
    logger.info("启动 Liora 服务器...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
