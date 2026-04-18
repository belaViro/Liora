/**
 * MemoryWeaver 客户端向量搜索
 * 使用服务器 /api/compute/embed 端点获取向量
 * 客户端存储向量并计算余弦相似度
 */

class ClientVectorSearch {
    constructor(computeApi) {
        this.computeApi = computeApi;
        this.vectors = new Map(); // memoryId -> { vector: Float32Array, text: string }
        this.dimension = 384; // 默认维度（可动态调整）
        this.initialized = false;
    }

    /**
     * 初始化：从 IndexedDB 加载已有向量
     */
    async init() {
        if (db && typeof db.getAllEmbeddings === 'function') {
            try {
                const embeddings = await db.getAllEmbeddings();
                for (const emb of embeddings) {
                    if (emb.vector && emb.memory_id) {
                        this.vectors.set(emb.memory_id, {
                            vector: new Float32Array(emb.vector),
                            text: emb.text || ''
                        });
                    }
                }
                this.initialized = true;
                console.log(`[VectorSearch] Loaded ${this.vectors.size} vectors`);
            } catch (e) {
                console.error('[VectorSearch] Failed to load embeddings:', e);
            }
        }
    }

    /**
     * 添加记忆的向量
     */
    async addMemory(memoryId, text) {
        if (!text || !memoryId) return;

        try {
            // 调用服务器获取向量
            const response = await this.computeApi.embed(text);
            if (response && response.data && response.data.vector) {
                const vector = new Float32Array(response.data.vector);

                // 调整维度（首次获取时）
                if (this.dimension === 384 && vector.length !== 384) {
                    this.dimension = vector.length;
                }

                this.vectors.set(memoryId, { vector, text });

                // 存入 IndexedDB
                if (db && typeof db.saveEmbedding === 'function') {
                    await db.saveEmbedding(memoryId, memoryId, Array.from(vector));
                }

                return true;
            }
        } catch (e) {
            console.error('[VectorSearch] Failed to add memory:', e);
        }
        return false;
    }

    /**
     * 移除记忆的向量
     */
    async removeMemory(memoryId) {
        this.vectors.delete(memoryId);
        if (db && typeof db.deleteEmbedding === 'function') {
            await db.deleteEmbedding(memoryId);
        }
    }

    /**
     * 批量添加向量（用于迁移或批量导入）
     */
    async addMemories(memories) {
        const results = [];
        for (const memory of memories) {
            const text = memory.understanding?.description || memory.content || '';
            if (text) {
                const success = await this.addMemory(memory.id, text);
                results.push({ memoryId: memory.id, success });
            }
        }
        return results;
    }

    /**
     * 搜索最相似的记忆
     */
    async search(query, topK = 10) {
        if (this.vectors.size === 0) {
            return [];
        }

        try {
            // 获取查询向量
            const response = await this.computeApi.embed(query);
            if (!response || !response.data || !response.data.vector) {
                return [];
            }

            const queryVector = new Float32Array(response.data.vector);
            const results = [];

            for (const [memoryId, data] of this.vectors) {
                const score = this.cosineSimilarity(queryVector, data.vector);
                results.push({
                    memory_id: memoryId,
                    score: score,
                    text: data.text
                });
            }

            // 按分数降序排序
            results.sort((a, b) => b.score - a.score);

            return results.slice(0, topK);
        } catch (e) {
            console.error('[VectorSearch] Search failed:', e);
            return [];
        }
    }

    /**
     * 余弦相似度计算
     */
    cosineSimilarity(a, b) {
        if (a.length !== b.length) {
            // 维度不匹配，降维处理
            const minLen = Math.min(a.length, b.length);
            let dotProduct = 0;
            let normA = 0;
            let normB = 0;
            for (let i = 0; i < minLen; i++) {
                dotProduct += a[i] * b[i];
                normA += a[i] * a[i];
                normB += b[i] * b[i];
            }
            if (normA === 0 || normB === 0) return 0;
            return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < a.length; i++) {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * 获取向量数量
     */
    getVectorCount() {
        return this.vectors.size;
    }

    /**
     * 检查是否已初始化
     */
    isInitialized() {
        return this.initialized;
    }

    /**
     * 清除所有向量
     */
    async clear() {
        this.vectors.clear();
        this.initialized = false;
    }

    /**
     * 重建索引（重新向量化所有记忆）
     */
    async rebuildIndex(memories) {
        await this.clear();
        return this.addMemories(memories);
    }
}

// 全局实例
let vectorSearch = null;
