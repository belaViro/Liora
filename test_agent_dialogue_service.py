from types import SimpleNamespace
from unittest.mock import patch

from services.agent_dialogue_service import AgentDialogueService, _trim_reply


class _FakeCompletions:
    def __init__(self, content):
        self.content = content

    def create(self, **kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
        )



class _SequenceCompletions:
    def __init__(self, contents):
        self.contents = list(contents)
        self.max_tokens_seen = []

    def create(self, **kwargs):
        self.max_tokens_seen.append(kwargs.get('max_tokens'))
        content = self.contents.pop(0) if self.contents else ''
        finish_reason = 'length' if not content else 'stop'
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content), finish_reason=finish_reason)]
        )


class _SequenceLLMService:
    model_name = 'fake-model'

    def __init__(self, contents):
        self.completions = _SequenceCompletions(contents)
        self.client = SimpleNamespace(
            chat=SimpleNamespace(completions=self.completions)
        )

class _FakeLLMService:
    model_name = 'fake-model'

    def __init__(self, content):
        self.client = SimpleNamespace(
            chat=SimpleNamespace(completions=_FakeCompletions(content))
        )


def test_trim_reply_keeps_dialogue_after_meta_prefix():
    reply = '我先按这段记忆推演：我其实一直记得那天你站在门口，话没说完就笑了。'

    assert _trim_reply(reply, 'fallback') == '我其实一直记得那天你站在门口，话没说完就笑了。'


def test_trim_reply_extracts_quoted_dialogue_from_hedged_reply():
    reply = '基于记忆证据，我会说：「我其实一直记得那天你站在门口。」'

    assert _trim_reply(reply, 'fallback') == '我其实一直记得那天你站在门口。'


def test_trim_reply_still_falls_back_for_pure_refusal():
    assert _trim_reply('我无法知道。证据不足。', 'fallback') == 'fallback'


def test_chat_does_not_fall_back_when_cleanup_salvages_persona_line():
    service = AgentDialogueService(_FakeLLMService('我先按这段记忆推演：我那天其实是想留下来多听你说一句。'))

    result = service._chat('system', 'user', max_tokens=180, temperature=0.7, fallback='fallback')

    assert result == '我那天其实是想留下来多听你说一句。'


def test_first_round_uses_all_participants_and_later_round_uses_random_subset():
    service = AgentDialogueService(_FakeLLMService('我会认真接住这句话。'))
    participants = [
        {'id': 'p1', 'name': '阿一', 'type': 'PERSON'},
        {'id': 'p2', 'name': '阿二', 'type': 'PERSON'},
        {'id': 'p3', 'name': '阿三', 'type': 'PERSON'},
    ]
    payload = {
        'memory': {'id': 'm1', 'content': '阿一、阿二、阿三一起回忆那天的事。'},
        'participants': participants,
        'rounds': 2,
        'start_round': 1,
        'include_summary': False,
    }

    with patch('services.agent_dialogue_service.random.randint', return_value=2), \
         patch('services.agent_dialogue_service.random.sample', side_effect=lambda items, count: items[:count]):
        events = list(service.create_dialogue_stream(payload))

    turns = [event['data']['turn'] for event in events if event['event'] == 'turn']
    first_round_names = [turn['agent_name'] for turn in turns if turn['round'] == 1]
    second_round_names = [turn['agent_name'] for turn in turns if turn['round'] == 2]

    assert first_round_names == ['阿一', '阿二', '阿三']
    assert second_round_names == ['阿一', '阿二']


def test_chat_retries_empty_reply_with_larger_token_budget():
    llm_service = _SequenceLLMService(['', '我这次直接把话说清楚。'])
    service = AgentDialogueService(llm_service)

    result = service._chat('system', 'user', max_tokens=2400, temperature=0.7, fallback='fallback')

    assert result == '我这次直接把话说清楚。'
    assert llm_service.completions.max_tokens_seen == [2400, 4800]

def test_structured_persona_turn_metadata_is_preserved():
    reply = '''{
        "content": "我那天其实想把话说完。",
        "evidence_refs": [
            {"memory_id": "m1", "quote": "他在门口停了很久", "reason": "支撑停留和未说完"}
        ],
        "inference_notes": ["想把话说完是基于停留动作的推测"],
        "confidence": "high"
    }'''
    service = AgentDialogueService(_FakeLLMService(reply))
    payload = {
        'memory': {'id': 'm1', 'content': '他在门口停了很久，最后还是笑着离开。'},
        'participants': [{'id': 'p1', 'name': '阿一', 'type': 'PERSON', 'current_memory_id': 'm1'}],
        'rounds': 1,
        'include_summary': False,
        'simulation_mode': 'relationship',
    }

    events = list(service.create_dialogue_stream(payload))
    turn = next(event['data']['turn'] for event in events if event['event'] == 'turn')
    session = next(event['data']['session'] for event in events if event['event'] == 'done')

    assert session['simulation_mode'] == 'relationship'
    assert turn['content'] == '我那天其实想把话说完。'
    assert turn['evidence_refs'][0]['memory_id'] == 'm1'
    assert turn['inference_notes'] == ['想把话说完是基于停留动作的推测']
    assert turn['confidence'] == 'high'


def test_luoyi_summary_includes_structured_analysis():
    persona_reply = '''{
        "content": "我那天其实想把话说完。",
        "evidence_refs": [
            {"memory_id": "m1", "quote": "他在门口停了很久", "reason": "支撑停留和未说完"}
        ],
        "inference_notes": ["想把话说完是基于停留动作的推测"],
        "confidence": "medium"
    }'''
    summary_reply = '''{
        "content": "洛忆总结：这轮更像是在确认那次停留背后还有未完成的话。",
        "analysis": {
            "consensus": ["大家都把门口停留视为关系变化的信号"],
            "conflicts": ["阿一觉得是想靠近，阿二的视角更像回避"],
            "gaps": ["缺少这次事件之后两人再次互动的记忆"],
            "next_questions": ["后来你们还有单独联系吗？"]
        }
    }'''
    service = AgentDialogueService(_SequenceLLMService([persona_reply, summary_reply]))
    payload = {
        'memory': {'id': 'm1', 'content': '他在门口停了很久，最后还是笑着离开。'},
        'participants': [{'id': 'p1', 'name': '阿一', 'type': 'PERSON', 'current_memory_id': 'm1'}],
        'rounds': 1,
        'include_summary': True,
        'simulation_mode': 'relationship',
    }

    events = list(service.create_dialogue_stream(payload))
    host_turn = next(event['data']['turn'] for event in events if event['event'] == 'turn' and event['data']['turn']['role'] == 'host')
    session = next(event['data']['session'] for event in events if event['event'] == 'done')

    assert session['mode'] == 'memory_review'
    assert session['simulation_mode'] == 'relationship'
    assert host_turn['content'] == '洛忆总结：这轮更像是在确认那次停留背后还有未完成的话。'
    assert host_turn['analysis']['consensus'] == ['大家都把门口停留视为关系变化的信号']
    assert host_turn['analysis']['conflicts'] == ['阿一觉得是想靠近，阿二的视角更像回避']
    assert host_turn['analysis']['gaps'] == ['缺少这次事件之后两人再次互动的记忆']
    assert host_turn['analysis']['next_questions'] == ['后来你们还有单独联系吗？']



def test_participant_limit_allows_five_people():
    service = AgentDialogueService(_FakeLLMService('我会认真接住这句话。'))
    participants = [
        {'id': f'p{index}', 'name': f'人物{index}', 'type': 'PERSON'}
        for index in range(1, 6)
    ]
    payload = {
        'memory': {'id': 'm1', 'content': '人物1、人物2、人物3、人物4、人物5一起回忆那天的事。'},
        'participants': participants,
        'rounds': 1,
        'include_summary': False,
    }

    events = list(service.create_dialogue_stream(payload))
    turns = [event['data']['turn'] for event in events if event['event'] == 'turn']
    session = next(event['data']['session'] for event in events if event['event'] == 'done')

    assert [participant['name'] for participant in session['participants']] == [f'人物{index}' for index in range(1, 6)]
    assert [turn['agent_name'] for turn in turns] == [f'人物{index}' for index in range(1, 6)]
