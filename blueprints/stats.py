"""
统计路由 Blueprint
包含统计数据获取
"""

from datetime import datetime, timedelta
from flask import Blueprint, jsonify, current_app

stats_bp = Blueprint('stats', __name__)


@stats_bp.route('/api/stats', methods=['GET'])
def get_stats():
    """获取详细统计数据"""
    try:
        memory_service = current_app.services.memory_service
        graph_service = current_app.services.graph_service

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
                except Exception:
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
        import logging
        logging.exception(f"获取统计数据失败: {e}")
        return jsonify({'success': False, 'message': f'获取失败: {str(e)}'})
