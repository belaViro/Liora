"""
测试硅基流动 Qwen2-VL 图像理解 API
"""
import base64
import os
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# 读取图片并转 base64
image_path = "static/logo.png"
with open(image_path, "rb") as f:
    img_data = base64.b64encode(f.read()).decode("utf-8")

# 初始化客户端
client = OpenAI(
    api_key=os.getenv("LLM_API_KEY"),
    base_url=os.getenv("LLM_BASE_URL", "https://api.siliconflow.cn/v1")
)

# 调用 Qwen2-VL
response = client.chat.completions.create(
    model="Qwen/Qwen2.5-VL-32B-Instruct",
    messages=[
        {
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{img_data}"}
                },
                {
                    "type": "text",
                    "text": "描述这张图片的内容，用中文回答"
                }
            ]
        }
    ],
    temperature=0.1,
    max_tokens=256
)

print("模型:", "Qwen/Qwen2.5-VL-32B-Instruct")
print("状态:", "OK - 连接成功")
print("响应:", response.choices[0].message.content)
