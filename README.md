# Liora · 个人记忆网络 | AI Memory Network

<p align="center">
  <img src="static/logo.png" alt="Liora Logo" width="320">
</p>

<p align="center">
  Liora 是一个浏览器优先的个人记忆网络。<br>
  记忆、实体、关系和向量主要保存在客户端，Flask 后端只负责理解、抽取、embedding 和探索所需的计算。
</p>

---

## 核心能力

| 模块 | 作用 |
|:--|:--|
| 记忆图谱 | 用 D3.js 把实体与关系可视化成可交互图谱 |
| 多模态录入 | 支持文字、图片、音频，统一进入记忆流程 |
| 混合搜索 | 客户端向量相似度 + 关键词 + 实体补召回 |
| 洛忆聊天 | 基于客户端传入的记忆与图谱摘要生成回答上下文 |
| 智能预测 | 根据图谱关系推测可能缺失的节点和连接 |
| 数据主权 | 主要数据保存在浏览器 IndexedDB 中 |

---

## 工作方式

```text
输入记忆
  -> 文件预处理 / 文本理解 / 实体关系抽取
  -> 保存到 IndexedDB
  -> 更新图谱与 embedding 索引
  -> 搜索、探索、预测、聊天
```

当前实现不是独立的 FAISS/BM25 服务，而是：

- 记忆数据保存在 `IndexedDB`
- 向量通过 `/api/compute/embed` 获取
- 前端用余弦相似度做向量搜索
- 关键词搜索是本地分词和字符串匹配

---

## 快速开始

```bash
pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

启动后访问：`http://localhost:5000`

如果部署到阿里云并配置了 SSL 证书、同时完成 ICP 备案，就可以通过正式域名访问前端页面和后端接口。

---

## 目录概览

```text
MemoryWeaver/
├── app.py                  # Flask 主入口
├── blueprints/             # HTTP 路由
├── services/               # 后端计算服务
├── static/js/db/           # IndexedDB 与向量检索
├── static/js/services/     # 前端记忆与图谱服务
└── templates/              # 页面模板
```

---

## 说明

更完整的中文文档请看 [README.zh-CN.md](README.zh-CN.md)。
