from types import SimpleNamespace

from services.agent_dialogue_service import AgentDialogueService, _trim_reply


class _FakeCompletions:
    def __init__(self, content):
        self.content = content

    def create(self, **kwargs):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))]
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