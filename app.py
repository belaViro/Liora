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


# Socket.IO 事件处理
@socketio.on('connect')
def handle_connect():
    logger.info(f"客户端已连接: {request.sid}")
    emit('connected', {'message': '已连接到Liora'})


@socketio.on('disconnect')
def handle_disconnect():
    logger.info(f"客户端已断开: {request.sid}")


if __name__ == '__main__':
    logger.info("启动 Liora 服务器...")
    socketio.run(app, host='0.0.0.0', port=5000, debug=True, allow_unsafe_werkzeug=True)
