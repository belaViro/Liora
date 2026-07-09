"""Orchestrates memory-scoped multi-persona dialogue."""

from __future__ import annotations

import json
import random
import re
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
        simulation_mode = _normalize_simulation_mode(payload.get("simulation_mode"))
        user_question = _text(
            payload.get("user_question"),
            _default_user_question(language, simulation_mode),
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
            "simulation_mode": simulation_mode,
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
            for participant in _participants_for_round(participants, round_index):
                yield {
                    "event": "speaking",
                    "data": {
                        "role": "participant",
                        "agent_id": participant["id"],
                        "agent_name": participant["name"],
                        "round": round_index,
                    },
                }
                persona_turn = self._generate_persona_turn(
                    memory=memory,
                    participant=participant,
                    public_turns=_public_turns(turns),
                    user_question=user_question,
                    language=language,
                    round_index=round_index,
                    simulation_mode=simulation_mode,
                )
                turn = {
                    "id": f"turn_{uuid.uuid4().hex[:10]}",
                    "role": "participant",
                    "agent_id": participant["id"],
                    "agent_name": participant["name"],
                    "content": persona_turn["content"],
                    "round": round_index,
                    "evidence_ids": persona_turn["evidence_ids"],
                    "evidence_refs": persona_turn["evidence_refs"],
                    "inference_notes": persona_turn["inference_notes"],
                    "confidence": persona_turn["confidence"],
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
            summary_result = self._generate_luoyi_summary(
                memory=memory,
                participants=participants,
                turns=turns,
                user_question=user_question,
                language=language,
                simulation_mode=simulation_mode,
            )
            host_turn = {
                "id": f"turn_{uuid.uuid4().hex[:10]}",
                "role": "host",
                "agent_id": "luoyi",
                "agent_name": session["host"],
                "content": summary_result["content"],
                "round": summary_round,
                "evidence_ids": [memory.get("id")] if memory.get("id") else [],
                "analysis": summary_result["analysis"],
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
        simulation_mode: str,
    ) -> Dict[str, Any]:
        system_prompt = _persona_system_prompt(participant, language, simulation_mode)
        user_prompt = _persona_user_prompt(memory, participant, public_turns, user_question, language, round_index, simulation_mode)
        fallback = f"（{participant['name']} 这一轮生成失败）" if language == "Chinese" else f"({participant['name']} failed to generate this turn.)"
        try:
            content = self._complete_chat(system_prompt, user_prompt, max_tokens=2400, temperature=0.72)
            parsed = _parse_persona_turn(content, participant, memory, language)
            if parsed["content"]:
                return parsed

            logger.warning("agent dialogue structured persona reply was empty; retrying")
            retry_content = self._complete_chat(
                system_prompt + _structured_retry_suffix(language),
                user_prompt,
                max_tokens=4096,
                temperature=0.78,
            )
            parsed = _parse_persona_turn(retry_content, participant, memory, language)
            return parsed if parsed["content"] else _fallback_persona_turn(fallback, participant, memory, language)
        except Exception as exc:
            logger.warning(f"agent dialogue LLM call failed: {exc}")
            return _fallback_persona_turn(fallback, participant, memory, language)

    def _generate_luoyi_summary(
        self,
        memory: Dict[str, Any],
        participants: List[Dict[str, Any]],
        turns: List[Dict[str, Any]],
        user_question: str,
        language: str,
        simulation_mode: str,
    ) -> Dict[str, Any]:
        names = "、".join(p["name"] for p in participants)
        mode_label = _simulation_mode_label(simulation_mode, language)
        if language == "English":
            system_prompt = (
                "You are Luoyi, the host agent in Liora. Summarize this exploratory memory dialogue. "
                "Return only a valid JSON object with content and analysis. Keep factual boundaries clear."
            )
            user_prompt = "\n\n".join(
                [
                    f"Memory story:\n{_memory_story(memory)}",
                    f"Participants: {names}",
                    f"Simulation mode: {mode_label}",
                    f"Prompt: {user_question}",
                    "Dialogue:\n" + _format_public_turns(turns),
                    "Return JSON only, with this shape:",
                    _json({
                        "content": "70-110 words, conversational summary from Luoyi",
                        "analysis": {
                            "consensus": ["shared view supported by the dialogue"],
                            "conflicts": ["different or conflicting views"],
                            "gaps": ["missing memory evidence or unknown context"],
                            "next_questions": ["specific follow-up question the user can answer"]
                        }
                    }),
                    "Use concise English. Put uncertain points in gaps or next_questions, not as facts.",
                ]
            )
            fallback = "I would treat this as a loose memory-theatre reading: the value is in the echoes between the voices, not in proving every detail."
        else:
            system_prompt = (
                "你是 Liora 的主 agent 洛忆，负责主持多人物记忆推演。"
                "请输出合法 JSON，既要有简短总结，也要把共识、冲突、空白和下一步问题结构化。"
                "不要把推测写成事实。"
            )
            user_prompt = "\n\n".join(
                [
                    f"记忆故事:\n{_memory_story(memory)}",
                    f"参与人物: {names}",
                    f"推演模式: {mode_label}",
                    f"用户要求: {user_question}",
                    "公开对话:\n" + _format_public_turns(turns),
                    "只返回 JSON，结构如下：",
                    _json({
                        "content": "洛忆的70-110字口语化总结",
                        "analysis": {
                            "consensus": ["对话中共同认可的判断"],
                            "conflicts": ["不同人物视角的差异或冲突"],
                            "gaps": ["缺少记忆证据或尚不清楚的空白"],
                            "next_questions": ["用户可以继续回答的具体问题"]
                        }
                    }),
                    "请用中文，简洁，不要写报告腔。无法确认的内容放入空白或下一步问题。",
                ]
            )
            fallback = "我会把它当成一场记忆剧场：重点不是证明每个细节，而是看这些声音之间怎样互相照亮。"

        try:
            raw = self._complete_chat(system_prompt, user_prompt, max_tokens=3200, temperature=0.5)
            parsed = _parse_luoyi_summary(raw, language)
            if parsed["content"]:
                return parsed

            retry_raw = self._complete_chat(
                system_prompt + _summary_retry_suffix(language),
                user_prompt,
                max_tokens=4096,
                temperature=0.45,
            )
            parsed = _parse_luoyi_summary(retry_raw, language)
            if parsed["content"]:
                return parsed
        except Exception as exc:
            logger.warning(f"agent dialogue summary LLM call failed: {exc}")

        return {
            "content": fallback,
            "analysis": _default_summary_analysis(language),
        }

    def _chat(self, system_prompt: str, user_prompt: str, max_tokens: int, temperature: float, fallback: str) -> str:
        try:
            content = self._complete_chat(system_prompt, user_prompt, max_tokens, temperature)
            cleaned = _trim_reply(content, "")
            if cleaned:
                return cleaned

            retry_max_tokens = min(max(max_tokens * 2, 4096), 6000)
            logger.warning(
                f"agent dialogue LLM reply was empty after cleanup; retrying with dialogue-only prompt "
                f"and max_tokens={retry_max_tokens}"
            )
            retry_system = system_prompt + (
                "\n\n重要：上一条回答不合格。现在只输出角色对白本身，"
                "不要解释、不要说证据、不要说你在推演、不要写角色名。"
            )
            retry_user = _dialogue_only_retry_prompt(user_prompt)
            retry_content = self._complete_chat(retry_system, retry_user, retry_max_tokens, min(temperature + 0.08, 0.9))
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
        choice = response.choices[0]
        content = _message_content_to_text(choice.message.content)
        finish_reason = getattr(choice, "finish_reason", "")
        if not content:
            logger.warning(f"agent dialogue LLM returned empty content; finish_reason={finish_reason}")
        elif finish_reason == "length":
            logger.warning("agent dialogue LLM response hit max_tokens limit")
        return content

_SIMULATION_MODES = {
    "review": {
        "zh_label": "复盘",
        "en_label": "Review",
        "zh_instruction": "各自回忆这段记忆中能被材料支持的感受、动作和关系线索。",
        "en_instruction": "Recall the feelings, actions, and relationship clues supported by the memory.",
        "zh_question": "你们就这段记忆先各说一句，像真的在场一样互相接话。",
        "en_question": "Take one short turn inside this memory. Keep it conversational.",
    },
    "confrontation": {
        "zh_label": "对质",
        "en_label": "Confrontation",
        "zh_instruction": "围绕说法差异、回避、误会或未说出口的部分互相回应，但不要制造新事实。",
        "en_instruction": "Respond around differences, avoidance, misunderstanding, or unsaid parts without inventing new facts.",
        "zh_question": "围绕这段记忆里可能存在的误会或分歧，各自说一句回应。",
        "en_question": "Take one turn around the possible misunderstanding or tension in this memory.",
    },
    "fill_gaps": {
        "zh_label": "补全空白",
        "en_label": "Fill gaps",
        "zh_instruction": "基于已有线索补足可能的情绪、动机或背景，并清楚把补足部分标成推测。",
        "en_instruction": "Fill likely feelings, motives, or context from existing clues, and mark extrapolations clearly.",
        "zh_question": "基于已有线索，补足这段记忆里可能缺失的一点感受或动机。",
        "en_question": "Fill one likely missing feeling or motive from the available clues.",
    },
    "relationship": {
        "zh_label": "关系变化",
        "en_label": "Relationship change",
        "zh_instruction": "关注人物之间的亲近、疏远、信任、亏欠或未完成感如何变化。",
        "en_instruction": "Focus on how closeness, distance, trust, debt, or unfinished feelings may have shifted.",
        "zh_question": "请围绕这段记忆反映出的人物关系变化，各自说一句。",
        "en_question": "Take one turn about the relationship shift reflected by this memory.",
    },
    "counterfactual": {
        "zh_label": "如果当时",
        "en_label": "What if",
        "zh_instruction": "只做轻量假设：如果当时某个选择不同，人物可能怎样回应；不要把假设写成事实。",
        "en_instruction": "Make a light what-if: how the persona might respond if one choice had differed; do not state it as fact.",
        "zh_question": "如果当时有一个选择不同，你们觉得自己会怎样回应？",
        "en_question": "If one choice had been different then, how might you have responded?",
    },
}


def _normalize_simulation_mode(value: Any) -> str:
    mode = _text(value, "review").lower().strip()
    if mode in {"memory_review", "default"}:
        return "review"
    return mode if mode in _SIMULATION_MODES else "review"


def _simulation_mode_label(mode: str, language: str) -> str:
    item = _SIMULATION_MODES.get(_normalize_simulation_mode(mode), _SIMULATION_MODES["review"])
    return item["en_label"] if language == "English" else item["zh_label"]


def _simulation_mode_instruction(mode: str, language: str) -> str:
    item = _SIMULATION_MODES.get(_normalize_simulation_mode(mode), _SIMULATION_MODES["review"])
    return item["en_instruction"] if language == "English" else item["zh_instruction"]


def _default_user_question(language: str, mode: str) -> str:
    item = _SIMULATION_MODES.get(_normalize_simulation_mode(mode), _SIMULATION_MODES["review"])
    return item["en_question"] if language == "English" else item["zh_question"]


def _summary_retry_suffix(language: str) -> str:
    if language == "English":
        return "\n\nThe previous answer was unusable. Return only valid JSON with content and analysis.consensus/conflicts/gaps/next_questions."
    return "\n\n上一条回答不合格。只返回合法 JSON，必须包含 content 和 analysis.consensus/conflicts/gaps/next_questions。"


def _parse_luoyi_summary(value: str, language: str) -> Dict[str, Any]:
    parsed = _extract_json_object(value)
    if isinstance(parsed, dict):
        content = _trim_reply(_text(parsed.get("content") or parsed.get("summary") or parsed.get("reply")), "")
        analysis_source = parsed.get("analysis") if isinstance(parsed.get("analysis"), dict) else parsed
        return {
            "content": content,
            "analysis": _normalize_summary_analysis(analysis_source, language),
        }

    content = _trim_reply(value, "")
    return {
        "content": content,
        "analysis": _default_summary_analysis(language),
    }


def _normalize_summary_analysis(value: Any, language: str) -> Dict[str, List[str]]:
    source = value if isinstance(value, dict) else {}
    return {
        "consensus": _summary_text_list(source.get("consensus") or source.get("agreements"), 4),
        "conflicts": _summary_text_list(source.get("conflicts") or source.get("tensions"), 4),
        "gaps": _summary_text_list(source.get("gaps") or source.get("unknowns") or source.get("missing"), 4),
        "next_questions": _summary_text_list(source.get("next_questions") or source.get("questions"), 4),
    }


def _summary_text_list(value: Any, limit: int) -> List[str]:
    if isinstance(value, list):
        items = value
    elif _text(value):
        items = [value]
    else:
        items = []
    result = []
    for item in items:
        if isinstance(item, dict):
            text = _text(item.get("text") or item.get("content") or item.get("question") or item.get("summary"))
        else:
            text = _text(item)
        if text:
            result.append(text[:180])
        if len(result) >= limit:
            break
    return result


def _default_summary_analysis(language: str) -> Dict[str, List[str]]:
    if language == "English":
        return {
            "consensus": [],
            "conflicts": [],
            "gaps": ["The summary could not be structured reliably."],
            "next_questions": [],
        }
    return {
        "consensus": [],
        "conflicts": [],
        "gaps": ["本轮总结未能可靠结构化。"],
        "next_questions": [],
    }

def _structured_retry_suffix(language: str) -> str:
    if language == "English":
        return "\n\nThe previous answer was unusable. Return only valid JSON with content, evidence_refs, inference_notes, and confidence."
    return "\n\n上一条回答不合格。只返回合法 JSON，必须包含 content、evidence_refs、inference_notes、confidence。"


def _parse_persona_turn(value: str, participant: Dict[str, Any], memory: Dict[str, Any], language: str) -> Dict[str, Any]:
    parsed = _extract_json_object(value)
    if isinstance(parsed, dict):
        content = _trim_reply(_text(parsed.get("content") or parsed.get("line") or parsed.get("dialogue")), "")
        evidence_refs = _normalize_evidence_refs(parsed.get("evidence_refs"), participant, memory, language)
        inference_notes = _normalize_inference_notes(parsed.get("inference_notes"), language)
        confidence = _normalize_confidence(parsed.get("confidence"), evidence_refs, inference_notes)
    else:
        content = _trim_reply(value, "")
        evidence_refs = _default_evidence_refs(participant, memory, language)
        inference_notes = [_plain_text_inference_note(language)] if content else []
        confidence = "medium" if content else "low"

    evidence_ids = [ref["memory_id"] for ref in evidence_refs if ref.get("memory_id")]
    if not evidence_ids:
        evidence_ids = participant.get("evidence_ids", []) or ([memory.get("id")] if memory.get("id") else [])

    return {
        "content": content,
        "evidence_refs": evidence_refs,
        "evidence_ids": list(dict.fromkeys(evidence_ids)),
        "inference_notes": inference_notes,
        "confidence": confidence,
    }


def _extract_json_object(value: str) -> Any:
    text = _text(value)
    if not text:
        return None

    fence_match = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.IGNORECASE | re.DOTALL)
    candidate = fence_match.group(1).strip() if fence_match else text.strip()
    for raw in (candidate, _slice_json_object(candidate)):
        if not raw:
            continue
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            continue
    return None


def _slice_json_object(value: str) -> str:
    start = value.find("{")
    end = value.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return ""
    return value[start : end + 1]


def _normalize_evidence_refs(value: Any, participant: Dict[str, Any], memory: Dict[str, Any], language: str) -> List[Dict[str, str]]:
    refs: List[Dict[str, str]] = []
    if isinstance(value, list):
        for item in value[:4]:
            if not isinstance(item, dict):
                continue
            memory_id = _text(item.get("memory_id") or item.get("id"))
            quote = _text(item.get("quote") or item.get("fragment") or item.get("text"))[:160]
            reason = _text(item.get("reason") or item.get("why"))[:160]
            if not memory_id and memory.get("id"):
                memory_id = memory["id"]
            if quote or reason or memory_id:
                refs.append(
                    {
                        "memory_id": memory_id,
                        "quote": quote,
                        "reason": reason or ("supports this line" if language == "English" else "支撑这句对白"),
                    }
                )

    return refs[:3] if refs else _default_evidence_refs(participant, memory, language)


def _default_evidence_refs(participant: Dict[str, Any], memory: Dict[str, Any], language: str) -> List[Dict[str, str]]:
    refs: List[Dict[str, str]] = []
    seen = set()
    candidates = [memory] + [item for item in participant.get("related_memories", []) if isinstance(item, dict)]
    for item in candidates:
        memory_id = _text(item.get("id"))
        key = memory_id or _text(item.get("content") or item.get("summary"))[:40]
        if key in seen:
            continue
        seen.add(key)
        quote = _text(item.get("summary") or item.get("content"))[:160]
        if not quote and not memory_id:
            continue
        refs.append(
            {
                "memory_id": memory_id,
                "quote": quote,
                "reason": "current memory context" if language == "English" else "当前记忆提供场景依据",
            }
        )
        if len(refs) >= 2:
            break
    return refs


def _normalize_inference_notes(value: Any, language: str) -> List[str]:
    notes: List[str] = []
    if isinstance(value, list):
        notes = [_text(item)[:160] for item in value if _text(item)]
    elif _text(value):
        notes = [_text(value)[:160]]
    return notes[:3]


def _plain_text_inference_note(language: str) -> str:
    if language == "English":
        return "The model returned plain dialogue, so the exact inferred part was not separated."
    return "模型返回了普通对白，系统未能进一步拆分具体推测部分。"


def _normalize_confidence(value: Any, evidence_refs: List[Dict[str, str]], inference_notes: List[str]) -> str:
    normalized = _text(value).lower()
    if normalized in {"high", "medium", "low"}:
        return normalized
    if not evidence_refs:
        return "low"
    return "medium" if inference_notes else "high"


def _fallback_persona_turn(content: str, participant: Dict[str, Any], memory: Dict[str, Any], language: str) -> Dict[str, Any]:
    evidence_refs = _default_evidence_refs(participant, memory, language)
    evidence_ids = [ref["memory_id"] for ref in evidence_refs if ref.get("memory_id")]
    return {
        "content": _trim_reply(content, content),
        "evidence_refs": evidence_refs,
        "evidence_ids": list(dict.fromkeys(evidence_ids or participant.get("evidence_ids", []))),
        "inference_notes": [_plain_text_inference_note(language)],
        "confidence": "low",
    }

def _participants_for_round(participants: List[Dict[str, Any]], round_index: int) -> List[Dict[str, Any]]:
    if round_index <= 1 or len(participants) <= 1:
        return participants

    speaker_count = random.randint(1, len(participants))
    return random.sample(participants, speaker_count)
def _persona_system_prompt(participant: Dict[str, Any], language: str, simulation_mode: str) -> str:
    name = participant["name"]
    profile = participant.get("persona_profile") or {}
    style = _text(profile.get("speaking_style"), "自然、短句、像在当场接话" if language == "Chinese" else "natural, brief, like speaking in the scene")
    mode_instruction = _simulation_mode_instruction(simulation_mode, language)
    if language == "English":
        return f"""You are roleplaying "{name}" inside one memory story.
The memory story and private fragments are your only evidence. Stay inside them.
Mode focus: {mode_instruction}
Speaking style: {style}

Return one valid JSON object only, with this shape:
{{
  "content": "the line this character says",
  "evidence_refs": [{{"memory_id": "id if known", "quote": "short supporting memory fragment", "reason": "why it supports the line"}}],
  "inference_notes": ["what part is inferred rather than directly stated"],
  "confidence": "high|medium|low"
}}

Content rules:
- 1 to 2 short sentences, 20-55 words.
- Speak in first person as {name}; no role name, narration, analysis, or parentheses.
- You may infer a feeling or motive, but do not invent hard events outside the story.
- If there is prior public dialogue, respond to one specific previous line.
- Keep evidence_refs and inference_notes brief."""

    return f"""你正在扮演记忆故事里的「{name}」。
记忆故事和私有片段就是你的全部依据，只能待在这些材料里。
推演模式：{mode_instruction}
说话风格：{style}

只返回一个合法 JSON 对象，结构如下：
{{
  "content": "这个人物说出的一句对白",
  "evidence_refs": [{{"memory_id": "已知记忆ID", "quote": "短依据片段", "reason": "为什么支撑这句对白"}}],
  "inference_notes": ["哪些部分是推测而非原文事实"],
  "confidence": "high|medium|low"
}}

对白规则：
- 1 到 2 句，20 到 55 字。
- 用「{name}」的第一人称说话；不要写角色名、旁白、分析、括号说明。
- 可以补足感受或动机，但不要编造故事外的硬事实。
- 如果已有公开对话，就接住其中某一句回应。
- evidence_refs 和 inference_notes 要短。"""
def _persona_user_prompt(
    memory: Dict[str, Any],
    participant: Dict[str, Any],
    public_turns: List[Dict[str, Any]],
    user_question: str,
    language: str,
    round_index: int,
    simulation_mode: str,
) -> str:
    related = _format_related_memories(participant.get("related_memories", []), language)
    relationships = _format_relationships(participant.get("relationships", []), language)
    public_dialogue = _format_public_turns(public_turns)
    mode_instruction = _simulation_mode_instruction(simulation_mode, language)
    if language == "English":
        task = "It is your turn. Say one natural line from inside the scene." if round_index <= 1 else "It is your turn. Respond to one previous line, then add one small angle."
        return "\n\n".join(
            [
                f"Memory story:\n[id={memory.get('id') or 'current'}] {_memory_story(memory)}",
                f"Character you play: {participant['name']}",
                f"Character image:\n{participant.get('description') or 'Read it from the story.'}",
                f"Private related fragments:\n{related}",
                f"Relationship clues:\n{relationships}",
                f"Public dialogue so far:\n{public_dialogue}",
                f"Luoyi's prompt: {user_question}",
                f"Mode focus: {mode_instruction}",
                f"Task: {task} Return JSON only. The content field must be just the spoken line.",
            ]
        )

    task = "轮到你了，直接从场景里说一句自然的话。" if round_index <= 1 else "轮到你了，接住上一轮某个人的一句话，再补一个小角度。"
    return "\n\n".join(
        [
            f"记忆故事：\n[id={memory.get('id') or 'current'}] {_memory_story(memory)}",
            f"你扮演的人物：{participant['name']}",
            f"人物形象：\n{participant.get('description') or '从故事中自行把握'}",
            f"你的私有相关片段：\n{related}",
            f"你的关系线索：\n{relationships}",
            f"目前公开对话：\n{public_dialogue}",
            f"洛忆给出的场景任务：{user_question}",
            f"推演模式重点：{mode_instruction}",
            f"当前任务：{task} 只返回 JSON，content 字段只能是人物对白。",
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
        participant_type = _text(raw.get("type"), "PERSON")
        if not name or (participant_type != "SELF" and _is_disallowed_persona_name(name)):
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
                "type": participant_type,
                "description": _text(raw.get("description")),
                "aliases": raw.get("aliases") if isinstance(raw.get("aliases"), list) else [],
                "related_memories": related_memories,
                "relationships": relationships,
                "persona_profile": raw.get("persona_profile") if isinstance(raw.get("persona_profile"), dict) else {},
                "evidence_ids": list(dict.fromkeys(evidence_ids)),
            }
        )
        if len(participants) >= 5:
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
                "evidence_refs": item.get("evidence_refs") if isinstance(item.get("evidence_refs"), list) else [],
                "inference_notes": item.get("inference_notes") if isinstance(item.get("inference_notes"), list) else [],
                "confidence": _text(item.get("confidence")),
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
    text = _strip_outer_quotes(text.replace("\r", "").strip())
    text = _remove_meta_hedges(text)
    text = _strip_outer_quotes(text)
    if len(text) > 180:
        punctuation = max(text.rfind("。", 0, 180), text.rfind("！", 0, 180), text.rfind("？", 0, 180), text.rfind(".", 0, 180))
        text = text[: punctuation + 1] if punctuation > 60 else text[:180].rstrip() + "..."
    return text or fallback


def _remove_meta_hedges(value: str) -> str:
    text = _text(value)
    if not text:
        return text

    if not _contains_meta_hedge(text):
        return text

    quoted = _extract_quoted_dialogue(text)
    if quoted:
        return quoted

    for phrase in _META_HEDGE_PHRASES:
        text = re.sub(re.escape(phrase), "", text, flags=re.IGNORECASE)

    text = _strip_dialogue_intro(text)
    text = _strip_outer_quotes(text)

    if not _contains_meta_hedge(text):
        return text

    parts = [part.strip() for part in re.findall(r"[^。！？.!?\n]+[。！？.!?]?", text) if part.strip()]
    parts = [part for part in parts if not _contains_meta_hedge(part)]
    text = "".join(parts[:2]).strip()
    return _strip_dialogue_intro(text)


_META_HEDGE_PHRASES = [
    "我先按这段记忆推演",
    "我能确定的线索不多",
    "证据不足",
    "我无法知道",
    "只能基于",
    "基于记忆证据",
    "不代表真实人物",
    "作为AI",
    "作为一个AI",
    "作为人工智能",
    "based on the memory",
    "based on the available memory",
    "insufficient evidence",
    "i cannot know",
    "as an ai",
]


def _contains_meta_hedge(value: str) -> bool:
    normalized = _text(value).lower()
    return any(phrase.lower() in normalized for phrase in _META_HEDGE_PHRASES)


def _extract_quoted_dialogue(value: str) -> str:
    for pattern in (r"[“「『](.*?)[”」』]", r'"(.*?)"', r"'(.*?)'"):
        matches = re.findall(pattern, value, flags=re.DOTALL)
        for candidate in reversed(matches):
            text = _strip_outer_quotes(candidate)
            if text and not _contains_meta_hedge(text):
                return text
    return ""


def _strip_dialogue_intro(value: str) -> str:
    text = _text(value).strip().lstrip(" \t\n:：,，;；。.-")
    text = re.sub(
        r"^(?:我会说|我想说|我可以说|我的对白是|这句对白是|角色对白|对白|回复|回答|line|reply|answer)\s*[:：,，;；。.-]*\s*",
        "",
        text,
        flags=re.IGNORECASE,
    ).strip()

    colon_index = max(text.rfind("："), text.rfind(":"))
    if colon_index > 0:
        prefix = text[:colon_index].strip()
        if len(prefix) <= 24 and any(marker in prefix for marker in ("说", "对白", "回复", "回答", "line", "reply", "answer")):
            text = text[colon_index + 1 :].strip()

    return text.strip().lstrip(" \t\n:：,，;；。.-")


def _strip_outer_quotes(value: str) -> str:
    text = _text(value).strip()
    quote_pairs = (("“", "”"), ("「", "」"), ("『", "』"), ('"', '"'), ("'", "'"))
    changed = True
    while changed and len(text) >= 2:
        changed = False
        for left, right in quote_pairs:
            if text.startswith(left) and text.endswith(right):
                text = text[len(left) : len(text) - len(right)].strip()
                changed = True
    return text


def _message_content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                parts.append(str(block.get("text") or block.get("content") or ""))
        return "\n".join(part for part in parts if part).strip()
    return "" if content is None else str(content)

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


