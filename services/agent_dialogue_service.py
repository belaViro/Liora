"""Orchestrates memory-scoped multi-persona dialogue."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Dict, Iterator, List

from loguru import logger


class AgentDialogueService:
    """Create one-off persona dialogue sessions from isolated context packs."""

    def __init__(self, llm_service):
        self.llm_service = llm_service

    def create_dialogue(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        events = list(self.create_dialogue_stream(payload))
        done_event = next((event for event in reversed(events) if event["event"] == "done"), None)
        if not done_event:
            raise ValueError("dialogue generation failed")
        return done_event["data"]["session"]

    def create_dialogue_stream(self, payload: Dict[str, Any]) -> Iterator[Dict[str, Any]]:
        memory = _normalize_memory(payload.get("memory") or {}, max_chars=1600)
        participants = _normalize_participants(payload.get("participants") or [])
        if not memory.get("id") and not memory.get("content"):
            raise ValueError("memory is required")
        if not participants:
            raise ValueError("at least one participant is required")

        language = _answer_language(payload.get("language", "Chinese"))
        user_question = _text(
            payload.get("user_question"),
            "你们就这段记忆先各说一句，像真的在场一样互相接话。"
            if language == "Chinese"
            else "Take one short turn each on this memory, as if you are inside the scene.",
        )
        prior_turns = _normalize_public_turns(payload.get("public_turns") or payload.get("history") or [])
        start_round = _safe_int(payload.get("start_round"), default=_infer_next_round(prior_turns), min_value=1, max_value=20)
        rounds = _safe_int(payload.get("rounds"), default=1, min_value=0, max_value=3)
        include_summary = _to_bool(payload.get("include_summary", True))

        turns: List[Dict[str, Any]] = list(prior_turns)
        session = {
            "id": _text(payload.get("session_id"), f"agentdlg_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}"),
            "memory_id": memory.get("id", ""),
            "mode": "memory_review",
            "host": "洛忆" if language == "Chinese" else "Luoyi",
            "participants": [
                {"id": item["id"], "name": item["name"], "type": item.get("type", "PERSON")}
                for item in participants
            ],
            "turns": turns,
            "user_question": user_question,
            "created_at": _text(payload.get("created_at"), datetime.utcnow().isoformat() + "Z"),
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }
        yield {"event": "metadata", "data": {"success": True, "session": {**session, "turns": list(turns)}}}

        for offset in range(rounds):
            round_index = start_round + offset
            for participant in participants:
                yield {
                    "event": "speaking",
                    "data": {
                        "role": "participant",
                        "agent_id": participant["id"],
                        "agent_name": participant["name"],
                        "round": round_index,
                    },
                }
                content = self._generate_persona_turn(
                    memory=memory,
                    participant=participant,
                    public_turns=_public_turns(turns),
                    user_question=user_question,
                    language=language,
                    round_index=round_index,
                )
                turn = {
                    "id": f"turn_{uuid.uuid4().hex[:10]}",
                    "role": "participant",
                    "agent_id": participant["id"],
                    "agent_name": participant["name"],
                    "content": content,
                    "round": round_index,
                    "evidence_ids": participant.get("evidence_ids", []),
                    "created_at": datetime.utcnow().isoformat() + "Z",
                }
                turns.append(turn)
                session["updated_at"] = datetime.utcnow().isoformat() + "Z"
                yield {"event": "turn", "data": {"turn": turn}}

        if include_summary:
            summary_round = max(_infer_last_round(turns), start_round)
            yield {
                "event": "speaking",
                "data": {"role": "host", "agent_id": "luoyi", "agent_name": session["host"], "round": summary_round},
            }
            summary = self._generate_luoyi_summary(
                memory=memory,
                participants=participants,
                turns=turns,
                user_question=user_question,
                language=language,
            )
            host_turn = {
                "id": f"turn_{uuid.uuid4().hex[:10]}",
                "role": "host",
                "agent_id": "luoyi",
                "agent_name": session["host"],
                "content": summary,
                "round": summary_round,
                "evidence_ids": [memory.get("id")] if memory.get("id") else [],
                "created_at": datetime.utcnow().isoformat() + "Z",
            }
            turns.append(host_turn)
            session["updated_at"] = datetime.utcnow().isoformat() + "Z"
            yield {"event": "turn", "data": {"turn": host_turn}}

        yield {"event": "done", "data": {"success": True, "session": session}}

    def _generate_persona_turn(
        self,
        memory: Dict[str, Any],
        participant: Dict[str, Any],
        public_turns: List[Dict[str, Any]],
        user_question: str,
        language: str,
        round_index: int,
    ) -> str:
        system_prompt = _persona_system_prompt(participant, language)
        user_prompt = _persona_user_prompt(memory, participant, public_turns, user_question, language, round_index)
        fallback = f"（{participant['name']} 这一轮生成失败）" if language == "Chinese" else f"({participant['name']} failed to generate this turn.)"
        return self._chat(system_prompt, user_prompt, max_tokens=180, temperature=0.72, fallback=fallback)

    def _generate_luoyi_summary(
        self,
        memory: Dict[str, Any],
        participants: List[Dict[str, Any]],
        turns: List[Dict[str, Any]],
        user_question: str,
        language: str,
    ) -> str:
        names = "、".join(p["name"] for p in participants)
        if language == "English":
            system_prompt = (
                "You are Luoyi, the host agent in Liora. Summarize this exploratory dialogue briefly. "
                "Keep it useful: what each persona brought, where they echoed or contradicted each other, and the strongest memory-network thread."
            )
            user_prompt = "\n\n".join(
                [
                    f"Memory story:\n{_memory_story(memory)}",
                    f"Participants: {names}",
                    f"Prompt: {user_question}",
                    "Dialogue:\n" + _format_public_turns(turns),
                    "Reply in English, 70-110 words, conversational.",
                ]
            )
            fallback = "I would treat this as a loose memory-theatre reading: the value is in the echoes between the voices, not in proving every detail."
        else:
            system_prompt = (
                "你是 Liora 的主 agent 洛忆，负责主持多人物记忆推演。"
                "请简短总结这轮对话：谁提供了什么视角，哪里互相印证或冲突，哪条记忆网络线索最值得继续问。"
            )
            user_prompt = "\n\n".join(
                [
                    f"记忆故事:\n{_memory_story(memory)}",
                    f"参与人物: {names}",
                    f"用户要求: {user_question}",
                    "公开对话:\n" + _format_public_turns(turns),
                    "请用中文，70-110字，像洛忆在聊天，不要写报告。",
                ]
            )
            fallback = "我会把它当成一场记忆剧场：重点不是证明每个细节，而是看这些声音之间怎样互相照亮。"
        return self._chat(system_prompt, user_prompt, max_tokens=260, temperature=0.55, fallback=fallback)

    def _chat(self, system_prompt: str, user_prompt: str, max_tokens: int, temperature: float, fallback: str) -> str:
        try:
            content = self._complete_chat(system_prompt, user_prompt, max_tokens, temperature)
            cleaned = _trim_reply(content, "")
            if cleaned:
                return cleaned

            logger.warning("agent dialogue LLM reply was empty after persona cleanup; retrying with dialogue-only prompt")
            retry_system = system_prompt + (
                "\n\n重要：上一条回答不合格。现在只输出角色对白本身，"
                "不要解释、不要说证据、不要说你在推演、不要写角色名。"
            )
            retry_user = _dialogue_only_retry_prompt(user_prompt)
            retry_content = self._complete_chat(retry_system, retry_user, max_tokens, min(temperature + 0.08, 0.9))
            cleaned = _trim_reply(retry_content, "")
            return cleaned or fallback
        except Exception as exc:
            logger.warning(f"agent dialogue LLM call failed: {exc}")
            return fallback

    def _complete_chat(self, system_prompt: str, user_prompt: str, max_tokens: int, temperature: float) -> str:
        response = self.llm_service.client.chat.completions.create(
            model=self.llm_service.model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        return response.choices[0].message.content or ""

def _persona_system_prompt(participant: Dict[str, Any], language: str) -> str:
    name = participant["name"]
    profile = participant.get("persona_profile") or {}
    style = _text(profile.get("speaking_style"), "自然、短句、像在当场接话" if language == "Chinese" else "natural, brief, like speaking in the scene")
    if language == "English":
        return f"""You are roleplaying "{name}" inside one memory story.
The memory story is your whole stage. Do not verify evidence and do not discuss uncertainty.
Only output this character's spoken line. No role name, no narration, no analysis.
Speaking style: {style}

Output rules:
- 1 to 2 short sentences, 20-55 words.
- Speak in first person as {name}.
- Stay inside the given memory story.
- You may lightly infer a feeling or motive, but do not invent hard events outside the story.
- If there is prior public dialogue, respond to one specific previous line."""

    return f"""你正在扮演记忆故事里的「{name}」。
下面给你的“记忆故事”就是你的全部舞台，不需要证明证据，也不要讨论不确定性。
你只能输出这个人物正在说的一句对白；不要写角色名、旁白、分析、括号说明。
说话风格：{style}

输出规则：
- 1 到 2 句，20 到 55 字。
- 用「{name}」的第一人称说话。
- 只待在给定记忆故事里。
- 可以轻微补足感受或动机，但不要编造故事外的硬事实。
- 如果已有公开对话，就接住其中某一句回应。"""

def _persona_user_prompt(
    memory: Dict[str, Any],
    participant: Dict[str, Any],
    public_turns: List[Dict[str, Any]],
    user_question: str,
    language: str,
    round_index: int,
) -> str:
    related = _format_related_memories(participant.get("related_memories", []), language)
    relationships = _format_relationships(participant.get("relationships", []), language)
    public_dialogue = _format_public_turns(public_turns)
    if language == "English":
        task = "It is your turn. Say one natural line from inside the scene." if round_index <= 1 else "It is your turn. Respond to one previous line, then add one small angle."
        return "\n\n".join(
            [
                f"Memory story:\n{_memory_story(memory)}",
                f"Character you play: {participant['name']}",
                f"Character image:\n{participant.get('description') or 'Read it from the story.'}",
                f"Private related fragments:\n{related}",
                f"Relationship clues:\n{relationships}",
                f"Public dialogue so far:\n{public_dialogue}",
                f"Luoyi's prompt: {user_question}",
                f"Task: {task} Output only the line this character says.",
            ]
        )

    task = "轮到你了，直接从场景里说一句自然的话。" if round_index <= 1 else "轮到你了，接住上一轮某个人的一句话，再补一个小角度。"
    return "\n\n".join(
        [
            f"记忆故事：\n{_memory_story(memory)}",
            f"你扮演的人物：{participant['name']}",
            f"人物形象：\n{participant.get('description') or '从故事中自行把握'}",
            f"你的私有相关片段：\n{related}",
            f"你的关系线索：\n{relationships}",
            f"目前公开对话：\n{public_dialogue}",
            f"洛忆给出的场景任务：{user_question}",
            f"当前任务：{task} 只输出这个人物说出的对白。",
        ]
    )


def _dialogue_only_retry_prompt(previous_prompt: str) -> str:
    return (
        previous_prompt
        + "\n\n重试要求：刚才的回答出戏了。请只输出一句人物对白，20 到 45 字；"
        + "不要出现‘证据’‘推演’‘无法知道’‘基于记忆’‘我先按’这些说法。"
    )
def _normalize_participants(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []

    participants = []
    for index, raw in enumerate(value, start=1):
        if not isinstance(raw, dict):
            continue
        name = _text(raw.get("name"))
        if not name or _is_disallowed_persona_name(name):
            continue
        participant_id = _text(raw.get("id"), f"person_{index}")
        related_memories = [
            _normalize_memory(item, max_chars=700)
            for item in raw.get("related_memories", [])[:6]
            if isinstance(item, dict)
        ]
        relationships = [
            _normalize_relationship(item)
            for item in raw.get("relationships", [])[:12]
            if isinstance(item, dict)
        ]
        evidence_ids = [item.get("id") for item in related_memories if item.get("id")]
        if raw.get("current_memory_id"):
            evidence_ids.insert(0, _text(raw.get("current_memory_id")))
        participants.append(
            {
                "id": participant_id,
                "name": name,
                "type": _text(raw.get("type"), "PERSON"),
                "description": _text(raw.get("description")),
                "aliases": raw.get("aliases") if isinstance(raw.get("aliases"), list) else [],
                "related_memories": related_memories,
                "relationships": relationships,
                "persona_profile": raw.get("persona_profile") if isinstance(raw.get("persona_profile"), dict) else {},
                "evidence_ids": list(dict.fromkeys(evidence_ids)),
            }
        )
        if len(participants) >= 3:
            break
    return participants


def _is_disallowed_persona_name(name: str) -> bool:
    normalized = _text(name).lower().strip()
    disallowed = {"我", "本人", "自己", "用户", "你", "他", "她", "ta", "me", "i", "myself", "user"}
    return normalized in disallowed


def _normalize_memory(value: Dict[str, Any], max_chars: int) -> Dict[str, Any]:
    understanding = value.get("understanding") if isinstance(value.get("understanding"), dict) else {}
    summary = _text(understanding.get("summary"))
    description = _text(understanding.get("description"))
    content = _text(value.get("content") or description or summary)
    emotion = value.get("emotion") if isinstance(value.get("emotion"), dict) else {}
    return {
        "id": _text(value.get("id")),
        "created_at": _text(value.get("created_at")),
        "type": _text(value.get("type"), "text"),
        "summary": summary or content[:120],
        "content": content[:max_chars],
        "emotion": {
            "dominant_emotion": _text(emotion.get("dominant_emotion")),
            "valence": emotion.get("valence", 0),
        },
    }


def _normalize_relationship(value: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": _text(value.get("id")),
        "source": _text(value.get("source_name") or value.get("source")),
        "target": _text(value.get("target_name") or value.get("target")),
        "type": _text(value.get("type"), "相关"),
        "fact": _text(value.get("fact") or value.get("description"))[:180],
    }


def _normalize_public_turns(value: Any) -> List[Dict[str, Any]]:
    if not isinstance(value, list):
        return []
    turns = []
    for item in value[:40]:
        if not isinstance(item, dict):
            continue
        content = _text(item.get("content"))
        agent_name = _text(item.get("agent_name"))
        if not content or not agent_name:
            continue
        turns.append(
            {
                "id": _text(item.get("id"), f"turn_{uuid.uuid4().hex[:10]}"),
                "role": _text(item.get("role"), "participant"),
                "agent_id": _text(item.get("agent_id"), agent_name),
                "agent_name": agent_name,
                "content": content[:500],
                "round": _safe_int(item.get("round"), default=1, min_value=1, max_value=20),
                "evidence_ids": item.get("evidence_ids") if isinstance(item.get("evidence_ids"), list) else [],
                "created_at": _text(item.get("created_at"), datetime.utcnow().isoformat() + "Z"),
            }
        )
    return turns


def _public_turns(turns: List[Dict[str, Any]], limit: int = 10) -> List[Dict[str, Any]]:
    return [
        {
            "agent_name": _text(turn.get("agent_name")),
            "content": _text(turn.get("content"))[:360],
            "role": _text(turn.get("role")),
            "round": turn.get("round", 1),
        }
        for turn in turns[-limit:]
    ]


def _format_public_turns(turns: List[Dict[str, Any]]) -> str:
    visible = [turn for turn in turns if turn.get("content")]
    if not visible:
        return "（暂无公开发言）"
    return "\n".join(f"- 第{turn.get('round', 1)}轮 {turn.get('agent_name', '')}: {turn.get('content', '')}" for turn in visible[-12:])


def _format_related_memories(memories: List[Dict[str, Any]], language: str) -> str:
    if not memories:
        return "(none)" if language == "English" else "（暂无额外片段）"
    lines = []
    for memory in memories[:5]:
        text = memory.get("summary") or memory.get("content") or ""
        if text:
            lines.append(f"- {text[:160]}")
    return "\n".join(lines) if lines else ("(none)" if language == "English" else "（暂无额外片段）")


def _format_relationships(relationships: List[Dict[str, Any]], language: str) -> str:
    if not relationships:
        return "(none)" if language == "English" else "（暂无关系线索）"
    lines = []
    for rel in relationships[:8]:
        source = rel.get("source") or "?"
        target = rel.get("target") or "?"
        rel_type = rel.get("type") or "related"
        fact = rel.get("fact") or ""
        lines.append(f"- {source} --{rel_type}--> {target}" + (f": {fact}" if fact else ""))
    return "\n".join(lines)


def _memory_story(memory: Dict[str, Any]) -> str:
    return _text(memory.get("content") or memory.get("summary"), "无内容")


def _infer_next_round(turns: List[Dict[str, Any]]) -> int:
    return _infer_last_round(turns) + 1


def _infer_last_round(turns: List[Dict[str, Any]]) -> int:
    rounds = [turn.get("round", 0) for turn in turns if turn.get("role") != "host"]
    return max(rounds) if rounds else 0


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2)


def _text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    text = value if isinstance(value, str) else str(value)
    return text.strip() or default


def _trim_reply(value: str, fallback: str) -> str:
    text = _text(value, fallback)
    text = text.replace("\r", "").strip().strip('"').strip("'")
    text = _remove_meta_hedges(text)
    if len(text) > 180:
        punctuation = max(text.rfind("。", 0, 180), text.rfind("！", 0, 180), text.rfind("？", 0, 180), text.rfind(".", 0, 180))
        text = text[: punctuation + 1] if punctuation > 60 else text[:180].rstrip() + "..."
    return text or fallback



def _remove_meta_hedges(value: str) -> str:
    text = value
    blocked = [
        "我先按这段记忆推演",
        "我能确定的线索不多",
        "证据不足",
        "我无法知道",
        "只能基于",
        "基于记忆证据",
        "不代表真实人物",
        "作为AI",
        "作为一个AI",
    ]
    if any(phrase in text for phrase in blocked):
        parts = [part.strip() for part in text.replace("；", "。").split("。") if part.strip()]
        parts = [part for part in parts if not any(phrase in part for phrase in blocked)]
        text = "。".join(parts[:2])
        if text and not text.endswith(("。", "！", "？", ".", "!", "?")):
            text += "。"
    return text
def _safe_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    return max(min_value, min(number, max_value))


def _to_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _answer_language(value: Any) -> str:
    return "English" if str(value).lower().startswith("english") else "Chinese"