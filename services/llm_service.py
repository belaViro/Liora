"""
大模型服务 - 处理多模态数据理解和知识抽取
支持 MiniMax / OpenAI / 智谱AI / 硅基流动 / DeepSeek 等 OpenAI-compatible API

使用策略：
  1. 优先使用 LangChain + Pydantic tool-use 进行结构化输出
  2. 当三方聚合网关不支持/不透传 tool_calls 时，降级到 JSON Prompt + Pydantic 校验
"""

import base64
import json
import os
import time
from typing import Any, Dict, Optional

import httpx

from langchain_openai import ChatOpenAI
from loguru import logger
from openai import OpenAI

from services.extraction_schema import (
    EXTRACTION_TOOL_NAME,
    ExtractMemoryStructure,
    default_extraction_result,
    normalize_extraction_result,
)


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

        # 结构化抽取配置。三方聚合网关如果不支持强制 tool_choice，可设置为 auto。
        self.extraction_max_chars = int(os.getenv('LLM_EXTRACTION_MAX_CHARS', '4000'))
        self.extraction_max_output_tokens = int(os.getenv('LLM_EXTRACTION_MAX_TOKENS', '1800'))
        self.extraction_compact_prompt = os.getenv('LLM_EXTRACTION_COMPACT_PROMPT', 'true').lower() in {'1', 'true', 'yes', 'on'}
        self.extraction_mode = os.getenv('LLM_EXTRACTION_MODE', 'tool_first').lower()
        self.extraction_tool_choice = os.getenv('LLM_EXTRACTION_TOOL_CHOICE', 'auto')
        self.temperature = float(os.getenv('LLM_TEMPERATURE', '0.2'))
        self.request_timeout = float(os.getenv('LLM_TIMEOUT', '60'))
        self.trust_env_proxy = os.getenv('LLM_TRUST_ENV_PROXY', 'false').lower() in {'1', 'true', 'yes', 'on'}

        # 原生 OpenAI-compatible 客户端：保留给 embedding、vision、audio 和其他现有端点使用。
        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url,
            timeout=self.request_timeout,
            http_client=httpx.Client(trust_env=self.trust_env_proxy, timeout=self.request_timeout),
        )

        # LangChain ChatModel：只用于 Pydantic tool-use / structured extraction。
        self.langchain_llm = ChatOpenAI(
            model=self.model_name,
            api_key=self.api_key,
            base_url=self.base_url,
            temperature=self.temperature,
            timeout=self.request_timeout,
            max_tokens=self.extraction_max_output_tokens,
            max_retries=int(os.getenv('LLM_MAX_RETRIES', '1')),
            http_client=httpx.Client(trust_env=self.trust_env_proxy, timeout=self.request_timeout),
        )
        self.extraction_llm = self._build_extraction_llm()

        # 为语音转文本单独初始化（可能使用不同服务商）
        if self.whisper_key != self.api_key or self.whisper_url != self.base_url:
            self.whisper_client = OpenAI(
                api_key=self.whisper_key,
                base_url=self.whisper_url,
                timeout=self.request_timeout,
                http_client=httpx.Client(trust_env=self.trust_env_proxy, timeout=self.request_timeout),
            )
        else:
            self.whisper_client = self.client

        # 检测服务商类型
        self.provider = self._detect_provider()

        logger.info("LLM服务初始化完成")
        logger.info(f"  服务商: {self.provider}")
        logger.info(f"  模型: {self.model_name}")
        logger.info(f"  Base URL: {self.base_url}")
        logger.info(f"  结构化抽取: {self.extraction_mode} ({self.extraction_tool_choice})")
        logger.info(f"  抽取输出上限: {self.extraction_max_output_tokens} tokens")
        logger.info(f"  环境代理: {'enabled' if self.trust_env_proxy else 'disabled'}")

    def _detect_provider(self) -> str:
        """检测服务商类型"""
        url = self.base_url.lower()
        model = self.model_name.lower()
        if 'siliconflow' in url:
            return '硅基流动'
        if 'deepseek' in url or 'deepseek' in model:
            return 'DeepSeek'
        if 'minimaxi' in url:
            return 'MiniMax'
        if 'openai' in url:
            return 'OpenAI'
        if 'bigmodel' in url or 'zhipu' in url:
            return '智谱AI'
        if 'baidu' in url or 'qianfan' in url:
            return '百度文心'
        return '自定义'

    def understand_and_extract(self, memory_data: Dict) -> Dict[str, Any]:
        """
        合并理解和知识抽取为单次 LLM 调用。

        优先使用 LangChain bind_tools(PydanticModel)。如果三方聚合网关不支持
        tools/tool_choice 或没有透传 tool_calls，则自动降级到 JSON Prompt。
        两条路径最终都走 Pydantic 规范化，保持前端数据契约不变。
        """
        text = memory_data.get('content', '')

        errors = []
        strategies = (
            (('tool-use', self._extract_with_tool_use), ('json-fallback', self._extract_with_json_prompt))
            if self.extraction_mode == 'tool_first'
            else (('json', self._extract_with_json_prompt), ('tool-fallback', self._extract_with_tool_use))
        )

        for mode, extractor in strategies:
            start = time.perf_counter()
            try:
                result = extractor(text)
                result['success'] = True
                result['extraction_mode'] = mode
                self._log_extraction_result(result, mode, time.perf_counter() - start)
                return result
            except Exception as e:
                elapsed = time.perf_counter() - start
                errors.append(f'{mode}: {e}')
                logger.warning(f"{mode} 抽取失败({elapsed:.2f}s): {e}")

        logger.error(f"合并处理失败: {'; '.join(errors)}")
        result = default_extraction_result(text)
        result['success'] = False
        result['error'] = '; '.join(errors)
        result['extraction_mode'] = 'failed'
        return result

    def _build_extraction_llm(self):
        """构建绑定 Pydantic 工具的 LangChain ChatModel。"""
        tool_choice = (self.extraction_tool_choice or '').strip()
        bind_kwargs: Dict[str, Any] = {}
        if tool_choice:
            bind_kwargs['tool_choice'] = tool_choice
        return self.langchain_llm.bind_tools([ExtractMemoryStructure], **bind_kwargs)

    def _extract_with_tool_use(self, text: str) -> Dict[str, Any]:
        """通过 LangChain tool-use 抽取结构化记忆。"""
        messages = [
            (
                'system',
                (
                    '你是专业的记忆分析和知识图谱专家。'
                    f'必须调用 {EXTRACTION_TOOL_NAME} 工具返回结构化结果，'
                    '不要用普通文本回答。'
                ),
            ),
            ('human', self._build_tool_prompt(text)),
        ]
        message = self.extraction_llm.invoke(messages)
        payload = self._extract_tool_payload(message)
        if payload is None:
            content = self._message_content_to_text(message)
            raise ValueError(f"模型未返回 tool_calls，content={content[:200]}")
        result = normalize_extraction_result(payload, text)
        self._ensure_extraction_has_graph(result, 'tool-use')
        return result

    def _extract_with_json_prompt(self, text: str) -> Dict[str, Any]:
        """网关不支持 tool-use 时的兼容路径，仍使用 Pydantic 规范化结果。"""
        messages = [
            (
                'system',
                '你是专业的记忆分析和知识图谱专家。请深度分析内容，且只返回一个合法 JSON 对象。',
            ),
            ('human', self._build_json_prompt(text)),
        ]
        message = self.langchain_llm.invoke(messages)
        content = self._message_content_to_text(message)
        try:
            payload = json.loads(content)
        except json.JSONDecodeError:
            payload = json.loads(self._extract_json(content))
        result = normalize_extraction_result(payload, text)
        return result

    def _ensure_extraction_has_graph(self, result: Dict[str, Any], mode: str) -> None:
        if not result.get('entities') or not result.get('relations'):
            raise ValueError(f"{mode} returned no entities or relations")

    def _extract_tool_payload(self, message: Any) -> Optional[Dict[str, Any]]:
        """兼容 LangChain 标准 tool_calls 和部分 OpenAI-compatible 原始返回。"""
        tool_calls = getattr(message, 'tool_calls', None) or []
        payload = self._extract_payload_from_tool_calls(tool_calls)
        if payload is not None:
            return payload

        additional_kwargs = getattr(message, 'additional_kwargs', None) or {}
        raw_tool_calls = additional_kwargs.get('tool_calls') or []
        payload = self._extract_payload_from_tool_calls(raw_tool_calls)
        if payload is not None:
            return payload

        function_call = additional_kwargs.get('function_call')
        if isinstance(function_call, dict):
            return self._parse_tool_args(function_call.get('arguments'))

        return None

    def _extract_payload_from_tool_calls(self, tool_calls: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(tool_calls, list):
            return None

        for tool_call in tool_calls:
            if not isinstance(tool_call, dict):
                continue

            name = tool_call.get('name')
            args = tool_call.get('args')

            raw_function = tool_call.get('function')
            if isinstance(raw_function, dict):
                name = name or raw_function.get('name')
                args = args if args is not None else raw_function.get('arguments')

            if name and name != EXTRACTION_TOOL_NAME:
                continue

            payload = self._parse_tool_args(args)
            if payload is not None:
                return payload

        return None

    def _parse_tool_args(self, args: Any) -> Optional[Dict[str, Any]]:
        if isinstance(args, dict):
            return args
        if isinstance(args, str) and args.strip():
            return json.loads(args)
        return None

    def _message_content_to_text(self, message: Any) -> str:
        content = getattr(message, 'content', '')
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict):
                    parts.append(str(block.get('text') or block.get('content') or ''))
            return '\n'.join(part for part in parts if part).strip()
        return str(content).strip()

    def _log_extraction_result(self, result: Dict[str, Any], mode: str, elapsed: Optional[float] = None) -> None:
        elapsed_text = f", {elapsed:.2f}s" if elapsed is not None else ""
        logger.info(
            f"抽取完成({mode}{elapsed_text}): {len(result.get('entities', []))} 实体, "
            f"{len(result.get('relations', []))} 关系"
        )

    def _build_extraction_guidance(self, text: str) -> Dict[str, Any]:
        """按内容长度动态调整抽取数量要求。"""
        text_len = len(text)
        if text_len < 100:
            guidance = {
                'min_entities': 3,
                'max_entities': 6,
                'min_relations': 3,
                'max_relations': 8,
                'entity_desc': '抽取核心实体即可',
            }
        elif text_len < 300:
            guidance = {
                'min_entities': 5,
                'max_entities': 10,
                'min_relations': 5,
                'max_relations': 12,
                'entity_desc': '覆盖主要人物、地点、事件',
            }
        elif text_len < 500:
            guidance = {
                'min_entities': 8,
                'max_entities': 14,
                'min_relations': 10,
                'max_relations': 18,
                'entity_desc': '覆盖所有提到的人物、地点、事件、情感',
            }
        else:
            guidance = {
                'min_entities': 10,
                'max_entities': 18,
                'min_relations': 15,
                'max_relations': 25,
                'entity_desc': '覆盖重要的人、地点、事件、情感',
            }

        return guidance

    def _build_tool_prompt(self, text: str) -> str:
        """构建 tool-use 路径的轻量提示词。"""
        truncated = text[:self.extraction_max_chars]
        guidance = self._build_extraction_guidance(text)
        return '\n'.join([
            '请分析以下记忆内容，并通过工具返回结构化结果。',
            '',
            '## 记忆内容',
            truncated,
            '',
            '## 抽取要求',
            '1. 生成简短 description、summary、keywords、persons、locations、events、topics 和 emotion。',
            (
                f"2. 实体最多 {guidance['max_entities']} 个："
                f"{guidance['entity_desc']}。如果文本中包含孤独、喜悦、愧疚、怀念等情感，"
                '必须将情感作为 EMOTION 类型实体。'
            ),
            (
                f"3. 关系最多 {guidance['max_relations']} 条，"
                '覆盖亲属、朋友、同事、地点、参与、导致、属于、共现等显式或合理隐含关系。'
            ),
            '4. 实体 type 只能使用 PERSON/LOCATION/EVENT/OBJECT/CONCEPT/EMOTION。',
            '5. 关系 type 使用中文，fact 用一句中文陈述关系事实，confidence 为 0 到 1。',
            '6. source/target 必须引用 entities 中实际存在的实体 id。',
        ])

    def _build_json_prompt(self, text: str) -> str:
        """构建 JSON 降级路径的提示词。"""
        tool_prompt = self._build_tool_prompt(text)
        if self.extraction_compact_prompt:
            return tool_prompt + '\n\n' + '\n'.join([
                '## 输出格式',
                '只返回合法 JSON，不要 Markdown，不要解释。',
                '结构字段：',
                '- understanding: {description, summary, keywords[], persons[], locations[], events[], topics[], emotion:{valence, arousal, dominant_emotion}}',
                '- entities[]: {id, name, type(PERSON/LOCATION/EVENT/OBJECT/CONCEPT/EMOTION), description, attributes{}, aliases[]}',
                '- relations[]: {source, target, type(中文), description, fact, confidence(0-1)}',
                '- emotion: {valence(-1~1), arousal(0~1), dominant_emotion}',
            ])

        return tool_prompt + '\n\n' + '\n'.join([
            '## 输出格式',
            '只返回合法 JSON，不要 Markdown，不要解释。结构如下：',
            '{',
            '  "understanding": {',
            '    "description": "简短描述",',
            '    "summary": "一句话概括",',
            '    "keywords": ["关键词"],',
            '    "persons": ["人物"],',
            '    "locations": ["地点"],',
            '    "events": ["事件"],',
            '    "emotion": {"valence": 0, "arousal": 0.5, "dominant_emotion": "中性"},',
            '    "topics": ["主题"]',
            '  },',
            '  "entities": [',
            '    {"id": "zhang_san", "name": "张三", "type": "PERSON", "description": "...", "attributes": {}, "aliases": []}',
            '  ],',
            '  "relations": [',
            '    {"source": "zhang_san", "target": "li_si", "type": "朋友", "description": "...", "fact": "张三是李四的朋友", "confidence": 0.8}',
            '  ],',
            '  "emotion": {"valence": 0, "arousal": 0.5, "dominant_emotion": "中性"}',
            '}',
        ])

    def _extract_json(self, text: str) -> str:
        """从文本中提取 JSON 部分"""
        import re

        json_match = re.search(r'```json\s*(.*?)\s*```', text, re.DOTALL)
        if json_match:
            return json_match.group(1)

        json_match = re.search(r'```\s*(.*?)\s*```', text, re.DOTALL)
        if json_match:
            return json_match.group(1)

        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            return json_match.group(0)

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

        keywords = []
        entities = []
        time_range = {}
        emotion_filter = 'any'

        quoted = re.findall(r'["\']([^"\']+)["\']', query)
        for q in quoted:
            entities.append(q)
            keywords.append(q)

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

        words = re.findall(r'[\u4e00-\u9fa5]{2,}|[a-zA-Z]{3,}', query)
        for word in words:
            if word not in keywords and len(word) >= 2:
                keywords.append(word)

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
            text = response.text if hasattr(response, 'text') else str(response)
            logger.info(f"音频转写完成: {text[:50]}...")
            return text

        except Exception as e:
            logger.error(f"音频转写失败: {e}")
            return ""


