"""Offline tests for Pydantic extraction schema and tool-call parsing."""

from types import SimpleNamespace

from services.extraction_schema import normalize_extraction_result
from services.llm_service import LLMService


def test_normalize_extraction_result_maps_relation_names_to_ids():
    payload = {
        "understanding": {
            "description": "张三和李四在北京见面，张三很开心。",
            "summary": "张三和李四在北京见面。",
            "keywords": "张三，北京，开心",
            "persons": ["张三", "李四"],
            "locations": ["北京"],
            "events": ["见面"],
            "emotion": {"valence": 1.5, "arousal": 0.7, "dominant_emotion": "开心"},
            "topics": ["朋友"],
        },
        "entities": [
            {"id": "zhang_san", "name": "张三", "type": "PERSON", "aliases": "老张"},
            {"id": "li_si", "name": "李四", "type": "PERSON"},
            {"id": "beijing", "name": "北京", "type": "LOCATION"},
        ],
        "relations": [
            {"source": "张三", "target": "李四", "type": "朋友", "confidence": 2},
            {"source": "zhang_san", "target": "beijing", "type": "位于", "confidence": 0.6},
            {"source": "unknown", "target": "beijing", "type": "忽略"},
        ],
        "emotion": {"valence": 1.5, "arousal": 0.7, "dominant_emotion": "开心"},
    }

    result = normalize_extraction_result(payload, "张三和李四在北京见面，张三很开心。")

    assert result["emotion"]["valence"] == 1.0
    assert result["understanding"]["keywords"] == ["张三", "北京", "开心"]
    assert len(result["entities"]) == 3
    assert len(result["relations"]) == 2
    assert result["relations"][0]["source"] == "zhang_san"
    assert result["relations"][0]["target"] == "li_si"
    assert result["relations"][0]["confidence"] == 1.0


def test_extract_tool_payload_from_langchain_tool_calls_without_init():
    service = object.__new__(LLMService)
    message = SimpleNamespace(
        tool_calls=[
            {
                "name": "ExtractMemoryStructure",
                "args": {
                    "understanding": {
                        "description": "一次测试",
                        "summary": "测试",
                    },
                    "entities": [],
                    "relations": [],
                    "emotion": {"valence": 0, "arousal": 0.5, "dominant_emotion": "中性"},
                },
            }
        ],
        additional_kwargs={},
    )

    payload = service._extract_tool_payload(message)

    assert payload["understanding"]["summary"] == "测试"


def test_extract_tool_payload_from_openai_raw_tool_calls_without_init():
    service = object.__new__(LLMService)
    message = SimpleNamespace(
        tool_calls=[],
        additional_kwargs={
            "tool_calls": [
                {
                    "function": {
                        "name": "ExtractMemoryStructure",
                        "arguments": '{"understanding":{"description":"一次测试","summary":"测试"},"entities":[],"relations":[],"emotion":{"valence":0,"arousal":0.5,"dominant_emotion":"中性"}}',
                    }
                }
            ]
        },
    )

    payload = service._extract_tool_payload(message)

    assert payload["understanding"]["description"] == "一次测试"
