# Liora

> 个人记忆网络系统 - 基于大模型的多模态知识图谱

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-blue.svg" alt="Python">
  <img src="https://img.shields.io/badge/Flask-3.0+-green.svg" alt="Flask">
  <img src="https://img.shields.io/badge/D3.js-v7-orange.svg" alt="D3.js">
  <img src="https://img.shields.io/badge/License-GPLv2-blue.svg" alt="License">
</p>

## ✨ 功能特性

- **🧠 知识图谱可视化** - D3.js 力导向图，支持多种布局（力导向/圆环/层次/网格/同心圆）
- **📝 多模态记忆录入** - 支持文字、图片、音频多种类型记忆
- **🔍 智能语义搜索** - 向量检索 + 关键词匹配混合搜索
- **🤖 大模型理解** - 自动提取实体、关系，构建知识图谱
- **📊 数据可视化** - 记忆统计、实体分布、关系分析
- **🎨 MiroFish 风格 UI** - 极简主义设计，点阵背景

## 🚀 快速开始

### 环境要求

- Python 3.11+
- 大模型 API 密钥（MiniMax / OpenAI / SiliconFlow）

### 安装

```bash
# 克隆项目
git clone https://github.com/bela-viro/Liora.git
cd Liora

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt
```

### 配置

复制环境变量模板并编辑：

```bash
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

访问 http://localhost:5000

## 📸 界面预览

| 知识图谱 | 记忆录入 | 搜索结果 |
|---------|---------|---------|
| 力导向图可视化 | 多模态输入 | 语义搜索高亮 |

## 🏗️ 项目结构

```
Liora/
├── app.py                      # Flask 主应用
├── requirements.txt            # 依赖列表
├── .env.example               # 环境变量模板
├── README.md                  # 项目说明
├── MemoryNetwork-Design.md    # 系统设计文档
│
├── services/                  # 服务层
│   ├── llm_service.py        # 大模型接口
│   ├── memory_service.py     # 记忆管理
│   ├── graph_service.py      # 知识图谱
│   ├── embedding_service.py  # 向量嵌入
│   └── temporal_extractor.py # 时间提取
│
├── templates/                 # 前端模板
│   └── index.html            # 主页面
│
├── static/                    # 静态资源
│   ├── js/app.js             # 前端逻辑 (D3.js)
│   └── uploads/              # 上传文件
│
└── data/                      # 数据存储
    ├── memories.json         # 记忆数据
    ├── graph.json            # 图谱数据
    └── faiss_index.bin       # 向量索引
```

## 🛠️ 技术栈

### 后端
- **Flask** - Web 框架
- **Flask-SocketIO** - 实时通信
- **NetworkX** - 图算法
- **FAISS** - 向量检索
- **sentence-transformers** - 文本嵌入

### 前端
- **D3.js v7** - 数据可视化/力导向图
- **原生 JavaScript** - 无框架依赖
- **CSS3** - 响应式设计

### AI/ML
- **MiniMax / OpenAI / Qwen** - 大语言模型
- **向量语义搜索** - 记忆相似度匹配

## ⚙️ 配置说明

### 支持的大模型提供商

| 提供商 | BASE_URL | 模型示例 |
|--------|----------|---------|
| MiniMax | `https://api.minimaxi.chat/v1` | `minimax-text-01` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4` |
| 智谱AI | `https://open.bigmodel.cn/api/paas/v4` | `glm-4` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-72B-Instruct` |

### 图谱布局选项

- **力导向** - 物理模拟，自然分布
- **圆环布局** - 节点均匀分布在圆周
- **层次布局** - 按连接度数垂直分层
- **网格布局** - 整齐行列排列
- **同心圆** - 核心节点在内圈

## 📝 使用指南

### 1. 录入记忆
- 点击「录入记忆」标签
- 输入文字或上传图片/音频
- 系统自动提取实体和关系

### 2. 探索图谱
- 左侧知识图谱可视化
- 拖拽节点调整位置
- 滚轮缩放，点击详情

### 3. 搜索记忆
- 顶部搜索框输入关键词
- 支持自然语言查询
- 结果高亮显示在图谱中

### 4. 筛选实体
- 按类型筛选（人物/地点/事件）
- 查看实体详情和关联记忆

## 🎨 设计参考

- **MiroFish** - 极简主义视觉风格
- **D3.js Force Simulation** - 物理交互体验
- **Monospace Typography** - 代码风格标签

## 📄 许可证

[GNU General Public License v2.0](LICENSE)

## 🙏 致谢

- 图谱可视化灵感来自 [MiroFish](https://github.com/tailord/MiroFish)
- 力导向图基于 [D3.js](https://d3js.org/)

---

<p align="center">Made with ❤️ by bela_viro</p>
