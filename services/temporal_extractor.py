"""
时间信息提取器 - 处理多模态数据的时间推断
"""

import os
import re
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, Tuple
from loguru import logger


class TemporalExtractor:
    """多模态时间提取器"""
    
    def __init__(self):
        self.time_patterns = {
            'year': r'(\d{4})[年/-]',
            'month': r'(\d{1,2})[月/-]',
            'date': r'(\d{4}[年/-]\d{1,2}[月/-]\d{1,2})[日]?',
            'relative': r'(去年|今年|明年|上个月|这个月|下个月|上周|这周|下周|昨天|今天|明天)',
            'season': r'(春天|夏天|秋天|冬天|春季|夏季|秋季|冬季)',
            'time_of_day': r'(早上|上午|中午|下午|晚上|凌晨|傍晚)'
        }
    
    def extract(self, memory_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        提取时间信息（多模态）
        
        Args:
            memory_data: 记忆数据，包含type, content, file_path等
            
        Returns:
            时间信息字典
        """
        memory_type = memory_data.get('type', 'text')
        file_path = memory_data.get('file_path')
        content = memory_data.get('content', '')
        
        # 1. 尝试提取精确时间（元数据）
        exact_time = self._extract_exact_time(memory_type, file_path)
        if exact_time:
            return {
                'type': 'exact',
                'datetime': exact_time,
                'confidence': 0.95,
                'source': 'metadata'
            }
        
        # 2. 从内容提取时间线索
        if memory_type == 'text':
            return self._extract_from_text(content)
        elif memory_type == 'image':
            return self._extract_from_image(file_path, content)
        elif memory_type == 'audio':
            return self._extract_from_audio(file_path, content)
        
        # 3. 返回模糊时间（未知）
        return {
            'type': 'unknown',
            'description': '时间未知',
            'confidence': 0.0,
            'upload_time': datetime.now().isoformat()
        }
    
    def _extract_exact_time(self, memory_type: str, file_path: Optional[str]) -> Optional[str]:
        """提取精确时间（元数据）"""
        if not file_path or not os.path.exists(file_path):
            return None
        
        try:
            if memory_type == 'image':
                return self._extract_exif_datetime(file_path)
            elif memory_type in ['audio', 'video']:
                return self._extract_media_metadata(file_path)
            else:
                # 文件修改时间（最不可靠，但备用）
                mtime = os.path.getmtime(file_path)
                return datetime.fromtimestamp(mtime).isoformat()
        except Exception as e:
            logger.warning(f"提取元数据时间失败: {e}")
            return None
    
    def _extract_exif_datetime(self, file_path: str) -> Optional[str]:
        """提取图片EXIF时间"""
        try:
            from PIL import Image
            from PIL.ExifTags import TAGS
            
            image = Image.open(file_path)
            exif = image._getexif()
            
            if exif:
                for tag_id, value in exif.items():
                    tag = TAGS.get(tag_id, tag_id)
                    if tag in ['DateTime', 'DateTimeOriginal', 'DateTimeDigitized']:
                        # 转换格式: "2023:07:15 14:30:00" -> ISO格式
                        dt = datetime.strptime(value, "%Y:%m:%d %H:%M:%S")
                        return dt.isoformat()
        except Exception as e:
            logger.debug(f"EXIF提取失败: {e}")
        return None
    
    def _extract_media_metadata(self, file_path: str) -> Optional[str]:
        """提取音视频元数据时间"""
        # 这里可以使用 mutagen 等库
        # 简化实现：返回None，依赖其他方法
        return None
    
    def _extract_from_text(self, content: str) -> Dict[str, Any]:
        """从文本内容提取时间"""
        # 尝试匹配完整日期
        date_match = re.search(self.time_patterns['date'], content)
        if date_match:
            date_str = date_match.group(1)
            # 标准化格式
            try:
                dt = self._parse_date_str(date_str)
                return {
                    'type': 'exact',
                    'datetime': dt.isoformat(),
                    'confidence': 0.85,
                    'source': 'content',
                    'original_text': date_str
                }
            except:
                pass
        
        # 匹配相对时间
        relative_match = re.search(self.time_patterns['relative'], content)
        if relative_match:
            relative_time = relative_match.group(1)
            inferred = self._parse_relative_time(relative_time)
            return {
                'type': 'relative',
                'description': relative_time,
                'inferred_time': inferred['datetime'],
                'confidence': inferred['confidence'],
                'source': 'content'
            }
        
        # 匹配季节
        season_match = re.search(self.time_patterns['season'], content)
        if season_match:
            season = season_match.group(1)
            return {
                'type': 'fuzzy',
                'description': season,
                'season': season,
                'confidence': 0.5,
                'source': 'content'
            }
        
        # 完全未知
        return {
            'type': 'unknown',
            'description': '未检测到时间信息',
            'confidence': 0.0
        }
    
    def _extract_from_image(self, file_path: str, content: str) -> Dict[str, Any]:
        """从图片提取时间（视觉线索 + 配文）"""
        # 1. 先尝试配文
        if content:
            text_result = self._extract_from_text(content)
            if text_result['type'] != 'unknown':
                text_result['source'] = 'image_caption'
                return text_result
        
        # 2. 返回模糊时间（需要LLM分析视觉内容）
        return {
            'type': 'fuzzy',
            'description': '需要视觉分析',
            'confidence': 0.3,
            'source': 'image_content',
            'needs_llm': True  # 标记需要LLM进一步分析
        }
    
    def _extract_from_audio(self, file_path: str, content: str) -> Dict[str, Any]:
        """从音频提取时间（语音内容 + 转录文本）"""
        # 1. 使用转录文本
        if content:
            text_result = self._extract_from_text(content)
            if text_result['type'] != 'unknown':
                text_result['source'] = 'audio_transcript'
                return text_result
        
        return {
            'type': 'unknown',
            'description': '无法从音频推断时间',
            'confidence': 0.0
        }
    
    def _parse_date_str(self, date_str: str) -> datetime:
        """解析各种日期格式"""
        formats = [
            '%Y年%m月%d日',
            '%Y-%m-%d',
            '%Y/%m/%d',
            '%Y%m%d'
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except:
                continue
        raise ValueError(f"无法解析日期: {date_str}")
    
    def _parse_relative_time(self, relative: str) -> Dict[str, Any]:
        """解析相对时间"""
        now = datetime.now()
        
        mapping = {
            '去年': {'delta': timedelta(days=-365), 'conf': 0.7},
            '今年': {'delta': timedelta(days=0), 'conf': 0.8},
            '明年': {'delta': timedelta(days=365), 'conf': 0.7},
            '上个月': {'delta': timedelta(days=-30), 'conf': 0.8},
            '这个月': {'delta': timedelta(days=0), 'conf': 0.9},
            '下个月': {'delta': timedelta(days=30), 'conf': 0.8},
            '上周': {'delta': timedelta(days=-7), 'conf': 0.8},
            '这周': {'delta': timedelta(days=0), 'conf': 0.9},
            '下周': {'delta': timedelta(days=7), 'conf': 0.8},
            '昨天': {'delta': timedelta(days=-1), 'conf': 0.9},
            '今天': {'delta': timedelta(days=0), 'conf': 0.95},
            '明天': {'delta': timedelta(days=1), 'conf': 0.9},
        }
        
        if relative in mapping:
            info = mapping[relative]
            inferred = now + info['delta']
            return {
                'datetime': inferred.isoformat(),
                'confidence': info['conf']
            }
        
        return {'datetime': now.isoformat(), 'confidence': 0.5}
    
    def enhance_with_llm(self, memory_data: Dict[str, Any], understanding: Dict[str, Any]) -> Dict[str, Any]:
        """
        使用LLM增强时间推断（当其他方法失败时）
        
        Args:
            memory_data: 原始记忆数据
            understanding: LLM理解结果
            
        Returns:
            增强的时间信息
        """
        # 从理解结果中提取时间描述
        description = understanding.get('description', '')
        summary = understanding.get('summary', '')
        
        # 如果理解结果中有明确时间，使用它
        if '时间' in description or '日期' in description:
            # 让LLM专门提取时间
            return {
                'type': 'fuzzy',
                'description': '从AI理解中提取',
                'context': summary,
                'confidence': 0.6,
                'source': 'llm_inference',
                'needs_verification': True
            }
        
        return {
            'type': 'unknown',
            'description': '无法推断时间',
            'confidence': 0.0
        }


# 工具函数
def format_temporal_display(temporal_info: Dict[str, Any]) -> str:
    """格式化时间显示"""
    ttype = temporal_info.get('type', 'unknown')
    
    if ttype == 'exact':
        dt = temporal_info.get('datetime', '')
        try:
            dt_obj = datetime.fromisoformat(dt)
            return dt_obj.strftime('%Y年%m月%d日 %H:%M')
        except:
            return dt
    
    elif ttype == 'relative':
        desc = temporal_info.get('description', '')
        inferred = temporal_info.get('inferred_time', '')
        return f"{desc} ({inferred[:10]})"
    
    elif ttype == 'fuzzy':
        return temporal_info.get('description', '时间不详')
    
    else:
        return "时间未知"


def get_temporal_confidence_color(confidence: float) -> str:
    """根据时间置信度返回颜色"""
    if confidence >= 0.8:
        return '#1a936f'  # 绿色 - 高置信度
    elif confidence >= 0.5:
        return '#f39c12'  # 橙色 - 中等
    else:
        return '#e74c3c'  # 红色 - 低置信度
