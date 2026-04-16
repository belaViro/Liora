"""
记忆路由 Blueprint
简化版：仅保留文件预处理端点，其他功能移至前端 IndexedDB
"""

import os
import uuid
from flask import Blueprint, jsonify, request, current_app

memory_bp = Blueprint('memory', __name__, url_prefix='/api/memory')


@memory_bp.route('/preprocess', methods=['POST'])
def preprocess_file():
    """
    预处理文件：识别类型并提取内容，返回给前端
    注意：不再保存文件到服务器，仅返回提取的内容
    """
    import logging

    if 'file' not in request.files:
        return jsonify({'success': False, 'message': '没有文件'})

    file = request.files['file']
    if not file.filename:
        return jsonify({'success': False, 'message': '文件名为空'})

    # 自动识别类型
    file_ext = os.path.splitext(file.filename)[1].lower().strip('.')
    mime = file.content_type.lower()

    if mime.startswith('image/') or file_ext in ['jpg','jpeg','png','gif','webp','bmp']:
        memory_type = 'image'
    elif mime.startswith('audio/') or file_ext in ['mp3','wav','ogg','m4a','flac','aac']:
        memory_type = 'audio'
    elif mime.startswith('video/') or file_ext in ['mp4','avi','mov','mkv','webm']:
        memory_type = 'video'
    else:
        memory_type = 'text'

    content = ''
    llm_service = current_app.services.llm_service

    if memory_type == 'image':
        logging.info(f"预处理图片（不保存）")
        try:
            # 保存到临时文件进行图片理解
            from config.settings import UPLOAD_FOLDER
            temp_name = f"temp_{uuid.uuid4().hex}.{file_ext}"
            temp_path = os.path.join(UPLOAD_FOLDER, 'temp', temp_name)
            os.makedirs(os.path.dirname(temp_path), exist_ok=True)
            file.save(temp_path)

            content = llm_service.describe_image(temp_path)
            logging.info(f"图片描述完成: {content[:50]}...")

            # 删除临时文件
            try:
                os.remove(temp_path)
            except Exception:
                pass
        except Exception as e:
            logging.error(f"图片理解失败: {e}")

    elif memory_type == 'audio':
        logging.info(f"预处理音频（不保存）")
        try:
            # 保存到临时文件进行音频转写
            from config.settings import UPLOAD_FOLDER
            temp_name = f"temp_{uuid.uuid4().hex}.{file_ext}"
            temp_path = os.path.join(UPLOAD_FOLDER, 'temp', temp_name)
            os.makedirs(os.path.dirname(temp_path), exist_ok=True)
            file.save(temp_path)

            content = llm_service.transcribe_audio(temp_path)
            logging.info(f"音频转写完成: {content[:50]}...")

            # 删除临时文件
            try:
                os.remove(temp_path)
            except Exception:
                pass
        except Exception as e:
            logging.error(f"音频转写失败: {e}")

    # 返回提取的内容（不保存文件）
    return jsonify({
        'success': True,
        'data': {
            'type': memory_type,
            'content': content,
            'ext': file_ext
        }
    })


# ========== 以下路由已移至前端 IndexedDB ==========
# - POST /api/memory/create → 前端 db.saveMemory()
# - POST /api/memory/search → 前端 memoryService.searchMemories()
# - GET /api/memory/<id> → 前端 db.getMemory()
# - DELETE /api/memory/<id> → 前端 db.deleteMemory()
# - GET /api/memories/timeline → 前端 db.getTimeline()
# - GET /api/memories/on-this-day → 前端 db.getOnThisDay()


memories_bp = Blueprint('memories', __name__, url_prefix='/api/memories')


@memories_bp.route('/ai-quote', methods=['POST'])
def generate_ai_quote():
    """
    为记忆生成AI洛忆的评价和摘要
    注意：记忆数据由客户端传入，不读取服务器存储
    """
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
            tone_instruction = """用户当时心情不错。你的回应要偏搞怪、调侃、有趣一点,像个损天的朋友。
例如:"好家伙,这波装到了" "又来?你是不是暗恋人家" "这不给我带点?绝交了"""
        elif valence < -0.3:
            tone_instruction = """用户当时心情不太好。你的回应要偏安慰、共情、温暖,让对方感觉被理解。
例如:"抱抱,那时候挺难的吧" "都过去了,你已经很棒了" "我在,想聊的话随时说"""
        else:
            tone_instruction = """用户当时心情比较平静。你的回应要温和、像伙伴,像一起慢慢生活的朋友。
例如:"这种日子挺好的" "看着就觉得安静" "这样的时光最轻松了"""

        prompt = f"""你是洛忆，用户最好的朋友。看到了用户{days_ago}天前的这条记忆：

{memory_content[:300]}

请返两行结果：

第一行(SUMMARY)：用一句话摘要这条记忆的核心内容，25-35字左右。不要进行价值判断，只说事实。
例如："周末在咖啡店偶遇老同学，聊了很久大学时光" "下雨天一个人在家看电影，很放松的一天"

第二行(QUOTE)：你的回应。不要用大词，不要教育用户，不要超过25字。
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
