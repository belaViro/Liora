from blueprints.compute import _extract_json_payload, _normalize_prediction_items


def test_extract_json_payload_from_fenced_output():
    payload = _extract_json_payload('说明文字\n```json\n{"predictions":[{"name":"咖啡馆"}]}\n```')

    assert payload['predictions'][0]['name'] == '咖啡馆'


def test_extract_json_payload_from_prefixed_plain_json():
    payload = _extract_json_payload('结果如下：{"predictions":[{"name":"相机"}]}')

    assert payload['predictions'][0]['name'] == '相机'


def test_normalize_prediction_items_clamps_and_defaults_fields():
    payload = {
        'predictions': [
            {
                'name': ' 摄影俱乐部 ',
                'type': 'event',
                'relation': '参加',
                'confidence': 2,
                'reason': '已有摄影展线索。',
            },
            {
                'name': '未知概念',
                'type': 'UNKNOWN',
                'confidence': 'bad',
            },
        ]
    }

    predictions = _normalize_prediction_items(payload, 5)

    assert predictions[0] == {
        'name': '摄影俱乐部',
        'type': 'EVENT',
        'relation_type': '参加',
        'confidence': 1.0,
        'reasoning': '已有摄影展线索。',
    }
    assert predictions[1]['type'] == 'CONCEPT'
    assert predictions[1]['confidence'] == 0.5