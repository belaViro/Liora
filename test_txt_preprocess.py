#!/usr/bin/env python
"""Test txt file preprocessing"""
import os
import sys
import tempfile

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

def test_txt_preprocess():
    app = create_app()

    with app.test_client() as client:
        with app.app_context():
            # Create a temp txt file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
                f.write('这是一段测试文字内容。')
                temp_path = f.name

            try:
                with open(temp_path, 'rb') as f:
                    response = client.post(
                        '/api/memory/preprocess',
                        data={'file': (f, 'test.txt')},
                        content_type='multipart/form-data'
                    )

                print(f"Status: {response.status_code}")
                print(f"Response: {response.get_json()}")

                data = response.get_json()
                if data and data.get('success'):
                    content = data['data']['content']
                    print(f"Content length: {len(content)}")
                    print(f"Content: {content[:100]}")
                else:
                    print("FAILED:", data)
            finally:
                os.unlink(temp_path)

if __name__ == '__main__':
    test_txt_preprocess()