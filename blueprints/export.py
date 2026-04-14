"""
导出/导入路由 Blueprint
包含记忆导出和导入功能
"""

from datetime import datetime
from flask import Blueprint, jsonify, request, Response, current_app

export_bp = Blueprint('export', __name__)


@export_bp.route('/api/memories/export', methods=['GET'])
def export_memories():
    """导出全部记忆为 .loyi 文件"""
    try:
        export_service = current_app.services.export_service
        data = export_service.export_all()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'memories_{timestamp}.loyi'
        return Response(
            data,
            mimetype='application/octet-stream',
            headers={'Content-Disposition': f'attachment; filename={filename}'}
        )
    except Exception as e:
        import logging
        logging.exception(f"导出失败: {e}")
        return jsonify({'success': False, 'message': str(e)})


@export_bp.route('/api/memories/import', methods=['POST'])
def import_memories():
    """从 .loyi 文件导入记忆"""
    try:
        export_service = current_app.services.export_service

        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '没有上传文件'})

        file = request.files['file']
        if not file.filename.endswith('.loyi'):
            return jsonify({'success': False, 'message': '文件格式错误，请上传 .loyi 文件'})

        # 读取文件内容
        import io
        file_content = file.read().decode('utf-8')

        # 导入数据
        result = export_service.import_from_file(file_content)

        return jsonify({
            'success': True,
            'message': f'成功导入 {result.get("imported", 0)} 条记忆',
            'data': result
        })

    except Exception as e:
        import logging
        logging.exception(f"导入失败: {e}")
        return jsonify({'success': False, 'message': str(e)})
