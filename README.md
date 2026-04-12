# Liora

**个人记忆网络系统** — 基于大模型的多模态知识图谱

---

## 关于

Liora 改变了你记录和探索记忆的方式。上传文字、图片或音频，AI 会自动构建属于你的知识图谱——连接人、地点和跨越时间的时刻。

**核心功能：**

- **知识图谱可视化** — D3.js 力导向图，支持 5 种布局
- **多模态记忆录入** — 文字、图片、音频，自动提取实体和关系
- **语义搜索** — 向量 + 关键词混合搜索
- **历史上的今天** — 回顾往年今日的记忆
- **记忆卡片** — 复古档案风格导出，AI 生成温暖回应
- **AI 洛忆** — 智能伙伴为记忆注入生命

---

## 快速开始

```bash
# 克隆并安装
git clone https://github.com/bela-viro/Liora.git
cd Liora/MemoryWeaver

# 创建环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置
cp .env.example .env
# 编辑 .env 填入你的 LLM API 凭证

# 启动
python app.py
```

打开 [http://localhost:5000](http://localhost:5000)

### 支持的大模型

| 提供商 | 端点 | 模型 |
|:------|:-----|:-----|
| MiniMax | `api.minimaxi.chat/v1` | `minimax-text-01` |
| OpenAI | `api.openai.com/v1` | `gpt-4` |
| 智谱AI | `open.bigmodel.cn/api/paas/v4` | `glm-4` |
| SiliconFlow | `api.siliconflow.cn/v1` | `Qwen/Qwen2.5-72B` |

---

## 项目结构

```
MemoryWeaver/
├── app.py                     # Flask 应用
├── requirements.txt          # 依赖
│
├── services/                 # 业务逻辑
│   ├── llm_service.py        # LLM 接口
│   ├── memory_service.py     # 记忆管理
│   ├── graph_service.py      # 知识图谱
│   ├── embedding_service.py   # 向量搜索
│   └── temporal_extractor.py # 时间解析
│
├── templates/index.html      # 单页应用
├── static/js/app.js          # D3.js 可视化
└── data/                     # 持久化存储
    ├── memories.json         # 记忆数据
    ├── graph.json            # 图谱数据
    └── faiss_index.bin       # 向量索引
```

### 技术栈

| 层级 | 技术 |
|:-----|:-----|
| 后端 | Flask 3.0+, Flask-SocketIO, NetworkX, FAISS |
| 前端 | D3.js v7, Socket.IO, html2canvas |
| AI | MiniMax / OpenAI / Qwen, 向量相似度 |

---

## 功能详解

### 知识图谱

五种可视化布局：
- **力导向** — 物理模拟，自然分布
- **圆环** — 节点均匀分布在圆周
- **层次** — 按连接度数垂直分层
- **网格** — 整齐行列排列
- **同心圆** — 核心节点在内圈

拖拽节点调整位置，滚轮缩放，点击查看详情。

### 记忆录入

点击「录入记忆」添加：
- 自由文字，支持 @提及实体、#标记主题
- 图片（照片、截图）
- 音频录音

AI 自动提取实体和关系，构建图谱。

### 历史上的今天

点击时钟图标穿越时空。查看往年今日的记忆，生成复古风格卡片分享。

### AI 洛忆

每条记忆都可以获得洛忆温暖而深思的回应——这位 AI 伙伴了解你的记忆网络。

---

## 设计哲学

| 元素 | 参考 |
|:-----|:-----|
| 视觉风格 | MiroFish 极简主义 |
| 图谱物理 | D3.js 力导向模拟 |
| 字体 | Monospace 等宽字体 |
| 卡片 | 复古档案美学 |
| 主色调 | `#7B2D8E` — 记忆的深邃感 |

---

## 许可证

[GPL v2](LICENSE)

---

*Remember well. Connect everything.*
