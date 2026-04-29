# Liora · Personal Knowledge Graph | AI Memory Network | RAG Second Brain

<p align="center">
  <strong>Language</strong>:
  <a href="README.md">English</a> |
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="static/logo.png" alt="Liora Logo" width="320">
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/version-v1.0.4-FF6B6B?style=for-the-badge" alt="Version"></a>
  <a href="#"><img src="https://img.shields.io/badge/python-3.8%2B-3572A5?style=for-the-badge&logo=python" alt="Python"></a>
  <a href="#"><img src="https://img.shields.io/badge/flask-3.0%2B-000000?style=for-the-badge&logo=flask" alt="Flask"></a>
  <a href="#"><img src="https://img.shields.io/badge/llm-OpenAI--compatible-00D4AA?style=for-the-badge&logo=openai" alt="LLM"></a>
  <a href="#"><img src="https://img.shields.io/badge/storage-IndexedDB-4ECDC4?style=for-the-badge" alt="IndexedDB"></a>
  <a href="#"><img src="https://img.shields.io/badge/visualization-D3.js-F9A826?style=for-the-badge&logo=d3.js" alt="D3.js"></a>
  <a href="#"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=for-the-badge&logo=gnu" alt="License"></a>
</p>

<p align="center">
  <b>Liora</b> is not a diary. It is a personal memory network for turning scattered moments into connected knowledge.<br>
  Record once, let AI extract the entities and relations, then explore your memories as a living graph.
</p>

---

## Core Idea

> **Remember well. Connect everything.**

Liora helps you build a second brain from personal memories. Text, images, and audio can be transformed into structured entities, relations, emotions, timelines, and searchable memory cards.

The current architecture keeps user data primarily in the browser through IndexedDB. The Flask backend acts as a stateless computation layer for AI understanding, embeddings, file preprocessing, graph exploration, prediction, and Luoyi chat.

---

## Screenshots

<p align="center">
  <img src="Screenshots/记忆网络.png" alt="Memory Network" width="49%"/>
  <img src="Screenshots/洛忆助手.png" alt="Luoyi Assistant" width="49%"/>
</p>

<p align="center">
  <img src="Screenshots/关联路径探索.png" alt="Relation Path Exploration" width="49%"/>
  <img src="Screenshots/数据统计.png" alt="Data Statistics" width="49%"/>
</p>

<p align="center">
  <img src="Screenshots/节点预测.png" alt="Node Prediction" width="49%"/>
  <img src="Screenshots/视角模式.png" alt="Persona Mode" width="49%"/>
</p>

---

## Highlights

| Module | What it does |
|:--|:--|
| Memory graph | Interactive D3.js graph for entities and relations extracted from your memories |
| Multimodal capture | Record text, upload images, and process audio with AI-assisted understanding |
| Hybrid search | Combines keyword matching with client-side vector similarity |
| AI exploration | Ask questions about selected nodes, relations, and paths |
| Luoyi assistant | A memory-aware chat companion with emotion-sensitive responses |
| Persona mode | Let Luoyi answer from the first-person perspective of a selected person node |
| Smart prediction | Predict likely missing entities and relations from graph context |
| Memory cards | Export polished visual memory cards as PNG images |
| Bilingual UI | Switch between Chinese and English UI text and AI response language |
| Data ownership | Browser-first storage with import/export support for memory archives |

---

## Quick Start

```bash
git clone https://github.com/belaViro/Liora.git
cd Liora

pip install -r requirements.txt
cp .env.example .env

python app.py
```

Open [http://localhost:5000](http://localhost:5000) after the server starts.

On Windows PowerShell, use this instead of `cp`:

```powershell
Copy-Item .env.example .env
```

---

## Configuration

Liora uses OpenAI-compatible chat/completion APIs. Edit `.env` before starting the app:

```env
LLM_API_KEY=sk-your-api-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o-mini

WHISPER_API_KEY=sk-your-api-key
WHISPER_BASE_URL=https://api.openai.com/v1
WHISPER_MODEL_NAME=whisper-1
```

The project also works with other OpenAI-compatible providers as long as the base URL, model name, and API key are configured correctly.

---

## Docker

```bash
docker build -t liora .
docker run --env-file .env -p 5000:5000 liora
```

Or use Docker Compose:

```bash
docker compose up --build
```

---

## How It Works

```text
Memory input
  -> file preprocessing / transcription / image understanding
  -> AI entity and relation extraction
  -> client-side IndexedDB persistence
  -> graph rendering with D3.js
  -> search, exploration, prediction, and Luoyi chat
```

The frontend owns most user data and interaction state. The backend exposes computation-focused endpoints:

| Area | Endpoint family |
|:--|:--|
| Memory preprocessing | `/api/memory/*` |
| AI quote for memory cards | `/api/memories/ai-quote` |
| Graph exploration | `/api/graph/explore` |
| Luoyi chat | `/api/luoyi/chat` |
| AI compute tasks | `/api/compute/*` |
| Runtime config | `/api/config` |

---

## Project Structure

```text
MemoryWeaver/
├── app.py                         # Flask app factory and Socket.IO setup
├── blueprints/                    # HTTP API modules
│   ├── compute.py                 # AI compute endpoints
│   ├── graph.py                   # Graph exploration endpoint
│   ├── luoyi.py                   # Luoyi chat endpoint
│   ├── memory.py                  # File preprocessing and AI quote endpoints
│   └── config.py                  # Runtime config endpoint
├── services/                      # Backend computation services
│   ├── llm_service.py             # OpenAI-compatible LLM client
│   └── temporal_extractor.py      # Temporal information extraction
├── static/
│   ├── css/                       # Modular frontend styles
│   └── js/
│       ├── api/compute-api.js     # Frontend compute API client
│       ├── db/                    # IndexedDB and vector search logic
│       ├── services/              # Client-side memory and graph services
│       ├── i18n.js                # Chinese/English UI runtime
│       ├── app.js                 # Main frontend app
│       └── prediction.js          # Smart prediction UI
├── templates/                     # Jinja templates and reusable components
├── data/                          # Sample data
├── Screenshots/                   # README screenshots
├── Dockerfile
└── docker-compose.yml
```

---

## Language Switching

The application UI supports Chinese and English. The language switch is available in the top navigation bar.

Language preference is stored locally in the browser. Memory content is not automatically translated; only UI text and AI response instructions switch languages.

---

## Changelog

### v1.0.4 · 2026-04-30

- Added Chinese/English UI switching.
- Added language-aware AI response instructions.
- Added English default README with a Chinese README switch.

### v1.0.3 · 2026-04-16

- Added Luoyi chat panel with memory-aware and emotion-sensitive responses.
- Added product detail panel.
- Modularized backend routes and frontend styles.
- Added Docker deployment support.

### v1.0.2 · 2026-04-13

- Added `.loyi` import/export flow.
- Added graph data fields such as `created_at`, `updated_at`, and `directed`.
- Added graph import/export controls.

### v1.0.1 · 2026-04-12

- Added smart node prediction.
- Refactored CSS into modular style files.
- Improved graph rendering performance.

### v1.0.0 · 2026-04-12

- Initial release.
- Multimodal memory input, AI understanding, D3 graph visualization, hybrid search, memory cards, Luoyi assistant, and statistics panel.

---

## Open to Opportunities

If you are interested in this project, feel free to reach out.

[![Email](https://img.shields.io/badge/_Email-bela_viro@outlook.com-blue?style=for-the-badge)](mailto:bela_viro@outlook.com)

---

## License

This project is released under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

If you modify and deploy Liora as a network service, you must provide the complete modified source code to users who access that service.

For the full license, see the [License](License) file.

<p align="center">
  <i>Time passes, but the network remains. Remember well. Connect everything.</i>
</p>
