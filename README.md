# ◆ Liora

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python">
  <img src="https://img.shields.io/badge/Flask-3.0+-green.svg" alt="Flask">
  <img src="https://img.shields.io/badge/D3.js-v7-orange.svg" alt="D3.js">
  <img src="https://img.shields.io/badge/License-GPLv2-blue.svg" alt="License">
  <img src="https://img.shields.io/badge/AI-MiniMax-ff69b4.svg" alt="AI">
</p>

> **你的个人记忆网络** — 用大模型理解你的过去，构建独一无二的知识图谱

---

<p align="center">
  <img src="https://img.shields.io/badge/🧠-知识图谱可视化-7B2D8E?style=for-the-badge" alt="">
  <img src="https://img.shields.io/badge/📝-多模态记忆-7B2D8E?style=for-the-badge" alt="">
  <img src="https://img.shields.io/badge/🔍-语义搜索-7B2D8E?style=for-the-badge" alt="">
  <img src="https://img.shields.io/badge/⏰-历史上的今天-7B2D8E?style=for-the-badge" alt="">
  <img src="https://img.shields.io/badge/🎨-记忆卡片-7B2D8E?style=for-the-badge" alt="">
</p>

---

## ✨ 功能特性

| 核心功能 | 说明 |
|:---------|:-----|
| 🧠 **知识图谱可视化** | D3.js 力导向图，支持 5 种布局：力导向 / 圆环 / 层次 / 网格 / 同心圆 |
| 📝 **多模态记忆录入** | 支持文字、图片、音频，自动提取实体和关系 |
| 🔍 **智能语义搜索** | 向量检索 + 关键词匹配，混合搜索更精准 |
| 🤖 **大模型理解** | MiniMax / OpenAI / 智谱AI，自动构建知识网络 |
| ⏰ **历史上的今天** | 回顾往年今日，感受时光流转 |
| 🎨 **记忆卡片导出** | 精美复古风格，一键分享社交媒体 |
| 💬 **AI 洛忆** | 智能伙伴为记忆生成温暖回应 |
| 📊 **数据可视化** | 记忆统计、实体分布、情感分析热力图 |

---

## 🚀 快速开始

### 环境要求

| 依赖 | 版本 |
|:-----|:-----|
| Python | ≥ 3.11 |
| 大模型 API | MiniMax / OpenAI / SiliconFlow |

### 安装步骤

```bash
# 克隆项目
git clone https://github.com/bela-viro/Liora.git
cd Liora/MemoryWeaver

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt
```

### 配置

```bash
# 复制环境变量模板
cp .env.example .env
```

编辑 `.env` 文件：

```env
# LLM 配置（支持 MiniMax / OpenAI / 智谱AI / SiliconFlow）
LLM_API_KEY=your_api_key_here
LLM_BASE_URL=https://api.minimaxi.chat/v1
LLM_MODEL_NAME=minimax-text-01

# 可选：Embedding 服务
EMBEDDING_API_KEY=your_key
EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1
```

### 启动

```bash
python app.py
```

然后访问 [http://localhost:5000](http://localhost:5000)

---

## 📸 界面预览

### 知识图谱
```
┌─────────────────────────────────────────────────────────┐
│  ● ─── ● ─── ●                                        │
│   \    |    /    ← D3.js 力导向可视化                  │
│    \   |   /     ← 拖拽缩放                           │
│     ●──●──●      ← 节点点击查看详情                    │
│    /   |   \                                            │
└─────────────────────────────────────────────────────────┘
```

### 功能面板

| 录入记忆 | 探索面板 | 统计面板 |
|:--------:|:--------:|:--------:|
| 多模态输入 | 节点详情 + AI问答 | 记忆热力图 |

---

## 🏗️ 项目结构

```
MemoryWeaver/
├── app.py                      # 🐍 Flask 主应用
├── requirements.txt            # 📦 依赖列表
├── .env.example               # ⚙️  环境变量模板
│
├── services/                  # 🔧 服务层
│   ├── llm_service.py          # 🤖 大模型接口
│   ├── memory_service.py       # 💾 记忆管理
│   ├── graph_service.py        # 🕸️ 知识图谱
│   ├── embedding_service.py    # 🔢 向量嵌入
│   └── temporal_extractor.py   # ⏰ 时间提取
│
├── templates/
│   └── index.html             # 🎨 前端单页应用
│
├── static/
│   ├── js/app.js             # ⚡ 前端逻辑 (D3.js)
│   └── uploads/               # 📁 上传文件
│
└── data/                      # 💾 数据存储
    ├── memories.json          # 📝 记忆数据
    ├── graph.json             # 🕸️ 图谱数据
    └── faiss_index.bin        # 🔢 向量索引
```

---

## 🛠️ 技术栈

### 后端
```
Flask 3.0+          🌐 Web 框架
Flask-SocketIO     📡 实时通信
NetworkX           🔗 图算法
FAISS              🔍 向量检索
sentence-transformers   📊 文本嵌入
```

### 前端
```
D3.js v7           📈 数据可视化
Socket.IO          🔌 实时通信
html2canvas        📸 DOM 转图片
Vanilla JS         ⚡ 无框架依赖
```

### AI
```
MiniMax Text-01     🧠 主模型
向量语义搜索        🔎 相似度匹配
```

---

## ⚙️ 配置说明

### 支持的大模型

| 提供商 | BASE_URL | 推荐模型 |
|:------:|:----------|:---------|
| MiniMax | `api.minimaxi.chat/v1` | `minimax-text-01` |
| OpenAI | `api.openai.com/v1` | `gpt-4` |
| 智谱AI | `open.bigmodel.cn/api/paas/v4` | `glm-4` |
| SiliconFlow | `api.siliconflow.cn/v1` | `Qwen/Qwen2.5-72B` |

### 图谱布局

| 布局 | 特点 |
|:-----|:-----|
| 力导向 | 物理模拟，自然分布 |
| 圆环 | 节点均匀分布在圆周 |
| 层次 | 按连接度数垂直分层 |
| 网格 | 整齐行列排列 |
| 同心圆 | 核心节点在内圈 |

---

## 📖 使用指南

### 1️⃣ 录入记忆
```
点击「录入记忆」→ 输入文字/上传图片 → AI 自动提取实体和关系
```

### 2️⃣ 探索图谱
```
拖拽节点调整位置 → 点击节点查看详情 → 与 AI 对话探索
```

### 3️⃣ 历史上的今天
```
点击顶部「时光」→ 查看往年今日记忆 → 生成精美卡片分享
```

### 4️⃣ 搜索记忆
```
顶部搜索框 → 输入关键词 → 结果高亮显示在图谱中
```

---

## 🎨 设计哲学

| 设计要素 | 来源 |
|:---------|:-----|
| **MiroFish** | 极简主义视觉风格 |
| **D3.js Force** | 物理交互体验 |
| **Monospace** | 代码风格标签 |
| **复古档案卡** | 记忆卡片设计灵感 |
| **紫色主题** `#7B2D8E` | 记忆的深邃感 |

---

## 📁 版本历史

| 版本 | 日期 | 更新内容 |
|:-----|:-----|:---------|
| **v1.0.0** | 2026-04-12 | 🎉 初始发布 |

---

## 📔 许可证

[![License: GPL v2](https://img.shields.io/badge/License-GPLv2-blue.svg)](LICENSE)

本项目基于 **GNU General Public License v2.0** 开源。

---

## 🙏 致谢

- 🖼️ 图谱可视化灵感来自 [MiroFish](https://github.com/tailord/MiroFish)
- 📊 力导向图基于 [D3.js](https://d3js.org/)
- 🎨 记忆卡片设计参考复古档案卡美学
- 🤖 AI 功能支持 [MiniMax](https://www.minimax.io/)

---

<p align="center">
  <strong>Made with ❤️ by bela_viro</strong>
  <br>
  <sub>◆ Liora — 你的个人记忆网络</sub>
</p>
