/**
 * MemoryWeaver 前端记忆服务
 * 替代后端 MemoryService，在前端完成记忆的创建、搜索、删除等操作
 */

class ClientMemoryService {
    constructor(dbInstance, computeApiInstance, vectorSearchInstance) {
        this.db = dbInstance;
        this.computeApi = computeApiInstance;
        this.vectorSearch = vectorSearchInstance;
    }

    /**
     * 创建记忆（完整流程）
     * @param {object} data - 记忆数据
     * @param {string} data.content - 记忆内容
     * @param {string} data.type - 类型 (text/image/audio/video)
     * @param {File} data.file - 文件对象（可选）
     * @param {object} data.metadata - 元数据（可选）
     * @returns {Promise<{success, memory}>}
     */
    async createMemory(data) {
        const { content, type = 'text', file = null, metadata = {} } = data;

        if (!content && !file) {
            return { success: false, error: '内容不能为空' };
        }

        try {
            let memoryContent = content;
            let filePath = null;

            // 1. 预处理文件（图片/音频转写）
            if (file) {
                const preprocessResult = await this.computeApi.preprocess(file);
                if (preprocessResult.success && preprocessResult.content) {
                    memoryContent = preprocessResult.content;
                }
                // 不再依赖服务器存储文件路径，前端自己处理
            }

            // 预读文件为 Blob，可与 LLM 调用并行执行
            const fileReadPromise = file ? this._readFileAsBlob(file) : Promise.resolve(null);

            // 2. 提取时间信息
            const temporalResult = await this.computeApi.extractTemporal(memoryContent, type);
            const temporalInfo = temporalResult.success ? temporalResult.data?.temporal_info : {};

            // 3. LLM 理解和抽取
            const understandResult = await this.computeApi.understand(memoryContent, type);
            if (!understandResult.success) {
                // 即使 LLM 失败，也保存基本记忆
                console.warn('[ClientMemoryService] LLM understand failed:', understandResult.error);
            }

            const extraction = understandResult.data || {};

            // 4. 构建记忆对象
            const memoryId = (typeof generateUUID !== 'undefined' && generateUUID) ? generateUUID() : this._generateUUID();
            const memory = {
                id: memoryId,
                type: type,
                content: memoryContent,
                file_path: filePath,
                created_at: new Date().toISOString(),
                understanding: extraction.understanding || {
                    description: memoryContent.slice(0, 200),
                    summary: memoryContent.slice(0, 100),
                    keywords: [],
                    persons: [],
                    locations: [],
                    events: [],
                    topics: []
                },
                entities: extraction.entities || [],
                relations: extraction.relations || [],
                emotion: extraction.emotion || { valence: 0, arousal: 0, dominant_emotion: 'neutral' },
                temporal_info: temporalInfo,
                metadata: {
                    source: 'client_created',
                    timestamp: new Date().toISOString(),
                    ...metadata
                }
            };

            // 5. 保存到 IndexedDB
            await this.db.saveMemory(memory);

            // 获取预读的文件数据
            const fileData = await fileReadPromise;

            // 6/7/8. 更新图谱、向量索引、保存文件 —— 并行执行
            const parallelTasks = [];

            // 6. 更新图谱
            if (memory.entities.length > 0 || memory.relations.length > 0) {
                parallelTasks.push(this.db.updateGraph(memory));
            }

            // 7. 添加向量索引
            if (this.vectorSearch) {
                const textForEmbedding = memory.understanding?.description || memoryContent;
                if (textForEmbedding) {
                    parallelTasks.push(this.vectorSearch.addMemory(memoryId, textForEmbedding));
                }
            }

            // 8. 保存文件到 IndexedDB（文件已在前面预读）
            if (fileData) {
                parallelTasks.push(this.db.saveFile(memoryId, fileData, {
                    name: file.name,
                    type: type,
                    size: file.size,
                    mime: file.type
                }));
            }

            if (parallelTasks.length > 0) {
                await Promise.all(parallelTasks);
            }

            console.log('[ClientMemoryService] Memory created:', memoryId);
            return { success: true, memory };

        } catch (e) {
            console.error('[ClientMemoryService] createMemory error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 删除记忆
     * @param {string} memoryId - 记忆 ID
     * @returns {Promise<{success}>}
     */
    async deleteMemory(memoryId) {
        try {
            // 从向量索引中移除
            if (this.vectorSearch) {
                await this.vectorSearch.removeMemory(memoryId);
            }

            // 从图谱中移除
            await this.db.removeMemoryFromGraph(memoryId);

            // 删除记忆
            await this.db.deleteMemory(memoryId);

            console.log('[ClientMemoryService] Memory deleted:', memoryId);
            return { success: true };
        } catch (e) {
            console.error('[ClientMemoryService] deleteMemory error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 搜索记忆（混合搜索：向量 + 关键词）
     * @param {string} query - 查询文本
     * @param {object} options - 选项
     * @returns {Promise<{success, results}>}
     */
    async searchMemories(query, options = {}) {
        const { limit = 10, useVector = true } = options;

        try {
            const results = [];
            const seenIds = new Set();

            // 1. 向量搜索
            if (useVector && this.vectorSearch && this.vectorSearch.getVectorCount() > 0) {
                try {
                    const vectorResults = await this.vectorSearch.search(query, limit * 2);
                    for (const r of vectorResults) {
                        const memory = await this.db.getMemory(r.memory_id);
                        if (memory) {
                            results.push({ memory, score: r.score, match_type: 'vector' });
                            seenIds.add(r.memory_id);
                        }
                    }
                } catch (e) {
                    console.warn('[ClientMemoryService] Vector search failed:', e);
                }
            }

            // 2. 关键词搜索
            try {
                const keywordResults = await this.db.searchMemories(query, { limit: limit * 2 });
                for (const memory of keywordResults) {
                    if (!seenIds.has(memory.id)) {
                        const existing = results.find(r => r.memory.id === memory.id);
                        if (existing) {
                            existing.score = existing.score * 0.7 + 0.3;
                            existing.match_type = 'both';
                        } else {
                            results.push({ memory, score: 0.3, match_type: 'keyword' });
                            seenIds.add(memory.id);
                        }
                    }
                }
            } catch (e) {
                console.warn('[ClientMemoryService] Keyword search failed:', e);
            }

            // 3. 按分数排序
            results.sort((a, b) => b.score - a.score);

            // 4. 图谱节点名称匹配（补充）
            try {
                const entities = await this.db.searchEntities(query);
                for (const entity of entities.slice(0, 3)) {
                    const entityMemories = await this._getMemoriesByEntity(entity.id);
                    for (const memory of entityMemories) {
                        if (!seenIds.has(memory.id)) {
                            results.push({ memory, score: 0.2, match_type: 'entity' });
                            seenIds.add(memory.id);
                        }
                    }
                }
            } catch (e) {
                console.warn('[ClientMemoryService] Entity search failed:', e);
            }

            const finalResults = results.slice(0, limit).map(r => ({
                memory: r.memory,
                score: r.score,
                match_type: r.match_type
            }));

            return { success: true, results: finalResults };

        } catch (e) {
            console.error('[ClientMemoryService] searchMemories error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 获取单条记忆
     */
    async getMemory(memoryId) {
        return this.db.getMemory(memoryId);
    }

    /**
     * 获取所有记忆
     */
    async getAllMemories() {
        return this.db.getAllMemories();
    }

    /**
     * 获取时间线
     */
    async getTimeline(startDate, endDate) {
        return this.db.getTimeline(startDate, endDate);
    }

    /**
     * 获取往年今日
     */
    async getOnThisDay() {
        return this.db.getOnThisDay();
    }

    /**
     * 获取统计信息
     */
    async getStatistics() {
        return this.db.getStatistics();
    }

    /**
     * 获取与实体关联的记忆
     */
    async _getMemoriesByEntity(entityId) {
        const memories = await this.db.getAllMemories();
        return memories.filter(m =>
            m.entities && m.entities.some(e => e.id === entityId)
        );
    }

    /**
     * 生成 UUID
     */
    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * 读取文件为 Blob
     */
    async _readFileAsBlob(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                // 转换为 Blob
                const arr = new Uint8Array(reader.result);
                const blob = new Blob([arr], { type: file.type });
                resolve(blob);
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
}

// 全局实例（稍后初始化）
let memoryService = null;
