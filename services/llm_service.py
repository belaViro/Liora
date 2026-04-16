"""
大模型服务 - 处理多模态数据理解和知识抽取
支持 MiniMax / OpenAI / 智谱AI 等兼容 OpenAI 格式的 API
"""

import os
import json
import base64
from typing import Dict, List, Any
from openai import OpenAI
from loguru import logger


class LLMService:
    """大模型服务类"""
    
    def __init__(self):
        self.api_key = os.getenv('LLM_API_KEY')
        self.base_url = os.getenv('LLM_BASE_URL', 'https://api.minimaxi.chat/v1')
        self.model_name = os.getenv('LLM_MODEL_NAME', 'minimax-text-01')
        
        # Whisper 配置（用于语音转文本）
        self.whisper_key = os.getenv('WHISPER_API_KEY', self.api_key)
        self.whisper_url = os.getenv('WHISPER_BASE_URL', self.base_url)
        self.whisper_model = os.getenv('WHISPER_MODEL_NAME', 'whisper-1')

        # 视觉模型配置（用于图像理解）
        self.vision_model = os.getenv('VISION_MODEL_NAME', 'Qwen/Qwen2.5-VL-32B-Instruct')
        
        # 初始化客户端
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )
        
        # 为语音转文本单独初始化（可能使用不同服务商）
        if self.whisper_key != self.api_key or self.whisper_url != self.base_url:
            self.whisper_client = OpenAI(
                api_key=self.whisper_key,
                base_url=self.whisper_url
            )
        else:
            self.whisper_client = self.client
        
        # 检测服务商类型
        self.provider = self._detect_provider()
        
        logger.info(f"LLM服务初始化完成")
        logger.info(f"  服务商: {self.provider}")
        logger.info(f"  模型: {self.model_name}")
        logger.info(f"  Base URL: {self.base_url}")
    
    def _detect_provider(self) -> str:
        """检测服务商类型"""
        url = self.base_url.lower()
        if 'minimaxi' in url:
            return 'MiniMax'
        elif 'openai' in url:
            return 'OpenAI'
        elif 'bigmodel' in url or 'zhipu' in url:
            return '智谱AI'
        elif 'baidu' in url or 'qianfan' in url:
            return '百度文心'
        else:
            return '自定义'
    
    def understand_and_extract(self, memory_data: Dict) -> Dict[str, Any]:
        """
        合并理解和知识抽取为单次 LLM 调用（丰富版）
        """
        text = memory_data.get('content', '')
        
        # 使用文件读取方式避免字符串转义问题
        prompt = self._build_rich_prompt(text)
        
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": "你是专业的记忆分析和知识图谱专家。请深度分析内容，抽取丰富的实体和关系。确保返回合法的JSON格式。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.3
            )
            
            content = response.choices[0].message.content
            
            # 解析 JSON
            try:
                result = json.loads(content)
            except json.JSONDecodeError:
                json_str = self._extract_json(content)
                result = json.loads(json_str)
            
            # 确保所有字段存在
            if 'understanding' not in result:
                result['understanding'] = {
                    'description': text[:100], 
                    'summary': text[:50], 
                    'keywords': [], 
                    'persons': [], 
                    'locations': [], 
                    'events': [], 
                    'emotion': {'valence': 0, 'arousal': 0.5, 'dominant_emotion': '中性'}, 
                    'topics': []
                }
            if 'entities' not in result:
                result['entities'] = []
            if 'relations' not in result:
                result['relations'] = []
            if 'emotion' not in result:
                result['emotion'] = result['understanding'].get('emotion', {'valence': 0, 'arousal': 0.5, 'dominant_emotion': '中性'})
            
            # 确保 understanding 包含必要字段
            understanding = result['understanding']
            if 'description' not in understanding:
                understanding['description'] = text[:100]
            if 'summary' not in understanding:
                understanding['summary'] = text[:50]
            if 'keywords' not in understanding:
                understanding['keywords'] = []
            if 'persons' not in understanding:
                understanding['persons'] = []
            if 'locations' not in understanding:
                understanding['locations'] = []
            if 'events' not in understanding:
                understanding['events'] = []
            if 'topics' not in understanding:
                understanding['topics'] = []
            
            logger.info(f"抽取完成: {len(result['entities'])} 实体, {len(result['relations'])} 关系")
            
            return result
            
        except Exception as e:
            logger.error(f"合并处理失败: {e}")
            # 降级：返回基础结果
            content = memory_data.get('content', '')
            return {
                'understanding': {
                    'description': content[:100] if content else '无内容',
                    'summary': content[:50] if content else '',
                    'keywords': [],
                    'persons': [],
                    'locations': [],
                    'events': [],
                    'topics': [],
                    'emotion': {'valence': 0, 'arousal': 0.5, 'dominant_emotion': '中性'}
                },
                'entities': [],
                'relations': [],
                'emotion': {'valence': 0, 'arousal': 0.5, 'dominant_emotion': '中性'}
            }
    
    def _build_rich_prompt(self, text: str) -> str:
        """构建丰富的 Prompt"""
        truncated = text[:2000] if len(text) > 2000 else text
        
        lines = [
            "你是一个专业的记忆分析和知识图谱抽取专家。请深度分析以下记忆内容。",
            "",
            "## 记忆内容",
            truncated,
            "",
            "## 任务要求",
            "",
            "### 1. 理解分析",
            "提取核心内容、关键词、人物、地点、事件、情感等丰富信息。",
            "",
            "### 2. 实体抽取（至少10-15个）",
            "必须覆盖所有提到的人物、地点、组织、事件、物品、概念和情感。特别注意：如果文本中包含情感描述（如孤独、喜悦、愧疚、怀念等），必须将情感作为 EMOTION 类型实体抽取，并与相关人物/事件建立关系。",
            "每个实体包含：id(英文小写下划线)、name(原名)、type(PERSON/LOCATION/EVENT/OBJECT/CONCEPT/EMOTION)、description、attributes(属性字典)、aliases(别名列表)。",
            "",
            "### 3. 关系抽取（至少15-20条）",
            "尽可能丰富地抽取实体间的关系：",
            "- 家族关系、朋友、同事、领导、下属",
            "- 位于、居住于、出生于、工作于",
            "- 发生于、参与、导致、起因",
            "- 关联、相关、属于、包含、拥有",
            "- 同一时间/地点共现的隐含关系",
            "",
            "每条关系包含：source(源ID)、target(目标ID)、type(中文关系名)、description、fact(关系陈述句)、confidence(0-1)。",
            "",
            "**重要**：关系 type 必须使用中文！",
            "",
            "## 输出格式（合法JSON）",
            '{',
            '    "understanding": {',
            '        "description": "详细描述（100-300字）",',
            '        "summary": "一句话概括",',
            '        "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5"],',
            '        "persons": ["人物1", "人物2", "人物3", "人物4", "人物5"],',
            '        "locations": ["地点1", "地点2", "地点3"],',
            '        "events": ["事件1", "事件2", "事件3"],',
            '        "emotion": {"valence": 0.5, "arousal": 0.5, "dominant_emotion": "主导情感"},',
            '        "topics": ["主题1", "主题2"]',
            '    },',
            '    "entities": [',
            '        {"id": "zhang_san", "name": "张三", "type": "PERSON", "description": "...", "attributes": {}, "aliases": []}',
            '        {"id": "gu_du", "name": "孤独", "type": "EMOTION", "description": "...", "attributes": {}, "aliases": []}',
            '    ],',
            '    "relations": [',
            '        {"source": "zhang_san", "target": "li_si", "type": "朋友", "description": "...", "fact": "张三是李四的朋友", "confidence": 0.8}',
            '    ],',
            '    "emotion": {"valence": 0.5, "arousal": 0.5, "dominant_emotion": "中性"}',
            '}',
            "",
            "## 重要规则",
            "1. **至少10-15个实体**，不要遗漏任何提到的人、地点、事件",
            "2. **至少15-20条关系**，每对实体间可以有多种关系",
            "3. 充分利用文本中的隐含关系进行推断",
            "4. 关系 type 必须使用中文",
            "5. fact 字段用一句话陈述关系事实",
            "6. 确保返回合法的完整JSON格式"
        ]
        
        return '\n'.join(lines)

    def _extract_json(self, text: str) -> str:
        """从文本中提取 JSON 部分"""
        import re
        
        # 尝试匹配 ```json ... ``` 格式
        json_match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if json_match:
            return json_match.group(1)
        
        # 尝试匹配 ``` ... ``` 格式
        json_match = re.search(r'```\s*(.*?)\s*```', text, re.DOTALL)
        if json_match:
            return json_match.group(1)
        
        # 尝试匹配 { ... } 格式
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            return json_match.group(0)
        
        # 如果都没匹配到，返回原文
        return text

    def understand_memory(self, memory_data: Dict) -> Dict[str, Any]:
        """保留此方法用于兼容性"""
        result = self.understand_and_extract(memory_data)
        return result.get('understanding', {})

    def extract_knowledge(self, memory_data: Dict) -> Dict[str, Any]:
        """保留此方法用于兼容性"""
        result = self.understand_and_extract(memory_data)
        return {
            'entities': result.get('entities', []),
            'relations': result.get('relations', []),
            'emotion': result.get('emotion', {})
        }

    def parse_query(self, query: str) -> Dict[str, Any]:
        """
        解析搜索查询意图
        
        Args:
            query: 用户搜索查询
            
        Returns:
            查询意图字典，包含 keywords, entities, time_range, emotion_filter
        """
        import re
        
        # 简单的规则解析
        keywords = []
        entities = []
        time_range = {}
        emotion_filter = 'any'
        
        # 提取引号中的内容作为实体或关键词
        quoted = re.findall(r'["\']([^"\']+)["\']', query)
        for q in quoted:
            entities.append(q)
            keywords.append(q)
        
        # 提取时间相关词
        time_patterns = [
            r'(\d{4})年',
            r'(\d{4})-(\d{2})',
            r'(\d{4})-(\d{2})-(\d{2})',
            r'(最近|上周|昨天|今天|明天|去年|明年)',
        ]
        for pattern in time_patterns:
            matches = re.findall(pattern, query)
            if matches:
                time_range['mentions'] = matches
        
        # 分词获取关键词（简单实现）
        words = re.findall(r'[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}', query)
        for word in words:
            if word not in keywords and len(word) >= 2:
                keywords.append(word)
        
        # 如果没有提取到关键词，使用整个查询
        if not keywords and query:
            keywords = [query]
        
        return {
            'keywords': keywords,
            'entities': entities,
            'time_range': time_range,
            'emotion_filter': emotion_filter
        }

    def describe_image(self, file_path: str, prompt: str = "详细描述这张图片的内容") -> str:
        """
        用视觉模型描述图像内容

        Args:
            file_path: 图片文件路径
            prompt: 描述提示词

        Returns:
            图像描述文本
        """
        try:
            with open(file_path, 'rb') as f:
                img_data = base64.b64encode(f.read()).decode('utf-8')

            ext = os.path.splitext(file_path)[1].lower().strip('.')
            mime_map = {'jpg': 'jpeg', 'jpeg': 'jpeg', 'png': 'png', 'gif': 'gif', 'webp': 'webp', 'bmp': 'bmp'}
            mime = mime_map.get(ext, 'png')

            response = self.client.chat.completions.create(
                model=self.vision_model,
                messages=[{
                    'role': 'user',
                    'content': [
                        {'type': 'image_url', 'image_url': {'url': f'data:image/{mime};base64,{img_data}'}},
                        {'type': 'text', 'text': prompt}
                    ]
                }],
                max_tokens=512,
                temperature=0.1
            )

            description = response.choices[0].message.content
            logger.info(f"图像描述完成: {description[:50]}...")
            return description

        except Exception as e:
            logger.error(f"图像描述失败: {e}")
            return ""

    def transcribe_audio(self, file_path: str) -> str:
        """
        用 Whisper 模型转写音频为文字

        Args:
            file_path: 音频文件路径

        Returns:
            转写文本
        """
        try:
            with open(file_path, 'rb') as f:
                audio_data = f.read()

            response = self.whisper_client.audio.transcriptions.create(
                model=self.whisper_model,
                file=('audio.mp3', audio_data)
            )
            # SenseVoice API 返回 JSON 格式，手动提取 text 字段
            text = response.text if hasattr(response, 'text') else str(response)
            logger.info(f"音频转写完成: {text[:50]}...")
            return text

        except Exception as e:
            logger.error(f"音频转写失败: {e}")
            return ""
