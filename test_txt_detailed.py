#!/usr/bin/env python
"""Detailed test of txt file upload"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app

def test_txt_detailed():
    app = create_app()

    with app.test_client() as client:
        with app.app_context():
            # Create test file with explicit content
            with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False, encoding='utf-8') as f:
                test_content = 'Hello, this is a test file with Chinese content: 你好世界'
                f.write(test_content)
                temp_path = f.name

            print(f"Temp file path: {temp_path}")
            print(f"Temp file size before upload: {os.path.getsize(temp_path)}")

            with open(temp_path, 'rb') as f:
                # Test with explicit filename
                response = client.post(
                    '/api/memory/preprocess',
                    data={'file': (f, 'test.txt')},
                    content_type='multipart/form-data'
                )

            result = response.get_json()
            print(f"Status: {response.status_code}")
            print(f"Success: {result.get('success')}")
            print(f"Data: {result.get('data')}")

            # Check the saved file
            saved_path = result.get('data', {}).get('file_path')
            if saved_path and os.path.exists(saved_path):
                size = os.path.getsize(saved_path)
                print(f"Saved file size: {size}")
                with open(saved_path, 'r', encoding='utf-8') as sf:
                    content = sf.read()
                print(f"Saved content: {content}")
            else:
                print(f"Saved file not found or path is None: {saved_path}")

            os.unlink(temp_path)

if __name__ == '__main__':
    test_txt_detailed()