/**
 * MemoryWeaver IndexedDB Storage Layer
 * 数据主权在客户端：所有数据存储在浏览器 IndexedDB 中
 */

class MemoryWeaverDB {
    constructor() {
        this.db = null;
        this.DB_NAME = 'MemoryWeaver_db';
        this.VERSION = 1;
    }

    /**
     * 初始化数据库
     */
    async init() {
        return new Promise((resolve, reject) => {
            if (indexedDB === undefined) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(this.DB_NAME, this.VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('[DB] IndexedDB initialized');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log('[DB] Upgrading database to version', this.VERSION);

                // memories store
                if (!db.objectStoreNames.contains('memories')) {
                    const memoriesStore = db.createObjectStore('memories', { keyPath: 'id' });
                    memoriesStore.createIndex('created_at', 'created_at', { unique: false });
                    memoriesStore.createIndex('type', 'type', { unique: false });
                    memoriesStore.createIndex('emotion_valence', 'emotion.valence', { unique: false });
                }

                // entities store (from graph nodes)
                if (!db.objectStoreNames.contains('entities')) {
                    const entitiesStore = db.createObjectStore('entities', { keyPath: 'id' });
                    entitiesStore.createIndex('type', 'type', { unique: false });
                    entitiesStore.createIndex('name', 'name', { unique: false });
                }

                // relations store (from graph edges)
                if (!db.objectStoreNames.contains('relations')) {
                    const relationsStore = db.createObjectStore('relations', { keyPath: 'id' });
                    relationsStore.createIndex('source', 'source', { unique: false });
                    relationsStore.createIndex('target', 'target', { unique: false });
                    relationsStore.createIndex('type', 'type', { unique: false });
                }

                // embeddings store (memory_id -> vector mapping)
                if (!db.objectStoreNames.contains('embeddings')) {
                    const embeddingsStore = db.createObjectStore('embeddings', { keyPath: 'memory_id' });
                    embeddingsStore.createIndex('vector_id', 'vector_id', { unique: false });
                }

                // uploads store (file blobs)
                if (!db.objectStoreNames.contains('uploads')) {
                    const uploadsStore = db.createObjectStore('uploads', { keyPath: 'memory_id' });
                    uploadsStore.createIndex('type', 'type', { unique: false });
                    uploadsStore.createIndex('created_at', 'created_at', { unique: false });
                }

                // sync_queue store (offline operations)
                if (!db.objectStoreNames.contains('sync_queue')) {
                    const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                    syncStore.createIndex('type', 'type', { unique: false });
                }

                // settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                console.log('[DB] Database schema created');
            };
        });
    }

    // ==================== Generic helpers ====================

    async _get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async _put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async _delete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async _clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async _count(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // ==================== Memories ====================

    /**
     * 保存记忆
     */
    async saveMemory(memory) {
        return this._put('memories', memory);
    }

    /**
     * 获取单条记忆
     */
    async getMemory(id) {
        return this._get('memories', id);
    }

    /**
     * 删除记忆
     */
    async deleteMemory(id) {
        // 同时删除关联的文件和向量
        await this._delete('uploads', id);
        await this._delete('embeddings', id);
        return this._delete('memories', id);
    }

    /**
     * 获取所有记忆
     */
    async getAllMemories() {
        return this._getAll('memories');
    }

    /**
     * 获取记忆数量
     */
    async getMemoryCount() {
        return this._count('memories');
    }

    /**
     * 关键词搜索记忆（客户端实现）
     */
    async searchMemories(query, filters = {}) {
        const allMemories = await this.getAllMemories();
        const queryLower = query.toLowerCase();

        // 简单中文分词
        const tokenize = (text) => {
            const words = text.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+|\d+/g) || [];
            return words.map(w => w.toLowerCase());
        };

        const queryWords = tokenize(query);
        const emotionFilter = filters.emotion_filter || 'any';

        const results = [];

        for (const memory of allMemories) {
            let score = 0;

            // 情感过滤
            if (emotionFilter !== 'any') {
                const valence = memory.emotion?.valence || 0;
                if (emotionFilter === 'positive' && valence <= 0) continue;
                if (emotionFilter === 'negative' && valence >= 0) continue;
            }

            // 类型过滤
            if (filters.type && memory.type !== filters.type) continue;

            // 收集可搜索文本
            const content = memory.content || '';
            const understanding = memory.understanding || {};
            const textToSearch = `${content} ${understanding.description || ''} ${understanding.summary || ''}`.toLowerCase();
            const textWords = new Set(tokenize(textToSearch));

            // 完整查询匹配
            if (queryLower && textToSearch.includes(queryLower)) {
                score += 5;
            }

            // 关键词匹配
            for (const word of queryWords) {
                if (textWords.has(word)) {
                    score += 1;
                }
                if (textToSearch.includes(word)) {
                    score += 0.5;
                }
            }

            // 实体名称匹配
            const entities = memory.entities || [];
            for (const entity of entities) {
                if (entity.name && entity.name.toLowerCase().includes(queryLower)) {
                    score += 3;
                }
            }

            if (score > 0) {
                results.push({ memory, score });
            }
        }

        // 按分数排序
        results.sort((a, b) => b.score - a.score);

        const limit = filters.limit || 10;
        return results.slice(0, limit).map(r => r.memory);
    }

    /**
     * 获取时间线记忆
     */
    async getTimeline(startDate, endDate) {
        const allMemories = await this.getAllMemories();

        let filtered = allMemories;

        if (startDate) {
            filtered = filtered.filter(m => m.created_at >= startDate);
        }
        if (endDate) {
            filtered = filtered.filter(m => m.created_at <= endDate);
        }

        // 按时间排序（最新的在前）
        filtered.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        return filtered;
    }

    /**
     * 获取往年今日的记忆
     */
    async getOnThisDay() {
        const allMemories = await this.getAllMemories();
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();

        const onThisDay = [];
        const otherMemories = [];

        for (const memory of allMemories) {
            const created = memory.created_at;
            if (!created) continue;

            try {
                const memDate = new Date(created);
                if (memDate.getMonth() + 1 === currentMonth && memDate.getDate() === currentDay && memDate.getFullYear() !== today.getFullYear()) {
                    const daysDiff = Math.floor((today - memDate) / (1000 * 60 * 60 * 24));
                    onThisDay.push({ memory, days_diff: daysDiff });
                } else {
                    otherMemories.push({ memory, days_diff: Math.floor((today - memDate) / (1000 * 60 * 60 * 24)) });
                }
            } catch (e) {
                console.warn('[DB] Failed to parse date:', created);
            }
        }

        // 按天数差异降序排序
        onThisDay.sort((a, b) => b.days_diff - a.days_diff);
        otherMemories.sort((a, b) => b.days_diff - a.days_diff);

        return {
            onThisDay: onThisDay.slice(0, 3),
            other: otherMemories.slice(0, 3)
        };
    }

    /**
     * 获取统计信息
     */
    async getStatistics() {
        const memories = await this.getAllMemories();
        const entities = await this.getAllEntities();

        const typeCounts = {};
        for (const m of memories) {
            typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
        }

        const entityTypeCounts = {};
        for (const e of entities) {
            entityTypeCounts[e.type] = (entityTypeCounts[e.type] || 0) + 1;
        }

        return {
            total_memories: memories.length,
            type_distribution: typeCounts,
            total_entities: entities.length,
            entity_distribution: entityTypeCounts
        };
    }

    // ==================== Entities ====================

    /**
     * 保存实体
     */
    async saveEntity(entity) {
        return this._put('entities', entity);
    }

    /**
     * 批量保存实体
     */
    async saveEntities(entities) {
        const tx = this.db.transaction('entities', 'readwrite');
        const store = tx.objectStore('entities');
        for (const entity of entities) {
            store.put(entity);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * 获取实体
     */
    async getEntity(id) {
        return this._get('entities', id);
    }

    /**
     * 获取所有实体
     */
    async getAllEntities() {
        return this._getAll('entities');
    }

    /**
     * 删除实体
     */
    async deleteEntity(id) {
        return this._delete('entities', id);
    }

    /**
     * 搜索实体
     */
    async searchEntities(keyword, entityType = null) {
        const all = await this.getAllEntities();
        const keywordLower = keyword.toLowerCase();

        return all.filter(e => {
            if (entityType && e.type !== entityType) return false;
            if (e.name && e.name.toLowerCase().includes(keywordLower)) return true;
            if (e.description && e.description.toLowerCase().includes(keywordLower)) return true;
            return false;
        });
    }

    // ==================== Relations ====================

    /**
     * 保存关系
     */
    async saveRelation(relation) {
        return this._put('relations', relation);
    }

    /**
     * 批量保存关系
     */
    async saveRelations(relations) {
        const tx = this.db.transaction('relations', 'readwrite');
        const store = tx.objectStore('relations');
        for (const relation of relations) {
            store.put(relation);
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * 获取关系
     */
    async getRelation(id) {
        return this._get('relations', id);
    }

    /**
     * 获取所有关系
     */
    async getAllRelations() {
        return this._getAll('relations');
    }

    /**
     * 删除关系
     */
    async deleteRelation(id) {
        return this._delete('relations', id);
    }

    /**
     * 获取实体的所有关系
     */
    async getEntityRelations(entityId) {
        const all = await this.getAllRelations();
        const incoming = [];
        const outgoing = [];

        for (const edge of all) {
            if (edge.source === entityId) outgoing.push(edge);
            if (edge.target === entityId) incoming.push(edge);
        }

        return { incoming, outgoing };
    }

    // ==================== Graph (combined) ====================

    /**
     * 获取完整图谱数据
     */
    async getGraphData(options = {}) {
        const entities = await this.getAllEntities();
        const relations = await this.getAllRelations();

        let filteredEntities = entities;
        let filteredRelations = relations;

        // 类型过滤
        if (options.entity_types && options.entity_types.length > 0) {
            filteredEntities = entities.filter(e => options.entity_types.includes(e.type));
            const entityIds = new Set(filteredEntities.map(e => e.id));
            filteredRelations = relations.filter(r => entityIds.has(r.source) && entityIds.has(r.target));
        }

        // 中心实体展开
        if (options.center_entity) {
            const relatedIds = new Set([options.center_entity]);
            for (const edge of relations) {
                if (edge.source === options.center_entity) relatedIds.add(edge.target);
                if (edge.target === options.center_entity) relatedIds.add(edge.source);
            }
            filteredEntities = entities.filter(e => relatedIds.has(e.id));
            filteredRelations = relations.filter(r => relatedIds.has(r.source) && relatedIds.has(r.target));
        }

        // 节点数量限制
        if (options.max_nodes > 0 && filteredEntities.length > options.max_nodes) {
            // 按关系数量排序，保留最重要的
            const entityWithCounts = filteredEntities.map(e => {
                const count = filteredRelations.filter(r => r.source === e.id || r.target === e.id).length;
                return { entity, count };
            });
            entityWithCounts.sort((a, b) => b.count - a.count);
            const topEntities = entityWithCounts.slice(0, options.max_nodes);
            const topIds = new Set(topEntities.map(x => x.entity.id));
            filteredEntities = topEntities.map(x => x.entity);
            filteredRelations = filteredRelations.filter(r => topIds.has(r.source) && topIds.has(r.target));
        }

        return {
            nodes: filteredEntities,
            edges: filteredRelations,
            total_nodes: entities.length,
            total_edges: relations.length
        };
    }

    /**
     * 保存图谱数据（实体 + 关系）
     */
    async saveGraphData(graphData) {
        const { nodes = [], edges = [] } = graphData;
        await this.saveEntities(nodes);
        await this.saveRelations(edges);
    }

    /**
     * 更新图谱（添加记忆时调用）
     */
    async updateGraph(memory) {
        const entities = memory.entities || [];
        const relations = memory.relations || [];
        const memoryId = memory.id;

        // 保存实体
        for (const entity of entities) {
            // 检查是否已存在同名实体（实体链接）
            const existing = await this._findSimilarEntity(entity.name, entity.type);
            if (existing) {
                // 合并到已有实体
                existing.memory_ids = existing.memory_ids || [];
                if (!existing.memory_ids.includes(memoryId)) {
                    existing.memory_ids.push(memoryId);
                }
                // 合并属性
                if (entity.attributes) {
                    existing.attributes = { ...existing.attributes, ...entity.attributes };
                }
                // 合并别名
                if (entity.aliases) {
                    existing.aliases = [...new Set([...existing.aliases || [], ...entity.aliases, entity.name])];
                }
                existing.updated_at = new Date().toISOString();
                await this.saveEntity(existing);
            } else {
                // 新实体
                const newEntity = {
                    ...entity,
                    memory_ids: [memoryId],
                    created_at: entity.created_at || new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    relation_count: 0
                };
                await this.saveEntity(newEntity);
            }
        }

        // 保存关系
        for (const relation of relations) {
            // 查找源和目标实体（LLM 返回 source/target 为实体 ID）
            const sourceEntity = await this._findEntityById(relation.source);
            const targetEntity = await this._findEntityById(relation.target);

            if (!sourceEntity || !targetEntity) {
                console.warn('[DB] Relation entity not found:', relation);
                continue;
            }

            const sourceId = sourceEntity.id;
            const targetId = targetEntity.id;

            // 检查是否已存在相同关系
            const allRelations = await this.getAllRelations();
            const existingRelation = allRelations.find(r =>
                r.source === sourceId && r.target === targetId && r.type === relation.type
            );

            if (existingRelation) {
                // 更新已有关系
                existingRelation.memory_ids = existingRelation.memory_ids || [];
                if (!existingRelation.memory_ids.includes(memoryId)) {
                    existingRelation.memory_ids.push(memoryId);
                }
                existingRelation.strength = Math.min(1.0, (existingRelation.strength || 0.5) + 0.1);
                await this.saveRelation(existingRelation);
            } else {
                // 新关系
                const newRelation = {
                    id: `${sourceId}_${relation.type}_${targetId}_${Date.now().toString(36)}`,
                    source: sourceId,
                    target: targetId,
                    type: relation.type,
                    directed: false,
                    description: relation.description || '',
                    fact: relation.fact || '',
                    episodes: [{
                        memory_id: memoryId,
                        snippet: memory.understanding?.summary || memory.content?.slice(0, 200) || '',
                        timestamp: new Date().toISOString()
                    }],
                    memory_ids: [memoryId],
                    memory_summaries: [memory.understanding?.summary || ''],
                    strength: 0.5,
                    created_at: new Date().toISOString(),
                    confidence: relation.confidence || 0.8
                };
                await this.saveRelation(newRelation);
            }
        }

        // 更新实体的关系计数
        const entityNames = [...new Set([...entities.map(e => e.name)])];
        for (const name of entityNames) {
            const entity = await this._findEntityByName(name);
            if (entity) {
                const rels = await this.getEntityRelations(entity.id);
                entity.relation_count = rels.incoming.length + rels.outgoing.length;
                await this.saveEntity(entity);
            }
        }
    }

    /**
     * 从记忆中移除图谱数据
     */
    async removeMemoryFromGraph(memoryId) {
        const entities = await this.getAllEntities();
        const relations = await this.getAllRelations();

        // 从节点的 memory_ids 中移除
        for (const entity of entities) {
            if (entity.memory_ids && entity.memory_ids.includes(memoryId)) {
                entity.memory_ids = entity.memory_ids.filter(id => id !== memoryId);
                if (entity.memory_ids.length === 0) {
                    await this.deleteEntity(entity.id);
                } else {
                    await this.saveEntity(entity);
                }
            }
        }

        // 删除相关关系
        for (const relation of relations) {
            if (relation.memory_ids && relation.memory_ids.includes(memoryId)) {
                if (relation.memory_ids.length <= 1) {
                    await this.deleteRelation(relation.id);
                } else {
                    relation.memory_ids = relation.memory_ids.filter(id => id !== memoryId);
                    await this.saveRelation(relation);
                }
            }
        }
    }

    // ==================== Embeddings ====================

    /**
     * 保存向量
     */
    async saveEmbedding(memoryId, vectorId, vector) {
        return this._put('embeddings', {
            memory_id: memoryId,
            vector_id: vectorId,
            vector: vector,
            created_at: new Date().toISOString()
        });
    }

    /**
     * 获取向量
     */
    async getEmbedding(memoryId) {
        return this._get('embeddings', memoryId);
    }

    /**
     * 获取所有向量
     */
    async getAllEmbeddings() {
        return this._getAll('embeddings');
    }

    /**
     * 删除向量
     */
    async deleteEmbedding(memoryId) {
        return this._delete('embeddings', memoryId);
    }

    // ==================== Uploads ====================

    /**
     * 保存上传文件（Blob）
     */
    async saveFile(memoryId, blob, metadata = {}) {
        const record = {
            memory_id: memoryId,
            blob: blob,
            name: metadata.name || '',
            type: metadata.type || 'unknown',
            size: metadata.size || 0,
            mime: metadata.mime || '',
            created_at: new Date().toISOString()
        };
        return this._put('uploads', record);
    }

    /**
     * 获取上传文件
     */
    async getFile(memoryId) {
        return this._get('uploads', memoryId);
    }

    /**
     * 删除上传文件
     */
    async deleteFile(memoryId) {
        return this._delete('uploads', memoryId);
    }

    /**
     * 获取所有上传文件
     */
    async getAllFiles() {
        return this._getAll('uploads');
    }

    // ==================== Sync Queue ====================

    /**
     * 添加操作到同步队列（离线支持）
     */
    async addToSyncQueue(operation) {
        const record = {
            ...operation,
            timestamp: new Date().toISOString(),
            status: 'pending'
        };
        return this._put('sync_queue', record);
    }

    /**
     * 获取待同步操作
     */
    async getPendingSyncOperations() {
        return this._getAll('sync_queue');
    }

    /**
     * 清除已完成的同步操作
     */
    async clearCompletedSyncOperations() {
        const all = await this._getAll('sync_queue');
        for (const op of all) {
            if (op.status === 'completed') {
                await this._delete('sync_queue', op.id);
            }
        }
    }

    // ==================== Settings ====================

    /**
     * 保存设置
     */
    async saveSetting(key, value) {
        return this._put('settings', { key, value });
    }

    /**
     * 获取设置
     */
    async getSetting(key, defaultValue = null) {
        const record = await this._get('settings', key);
        return record ? record.value : defaultValue;
    }

    // ==================== Export/Import ====================

    /**
     * 导出所有数据（用于 .loyi 文件）
     */
    async exportAll() {
        const memories = await this.getAllMemories();
        const entities = await this.getAllEntities();
        const relations = await this.getAllRelations();
        const files = await this.getAllFiles();

        // 序列化的数据（Blob 转为 base64）
        const serializedFiles = [];
        for (const f of files) {
            const base64 = f.blob ? await this._blobToBase64(f.blob) : null;
            serializedFiles.push({
                memory_id: f.memory_id,
                name: f.name,
                type: f.type,
                size: f.size,
                mime: f.mime,
                data: base64,
                created_at: f.created_at
            });
        }

        return {
            version: 1,
            exported_at: new Date().toISOString(),
            memories: memories,
            entities: entities,
            relations: relations,
            files: serializedFiles
        };
    }

    /**
     * 导入数据（从 .loyi 文件）
     */
    async importAll(data) {
        if (!data || data.version !== 1) {
            throw new Error('Unsupported data version');
        }

        // 导入记忆
        if (data.memories) {
            for (const memory of data.memories) {
                await this.saveMemory(memory);
            }
        }

        // 导入实体
        if (data.entities) {
            await this.saveEntities(data.entities);
        }

        // 导入关系
        if (data.relations) {
            await this.saveRelations(data.relations);
        }

        // 导入文件
        if (data.files) {
            for (const file of data.files) {
                if (file.data) {
                    const blob = await this._base64ToBlob(file.data, file.mime);
                    await this.saveFile(file.memory_id, blob, {
                        name: file.name,
                        type: file.type,
                        size: file.size,
                        mime: file.mime
                    });
                }
            }
        }
    }

    /**
     * 清除所有数据
     */
    async clearAll() {
        await this._clear('memories');
        await this._clear('entities');
        await this._clear('relations');
        await this._clear('embeddings');
        await this._clear('uploads');
        await this._clear('sync_queue');
    }

    // ==================== Private helpers ====================

    /**
     * 查找相似实体（实体链接）
     */
    async _findSimilarEntity(entityName, entityType) {
        const all = await this.getAllEntities();
        const nameLower = entityName.toLowerCase().trim();

        for (const existing of all) {
            if (existing.type !== entityType) continue;

            const existingName = existing.name.toLowerCase().trim();

            // 精确匹配
            if (existingName === nameLower) return existing;

            // 包含关系
            if (existingName.includes(nameLower) || nameLower.includes(existingName)) {
                return existing;
            }

            // 别名匹配
            const aliases = existing.aliases || [];
            for (const alias of aliases) {
                if (alias.toLowerCase().trim() === nameLower) return existing;
            }
        }

        return null;
    }

    /**
     * 通过名称查找实体
     */
    async _findEntityByName(name, type = null) {
        const all = await this.getAllEntities();
        const nameLower = name.toLowerCase().trim();

        for (const entity of all) {
            if (entity.name.toLowerCase().trim() === nameLower) {
                if (type === null || entity.type === type) {
                    return entity;
                }
            }
        }

        return null;
    }

    /**
     * 通过 ID 查找实体
     */
    async _findEntityById(entityId) {
        return this._get('entities', entityId);
    }

    /**
     * Blob 转 base64
     */
    async _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * base64 转 Blob
     */
    async _base64ToBlob(base64, mimeType = '') {
        const response = await fetch(base64);
        return response.blob();
    }
}

// 全局实例
const db = new MemoryWeaverDB();
