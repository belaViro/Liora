# ◆ Liora

*A personal memory network — powered by AI*

```
Liora /liˈɔːrə/ — "to weave" or "binding together"
```

---

## About

Liora transforms how you capture and explore memories. Upload text, images, or audio, and watch as AI constructs a living knowledge graph of your experiences — connecting people, places, and moments across time.

**Core capabilities:**

- **Knowledge graph visualization** — D3.js force-directed graph with 5 layouts
- **Multimodal memory input** — text, images, audio with automatic entity extraction
- **Semantic search** — vector + keyword hybrid search
- **On This Day** — rediscover memories from the same date in past years
- **Memory cards** — vintage archive-style export with AI-generated reflections
- **AI companion** — "洛忆" responds to memories with warmth and insight

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/bela-viro/Liora.git
cd Liora/MemoryWeaver

# Create environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env
# Edit .env with your LLM API credentials

# Launch
python app.py
```

Open [http://localhost:5000](http://localhost:5000)

### Configuration

Liora supports multiple LLM providers:

| Provider | Endpoint | Model |
|:---------|:---------|:------|
| MiniMax | `api.minimaxi.chat/v1` | `minimax-text-01` |
| OpenAI | `api.openai.com/v1` | `gpt-4` |
| 智谱AI | `open.bigmodel.cn/api/paas/v4` | `glm-4` |
| SiliconFlow | `api.siliconflow.cn/v1` | `Qwen/Qwen2.5-72B` |

---

## Architecture

```
MemoryWeaver/
├── app.py                     # Flask application
├── requirements.txt          # Dependencies
│
├── services/                 # Business logic
│   ├── llm_service.py        # LLM interface
│   ├── memory_service.py     # Memory CRUD
│   ├── graph_service.py      # Knowledge graph
│   ├── embedding_service.py   # Vector search
│   └── temporal_extractor.py # Time parsing
│
├── templates/index.html      # SPA frontend
├── static/js/app.js          # D3.js visualization
└── data/                     # Persistent storage
    ├── memories.json         # Memory store
    ├── graph.json            # Graph data
    └── faiss_index.bin       # Vector index
```

### Technology Stack

| Layer | Technology |
|:------|:-----------|
| Backend | Flask 3.0+, Flask-SocketIO, NetworkX, FAISS |
| Frontend | D3.js v7, Socket.IO, html2canvas |
| AI | MiniMax / OpenAI / Qwen, vector similarity |

---

## Features in Detail

### Knowledge Graph

Five visualization layouts:
- **Force** — physics simulation, natural distribution
- **Ring** — nodes evenly distributed on a circle
- **Hierarchical** — vertical layers by connection degree
- **Grid** — orderly rows and columns
- **Concentric** — central nodes on inner rings

Drag nodes to reposition, scroll to zoom, click for details.

### Memory Input

Click "录入记忆" to add:
- Free-form text with @mentions for entities and #tags for topics
- Images (photos, screenshots)
- Audio recordings

AI automatically extracts entities and relationships, building the graph.

### On This Day

Click the clock icon to travel back. See memories from this date in previous years. Generate vintage-style cards to share.

### AI Companion — 洛忆

Every memory can receive a warm, thoughtful response from 洛忆 — your AI companion that knows your memory network.

---

## Design Philosophy

| Element | Reference |
|:--------|:----------|
| Visual style | MiroFish minimalism |
| Graph physics | D3.js force simulation |
| Typography | Monospace labels |
| Cards | Vintage archive aesthetic |
| Color accent | `#7B2D8E` — the depth of memory |

---

## License

[GPL v2](LICENSE)

---

*Remember well. Connect everything.*
