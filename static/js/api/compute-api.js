/**
 * MemoryWeaver Compute API Client
 * 调用服务器纯计算端点，前端负责数据存储
 */

class ComputeAPI {
    constructor() {
        this.baseUrl = '/api/compute';
    }

    /**
     * 预处理文件（图片理解 / 音频转写）
     * @param {File} file - 文件对象
     * @returns {Promise<{file_path, type, content, error}>}
     */
    async preprocess(file) {
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/memory/preprocess', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            return {
                success: data.success,
                file_path: data.data?.file_path || '',
                type: data.data?.type || 'text',
                content: data.data?.content || '',
                error: data.success ? null : data.message
            };
        } catch (e) {
            console.error('[ComputeAPI] preprocess error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * LLM 理解和抽取
     * @param {string} content - 记忆内容
     * @param {string} type - 记忆类型 (text/image/audio/video)
     * @param {object} options - 可选参数
     * @returns {Promise<{success, understanding, entities, relations, emotion}>}
     */
    async understand(content, type = 'text', options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}/understand`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, type, ...options })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] understand error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 时间信息提取
     * @param {string} content - 记忆内容
     * @param {string} type - 记忆类型
     * @returns {Promise<{success, temporal_info}>}
     */
    async extractTemporal(content, type = 'text') {
        try {
            const response = await fetch(`${this.baseUrl}/temporal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content, type })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] extractTemporal error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 计算文本向量
     * @param {string} text - 文本
     * @returns {Promise<{success, vector, dimension}>}
     */
    async embed(text) {
        try {
            const response = await fetch(`${this.baseUrl}/embed`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] embed error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 服务器辅助搜索排名
     * @param {string} query - 查询文本
     * @param {Array} memories - 记忆数组
     * @param {number} topK - 返回数量
     * @returns {Promise<{success, results}>}
     */
    async searchRank(query, memories, topK = 10) {
        try {
            const response = await fetch(`${this.baseUrl}/search-rank`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, memories, top_k: topK })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] searchRank error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 节点预测
     * @param {object} node - 节点数据
     * @param {Array} relatedNodes - 关联节点
     * @param {number} maxPredictions - 最大预测数
     * @returns {Promise<{success, predictions}>}
     */
    async predict(node, relatedNodes = [], maxPredictions = 5) {
        try {
            const response = await fetch(`${this.baseUrl}/predict`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    node,
                    related_nodes: relatedNodes,
                    max_predictions: maxPredictions,
                    language: window.i18n ? window.i18n.currentAiLanguage() : 'Chinese'
                })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] predict error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 洛忆聊天
     * @param {string} message - 用户消息
     * @param {Array} history - 聊天历史
     * @param {Array} memories - 相关记忆
     * @param {object} graphSummary - 图谱摘要
     * @returns {Promise<{success, reply, context_used}>}
     */
    async chat(message, history = [], memories = [], graphSummary = {}) {
        try {
            const response = await fetch(`${this.baseUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    history,
                    memories,
                    graph_summary: graphSummary,
                    language: window.i18n ? window.i18n.currentAiLanguage() : 'Chinese'
                })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] chat error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * AI 洛忆评价
     * @param {string} memoryContent - 记忆内容
     * @param {number} daysAgo - 多少天前
     * @param {object} emotion - 情感数据
     * @returns {Promise<{success, quote, summary}>}
     */
    async aiQuote(memoryContent, daysAgo = 365, emotion = {}) {
        try {
            const response = await fetch('/api/memories/ai-quote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: memoryContent,
                    days_ago: daysAgo,
                    emotion,
                    language: window.i18n ? window.i18n.currentAiLanguage() : 'Chinese'
                })
            });
            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ComputeAPI] aiQuote error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 文件分块上传（用于大文件）
     * @param {File} file - 文件对象
     * @param {Function} onProgress - 进度回调
     * @returns {Promise<{success, file_id, file_path}>}
     */
    async uploadChunked(file, onProgress = null) {
        const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const fileId = (typeof generateUUID !== 'undefined' && generateUUID) ? generateUUID() : Date.now().toString(36);

        try {
            for (let i = 0; i < totalChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, file.size);
                const chunk = file.slice(start, end);

                const formData = new FormData();
                formData.append('upload_id', fileId);
                formData.append('chunk_index', i);
                formData.append('total_chunks', totalChunks);
                formData.append('chunk', chunk);

                const response = await fetch(`${this.baseUrl}/upload-chunk`, {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    throw new Error(`Chunk ${i} upload failed`);
                }

                if (onProgress) {
                    onProgress((i + 1) / totalChunks * 100);
                }
            }

            // 合并分片
            const mergeResponse = await fetch(`${this.baseUrl}/merge-chunks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ upload_id: fileId })
            });
            const mergeData = await mergeResponse.json();
            return mergeData;

        } catch (e) {
            console.error('[ComputeAPI] uploadChunked error:', e);
            return { success: false, error: e.message };
        }
    }
}

// 全局实例
const computeApi = new ComputeAPI();
