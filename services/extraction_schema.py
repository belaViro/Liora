"""Pydantic schema for memory structure extraction."""

from __future__ import annotations

import re
from typing import Any, Dict, List

from pydantic import BaseModel, ConfigDict, Field, field_validator


ALLOWED_ENTITY_TYPES = {
    "PERSON",
    "LOCATION",
    "EVENT",
    "OBJECT",
    "CONCEPT",
    "EMOTION",
}

EXTRACTION_TOOL_NAME = "ExtractMemoryStructure"


def _to_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _to_string_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = re.split(r"[,，、\n]+", value)
        return [part.strip() for part in parts if part.strip()]
    if isinstance(value, list):
        return [_to_text(item) for item in value if _to_text(item)]
    return []


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(-1.0, min(1.0, number))


def _to_confidence(value: Any, default: float = 0.8) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, number))


def _slugify(value: str, fallback: str = "entity") -> str:
    text = _to_text(value).lower()
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"[^\w\u4e00-\u9fff]+", "_", text, flags=re.UNICODE)
    text = re.sub(r"_+", "_", text).strip("_")
    return text or fallback


def _normalize_entity_type(value: Any) -> str:
    entity_type = _to_text(value, "CONCEPT").upper()
    return entity_type if entity_type in ALLOWED_ENTITY_TYPES else "CONCEPT"


class MemoryEmotion(BaseModel):
    """Overall emotional state of the memory."""

    model_config = ConfigDict(extra="ignore")

    valence: float = Field(
        default=0.0,
        description="Emotional polarity from -1.0 negative to 1.0 positive.",
    )
    arousal: float = Field(
        default=0.5,
        description="Emotional intensity from 0.0 calm to 1.0 intense.",
    )
    dominant_emotion: str = Field(default="中性", description="Dominant emotion label.")

    @field_validator("valence")
    @classmethod
    def validate_valence(cls, value: Any) -> float:
        return _to_float(value, 0.0)

    @field_validator("arousal")
    @classmethod
    def validate_arousal(cls, value: Any) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return 0.5
        return max(0.0, min(1.0, number))

    @field_validator("dominant_emotion")
    @classmethod
    def validate_dominant_emotion(cls, value: Any) -> str:
        return _to_text(value, "中性")


class MemoryUnderstanding(BaseModel):
    """Natural language understanding of a memory."""

    model_config = ConfigDict(extra="ignore")

    description: str = Field(description="A detailed description of the memory.")
    summary: str = Field(description="One-sentence summary.")
    keywords: List[str] = Field(default_factory=list, description="Important keywords.")
    persons: List[str] = Field(default_factory=list, description="People mentioned.")
    locations: List[str] = Field(default_factory=list, description="Locations mentioned.")
    events: List[str] = Field(default_factory=list, description="Events mentioned.")
    emotion: MemoryEmotion = Field(default_factory=MemoryEmotion)
    topics: List[str] = Field(default_factory=list, description="High-level topics.")

    @field_validator("description", "summary")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        return _to_text(value)

    @field_validator("keywords", "persons", "locations", "events", "topics", mode="before")
    @classmethod
    def validate_string_lists(cls, value: Any) -> List[str]:
        return _to_string_list(value)


class MemoryEntity(BaseModel):
    """A graph entity extracted from one memory."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(description="Stable entity id, lowercase with underscores when possible.")
    name: str = Field(description="Original entity name.")
    type: str = Field(
        description="Entity type: PERSON, LOCATION, EVENT, OBJECT, CONCEPT, or EMOTION.",
    )
    description: str = Field(default="", description="Entity description.")
    attributes: Dict[str, Any] = Field(default_factory=dict, description="Entity attributes.")
    aliases: List[str] = Field(default_factory=list, description="Alternative names.")

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: Any) -> str:
        return _slugify(_to_text(value), "entity")

    @field_validator("name", "description")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        return _to_text(value)

    @field_validator("type")
    @classmethod
    def validate_type(cls, value: Any) -> str:
        return _normalize_entity_type(value)

    @field_validator("aliases", mode="before")
    @classmethod
    def validate_aliases(cls, value: Any) -> List[str]:
        return _to_string_list(value)

    @field_validator("attributes", mode="before")
    @classmethod
    def validate_attributes(cls, value: Any) -> Dict[str, Any]:
        return value if isinstance(value, dict) else {}


class MemoryRelation(BaseModel):
    """A typed relation between extracted entities."""

    model_config = ConfigDict(extra="ignore")

    source: str = Field(description="Source entity id.")
    target: str = Field(description="Target entity id.")
    type: str = Field(description="Relation type in Chinese.")
    description: str = Field(default="", description="Relation description.")
    fact: str = Field(default="", description="A sentence stating the relation fact.")
    confidence: float = Field(default=0.8, description="Confidence from 0.0 to 1.0.")

    @field_validator("source", "target")
    @classmethod
    def validate_endpoint(cls, value: Any) -> str:
        return _slugify(_to_text(value), "entity")

    @field_validator("type", "description", "fact")
    @classmethod
    def validate_text(cls, value: Any) -> str:
        return _to_text(value)

    @field_validator("confidence")
    @classmethod
    def validate_confidence(cls, value: Any) -> float:
        return _to_confidence(value, 0.8)


class ExtractMemoryStructure(BaseModel):
    """Extract structured understanding, entities, relations, and emotion from a memory."""

    model_config = ConfigDict(
        title=EXTRACTION_TOOL_NAME,
        extra="ignore",
    )

    understanding: MemoryUnderstanding = Field(description="Memory understanding result.")
    entities: List[MemoryEntity] = Field(description="Extracted graph entities. Must include all important people, locations, events, concepts, and emotions.")
    relations: List[MemoryRelation] = Field(description="Extracted graph relations. Must connect the extracted entities.")
    emotion: MemoryEmotion = Field(description="Top-level emotion summary.")


def default_extraction_result(text: str) -> Dict[str, Any]:
    content = _to_text(text)
    emotion = MemoryEmotion().model_dump(mode="json")
    understanding = {
        "description": content[:100] if content else "无内容",
        "summary": content[:50] if content else "",
        "keywords": [],
        "persons": [],
        "locations": [],
        "events": [],
        "emotion": emotion,
        "topics": [],
    }
    return {
        "understanding": understanding,
        "entities": [],
        "relations": [],
        "emotion": emotion,
    }


def normalize_extraction_result(payload: Any, source_text: str = "") -> Dict[str, Any]:
    """Normalize model output into the legacy frontend contract."""
    if isinstance(payload, ExtractMemoryStructure):
        raw = payload.model_dump(mode="python")
    elif isinstance(payload, BaseModel):
        raw = payload.model_dump(mode="python")
    elif isinstance(payload, dict):
        raw = payload
    else:
        raw = {}

    fallback = default_extraction_result(source_text)
    understanding = _coerce_understanding(raw.get("understanding"), fallback["understanding"])
    emotion = _coerce_emotion(raw.get("emotion") or understanding.get("emotion"))
    understanding["emotion"] = emotion

    entities = _coerce_entities(raw.get("entities"))
    relations = _coerce_relations(raw.get("relations"), entities)

    result = ExtractMemoryStructure(
        understanding=understanding,
        entities=entities,
        relations=relations,
        emotion=emotion,
    )
    return result.model_dump(mode="json")


def _coerce_understanding(value: Any, fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    data = {
        "description": _to_text(value.get("description"), fallback["description"]),
        "summary": _to_text(value.get("summary"), fallback["summary"]),
        "keywords": _to_string_list(value.get("keywords")),
        "persons": _to_string_list(value.get("persons")),
        "locations": _to_string_list(value.get("locations")),
        "events": _to_string_list(value.get("events")),
        "emotion": _coerce_emotion(value.get("emotion")),
        "topics": _to_string_list(value.get("topics")),
    }
    return data


def _coerce_emotion(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        value = {}
    return MemoryEmotion(
        valence=value.get("valence", 0.0),
        arousal=value.get("arousal", 0.5),
        dominant_emotion=value.get("dominant_emotion", "中性"),
    ).model_dump(mode="json")


def _coerce_entities(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    entities: List[Dict[str, Any]] = []
    used_ids: set[str] = set()

    for index, item in enumerate(value, start=1):
        if not isinstance(item, dict):
            continue

        name = _to_text(item.get("name"))
        entity_id = _slugify(_to_text(item.get("id")) or name, f"entity_{index}")
        if not name:
            name = entity_id
        if not name:
            continue

        base_id = entity_id
        counter = 2
        while entity_id in used_ids:
            entity_id = f"{base_id}_{counter}"
            counter += 1
        used_ids.add(entity_id)

        entity = MemoryEntity(
            id=entity_id,
            name=name,
            type=item.get("type", "CONCEPT"),
            description=item.get("description", ""),
            attributes=item.get("attributes", {}),
            aliases=item.get("aliases", []),
        )
        entities.append(entity.model_dump(mode="json"))

    return entities


def _coerce_relations(value: Any, entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    entity_lookup: Dict[str, str] = {}
    for entity in entities:
        entity_id = entity.get("id", "")
        if not entity_id:
            continue
        entity_lookup[entity_id] = entity_id
        entity_lookup[_slugify(entity.get("name", ""))] = entity_id
        for alias in entity.get("aliases", []):
            entity_lookup[_slugify(alias)] = entity_id

    relations: List[Dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()

    for item in value:
        if not isinstance(item, dict):
            continue

        source = entity_lookup.get(_slugify(item.get("source", "")))
        target = entity_lookup.get(_slugify(item.get("target", "")))
        relation_type = _to_text(item.get("type"))

        if not source or not target or not relation_type:
            continue
        if source == target:
            continue

        key = (source, target, relation_type)
        if key in seen:
            continue
        seen.add(key)

        relation = MemoryRelation(
            source=source,
            target=target,
            type=relation_type,
            description=item.get("description", ""),
            fact=item.get("fact", ""),
            confidence=item.get("confidence", 0.8),
        )
        relations.append(relation.model_dump(mode="json"))

    return relations
