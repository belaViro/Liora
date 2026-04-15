"""
测试 FunAudioLLM/SenseVoiceSmall 语音转文字
"""
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(
    api_key=os.getenv('WHISPER_API_KEY'),
    base_url=os.getenv('WHISPER_BASE_URL', 'https://api.siliconflow.cn/v1')
)

audio_file = r"D:\记忆网络\MemoryWeaver\test\滴滴出行-2604070943.mp3"

if os.path.exists(audio_file):
    print(f"File exists: {audio_file}")
    print("Transcribing...")
    with open(audio_file, "rb") as f:
        response = client.audio.transcriptions.create(
            model="FunAudioLLM/SenseVoiceSmall",
            file=f
        )
    print(f"Result: {response.text}")
else:
    print(f"Audio file not found: {audio_file}")
