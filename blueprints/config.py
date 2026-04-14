"""
配置路由 Blueprint
包含主页、配置获取、关系类型配置等路由
"""

import os
import json
from flask import Blueprint, jsonify, render_template

from config.settings import SUPPORTED_MEMORY_TYPES, MAX_UPLOAD_SIZE

config_bp = Blueprint('config', __name__)


@config_bp.route('/')
def index():
    """主页 - 知识图谱展示页面"""
    return render_template('index.html')


@config_bp.route('/api/config', methods=['GET'])
def get_config():
    """获取配置信息（前端用）"""
    import os
    return jsonify({
        'success': True,
        'config': {
            'llm_model': os.getenv('LLM_MODEL_NAME', 'default'),
            'supported_types': SUPPORTED_MEMORY_TYPES,
            'max_upload_size': MAX_UPLOAD_SIZE
        }
    })


@config_bp.route('/data/relation_types.json', methods=['GET'])
def get_relation_types():
    """获取关系类型映射配置（前端用）"""
    try:
        base_dir = os.path.dirname(os.path.dirname(__file__))
        relation_types_file = os.path.join(base_dir, 'data', 'relation_types.json')
        if os.path.exists(relation_types_file):
            with open(relation_types_file, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
            return jsonify(config_data)
        else:
            return jsonify({})
    except Exception as e:
        import logging
        logging.error(f"加载关系类型配置失败: {e}")
        return jsonify({})
