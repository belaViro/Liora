# Liora - 个人记忆网络

基于 Flask + 大模型接口的多模态个人记忆网络系统。

## 功能特点

- 🧠 **知识图谱可视化**：左侧 D3.js 力导向图展示记忆关联
- ✏️ **手动录入记忆**：支持文字、图片、音频多种类型
- 🔍 **智能搜索**：自然语言查询，AI 理解查询意图
- 🤖 **大模型处理**：调用 MiniMax / GPT-4V 等 API 进行多模态理解
- 📊 **统计分析**：记忆分布、实体统计等数据可视化

## 快速开始

### 1. 安装依赖

```bash
pip install -r requirements.txt
```

### 2. 配置环境变量

已配置好 MiniMax API，如需修改编辑 `.env` 文件：

```bash
# 默认已配置 MiniMax
LLM_API_KEY=sk-cp-bj_s-m2TPi4FRRBlJbELLky7UtOryazr3uIDOjYPd4ftVvzda953SZkG0u8_iO8uz24MD1VPlsvXWmQdK4brHAmkQzubpvak4tvghDpbGpTHoGFbq3wVM1w
LLM_BASE_URL=https://api.minimaxi.chat/v1
LLM_MODEL_NAME=minimax-text-01
```

### 3. 启动服务

```bash
python app.py
```

访问 http://localhost:5000

## 大模型配置指南

### MiniMax（已配置，推荐）

```env
LLM_API_KEY=sk-cp-bj_s-m2TPi4FRRBlJbELLky7UtOryazr3uIDOjYPd4ftVvzda953SZkG0u8_iO8uz24MD1VPlsvXWmQdK4brHAmkQzubpvak4tvghDpbGpTHoGFbq3wVM1w
LLM_BASE_URL=https://api.minimaxi.chat/v1
LLM_MODEL_NAME=minimax-text-01
```

**MiniMax 特点：**
- ✅ 支持中文优化
- ✅ 支持多模态（文本+图片）
- ✅ 支持语音转文本（Whisper兼容）
- ✅ 国内访问稳定
- 📚 文档：https://platform.minimaxi.com/

### OpenAI（可选）

```env
LLM_API_KEY=sk-your-openai-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL_NAME=gpt-4o
```

### 智谱AI GLM-4V（可选）

```env
LLM_API_KEY=your-zhipu-api-key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL_NAME=glm-4v
```

### 百度文心一言（可选）

```env
LLM_API_KEY=your-baidu-api-key
LLM_BASE_URL=https://qianfan.baidubce.com/v2
LLM_MODEL_NAME=ernie-4.0
```

## 使用指南

### 录入记忆

1. 点击右侧"录入记忆"选项卡
2. 选择记忆类型：
   - 📝 **文字**：直接输入文本内容
   - 🖼️ **图片**：上传图片 + 可选文字描述
   - 🎵 **音频**：上传音频文件（自动转文字）
3. 点击"保存记忆"

AI 将自动：
- 📝 生成内容描述
- 🏷️ 提取实体（人物/地点/事件）
- 🔗 识别关系
- 😊 分析情感

### 查看知识图谱

- **左侧区域**：D3.js 力导向图
  - 🔵 蓝色：人物（PERSON）
  - 🟢 绿色：地点（LOCATION）
  - 🟡 黄色：时间（TIME）
  - 🔴 红色：事件（EVENT）
  - 🟣 紫色：物品（OBJECT）
  - 🩵 青色：情感（EMOTION）
  - 🟢 浅绿：概念（CONCEPT）
- **操作**：
  - 拖拽节点调整布局
  - 滚轮缩放
  - 点击节点查看详情
- **顶部过滤**：全部 / 人物 / 地点 / 事件

### 搜索记忆

- 在顶部搜索框输入自然语言
- 示例查询：
  - "去年夏天的旅行"
  - "关于小明的记忆"
  - "最近开心的时刻"
  - "在北京发生的事情"

### 查看统计

点击"统计"选项卡查看：
- 📊 记忆总数
- 🔗 实体数量
- 📈 关系数量
- 📅 今日新增

## 项目结构

```
Liora/
├── app.py                 # Flask 主应用
├── services/              # 服务层
│   ├── llm_service.py     # 大模型接口（支持MiniMax/OpenAI等）
│   ├── memory_service.py  # 记忆管理
│   └── graph_service.py   # 知识图谱
├── templates/
│   └── index.html         # 主页面
├── static/
│   ├── js/
│   │   └── app.js         # 前端逻辑
│   ├── css/               # 样式
│   └── uploads/           # 上传文件
├── data/                  # 数据存储（JSON）
├── .env                   # 环境变量（已配置MiniMax）
├── requirements.txt       # Python依赖
└── README.md
```

## 技术栈

- **后端**：Flask, Flask-SocketIO
- **前端**：原生 JS, D3.js（图谱可视化）
- **AI 接口**：MiniMax API（兼容 OpenAI 格式）
- **存储**：JSON 文件（可扩展为数据库）

## 开发计划

- [x] 基础架构搭建
- [x] 手动录入（文字/图片/音频）
- [x] 知识图谱可视化
- [x] 自然语言搜索
- [x] MiniMax API 集成
- [ ] 自动同步（照片库、日历）
- [ ] 时序分析
- [ ] 记忆叙事生成
- [ ] 向量检索
- [ ] 数据库存储（PostgreSQL + Neo4j）

## 常见问题

### Q: MiniMax API 返回错误？
A: 请检查：
1. API Key 是否正确（以 `sk-` 开头）
2. 账户是否有足够余额
3. 模型名称是否正确（`minimax-text-01`）

### Q: 图片理解失败？
A: MiniMax 的多模态功能需要特定模型支持，确保使用支持视觉的模型。

### Q: 语音转文字失败？
A: 确保：
1. 音频格式为 mp3, wav, m4a 等
2. 文件大小不超过 25MB
3. WHISPER_API_KEY 配置正确

## License

MIT
