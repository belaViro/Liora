from types import SimpleNamespace

from flask import Flask

from blueprints.graph import graph_bp


class FakeCompletions:
    def __init__(self, contents):
        self.contents = list(contents)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        content = self.contents.pop(0)
        message = SimpleNamespace(content=content)
        choice = SimpleNamespace(message=message, finish_reason='stop')
        return SimpleNamespace(choices=[choice])


def make_client(contents):
    app = Flask(__name__)
    completions = FakeCompletions(contents)
    llm = SimpleNamespace(
        client=SimpleNamespace(chat=SimpleNamespace(completions=completions)),
        model_name='fake-model',
    )
    app.services = SimpleNamespace(llm_service=llm)
    app.register_blueprint(graph_bp)
    return app.test_client(), completions


def story_payload():
    return {
        'question': '请生成一个记忆故事',
        'language': 'Chinese',
        'context': {
            'node': {'id': 'n1', 'name': '海边日落', 'type': 'Event'},
            'memories': [{'content': '我和朋友在海边看日落。'}],
            'graph_summary': {},
        },
    }


def test_explore_retries_after_empty_completion():
    client, completions = make_client(['', '重试后生成的故事'])
    response = client.post('/api/graph/explore', json=story_payload())
    body = response.get_json()

    assert response.status_code == 200
    assert body['success'] is True
    assert body['data']['answer'] == '重试后生成的故事'
    assert body['data']['degraded'] is False
    assert len(completions.calls) == 2
    assert completions.calls[1]['max_tokens'] > completions.calls[0]['max_tokens']


def test_explore_falls_back_when_both_completions_are_empty():
    client, completions = make_client(['', None])
    response = client.post('/api/graph/explore', json=story_payload())
    body = response.get_json()

    assert response.status_code == 200
    assert body['success'] is True
    assert body['data']['answer']
    assert '海边日落' in body['data']['answer']
    assert '我和朋友在海边看日落' in body['data']['answer']
    assert body['data']['degraded'] is True
    assert len(completions.calls) == 2
