<p align="center">
  <img src="static/logo.png" alt="Liora Logo" width="400">
</p>

<h1 align="center">Liora</h1>

<p align="center">
  <b>个人记忆网络系统</b> — 基于大模型的多模态知识图谱
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.0.1-blue" alt="Version">
  <img src="https://img.shields.io/badge/python-3.8%2B-blue?logo=python" alt="Python">
  <img src="https://img.shields.io/badge/flask-3.0%2B-green?logo=flask" alt="Flask">
  <img src="https://img.shields.io/badge/license-GPL%20v2-orange" alt="License">
</p>

---

## 关于

Liora 改变了你记录和探索记忆的方式。上传文字、图片或音频，AI 会自动构建属于你的知识图谱——连接人、地点和跨越时间的时刻。

**核心功能：**

- **知识图谱可视化** — D3.js 力导向图，支持拖拽、缩放、探索
- **多模态记忆录入** — 文字、图片、音频，自动提取实体和关系
- **语义搜索** — 向量 + 关键词混合搜索，快速找到相关记忆
- **历史上的今天** — 回顾往年今日的记忆，发现时间的连接
- **记忆卡片** — 复古档案风格导出，AI 生成温暖回应
- **AI 洛忆** — 智能伙伴为记忆注入生命，情绪自适应互动
- **智能预测** — 基于记忆网络的智能洞察和建议

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
├── app.py                     # Flask 应用入口
├── requirements.txt          # Python 依赖
├── .env.example              # 环境变量模板
│
├── services/                 # 业务逻辑层
│   ├── llm_service.py        # LLM 接口封装
│   ├── memory_service.py     # 记忆管理
│   ├── graph_service.py      # 知识图谱构建
│   ├── embedding_service.py   # 向量搜索
│   ├── temporal_extractor.py # 时间解析
│   ├── enhanced_knowledge_extractor.py  # 知识抽取
│   └── prediction_service.py # 智能预测
│
├── templates/                # HTML 模板
│   ├── index.html            # 主页面
│   └── components/           # 组件模板
│
├── static/                   # 静态资源
│   ├── js/                   # JavaScript
│   ├── css/                  # 样式文件（模块化）
│   └── uploads/              # 上传文件存储
│
└── data/                     # 数据存储
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
| 存储 | JSON + FAISS 向量索引 |

---

## 功能详解

### 知识图谱

力导向图可视化，支持：
- 拖拽节点调整位置
- 滚轮缩放和平移
- 点击查看详情和关联
- 实体搜索和聚焦

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

### 智能预测

基于知识图谱和时间维度，提供智能洞察和记忆趋势分析。

---

## 更新日志

### v1.0.1 (2026-04-12)
- ✨ 新增智能预测服务
- 🎨 CSS 样式模块化重构
- 🔧 优化图谱渲染性能
- 🐛 修复历史上的今天编码问题

### v1.0.0 (2026-04-12)
- 🎉 初始版本发布
- 多模态记忆录入（文字/图片/音频）
- AI 内容理解（实体抽取/关系抽取/情感分析）
- 知识图谱可视化
- 语义搜索（向量+关键词混合）
- 历史上的今天功能
- 记忆卡片导出
- AI 洛忆智能伙伴
- 统计面板

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

## 贡献

欢迎提交 Issue 和 Pull Request！

---

## 许可证

[GPL v2](LICENSE)

---

<p align="center">
  <i>Remember well. Connect everything.</i>
</p>
