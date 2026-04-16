"""
测试硅基流动 API 连接
"""
import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

api_key = os.getenv('LLM_API_KEY')
base_url = os.getenv('LLM_BASE_URL', 'https://api.siliconflow.cn/v1')
model_name = os.getenv('LLM_MODEL_NAME', 'Qwen/Qwen2.5-72B-Instruct')

print(f"API Key: {api_key[:10]}...")
print(f"Base URL: {base_url}")
print(f"Model: {model_name}")

client = OpenAI(api_key=api_key, base_url=base_url)

try:
    response = client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "user", "content": "Hello, just testing. Reply with 'OK' if you receive this."}
        ],
        max_tokens=50
    )
        print(f"\n[OK] 连接成功！")
    print(f"回复: {response.choices[0].message.content}")
except Exception as e:
    print(f"\n[FAIL] 连接失败: {e}")0].message.content}")
except Exception as e:
    print(f"\n❌ 连接失败: {e}")
