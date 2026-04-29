/**
 * MemoryWeaver 前端图谱服务
 * 替代后端 GraphService，在前端完成图谱的查询、更新等操作
 */

class ClientGraphService {
    constructor(dbInstance, computeApiInstance) {
        this.db = dbInstance;
        this.computeApi = computeApiInstance;
    }

    /**
     * 获取图谱数据
     * @param {object} options - 选项
     * @param {Array} options.entity_types - 实体类型过滤
     * @param {string} options.center_entity - 中心实体 ID
     * @param {number} options.max_nodes - 最大节点数
     * @returns {Promise<{nodes, edges, total_nodes, total_edges}>}
     */
    async getGraphData(options = {}) {
        return this.db.getGraphData(options);
    }

    /**
     * 获取实体详情
     * @param {string} entityId - 实体 ID
     * @returns {Promise<object>}
     */
    async getEntity(entityId) {
        const entity = await this.db.getEntity(entityId);
        if (!entity) return null;

        // 获取关联的记忆
        const memories = await this._getMemoriesByEntity(entityId);

        // 获取关联的关系
        const relations = await this.db.getEntityRelations(entityId);

        return {
            ...entity,
            memories: memories,
            incoming: relations.incoming,
            outgoing: relations.outgoing
        };
    }

    /**
     * 搜索实体
     * @param {string} keyword - 关键词
     * @param {string} entityType - 实体类型（可选）
     * @returns {Promise<Array>}
     */
    async searchEntities(keyword, entityType = null) {
        return this.db.searchEntities(keyword, entityType);
    }

    /**
     * 更新节点
     * @param {string} nodeId - 节点 ID
     * @param {object} updates - 更新字段
     * @returns {Promise<{success}>}
     */
    async updateNode(nodeId, updates) {
        try {
            const entity = await this.db.getEntity(nodeId);
            if (!entity) return { success: false, error: 'Entity not found' };

            // 只允许更新特定字段
            const allowedFields = ['name', 'type', 'description', 'attributes'];
            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    entity[field] = updates[field];
                }
            }
            entity.updated_at = new Date().toISOString();

            await this.db.saveEntity(entity);
            return { success: true };
        } catch (e) {
            console.error('[ClientGraphService] updateNode error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 删除节点
     * @param {string} nodeId - 节点 ID
     * @returns {Promise<{success}>}
     */
    async deleteNode(nodeId) {
        try {
            // 删除节点
            await this.db.deleteEntity(nodeId);

            // 删除相关关系
            const relations = await this.db.getAllRelations();
            for (const relation of relations) {
                if (relation.source === nodeId || relation.target === nodeId) {
                    await this.db.deleteRelation(relation.id);
                }
            }

            return { success: true };
        } catch (e) {
            console.error('[ClientGraphService] deleteNode error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 更新关系边
     * @param {string} edgeId - 边 ID
     * @param {object} updates - 更新字段
     * @returns {Promise<{success}>}
     */
    async updateEdge(edgeId, updates) {
        try {
            const relation = await this.db.getRelation(edgeId);
            if (!relation) return { success: false, error: 'Relation not found' };

            // 只允许更新特定字段
            const allowedFields = ['type', 'description', 'fact'];
            for (const field of allowedFields) {
                if (updates[field] !== undefined) {
                    relation[field] = updates[field];
                }
            }
            relation.updated_at = new Date().toISOString();

            await this.db.saveRelation(relation);
            return { success: true };
        } catch (e) {
            console.error('[ClientGraphService] updateEdge error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 删除关系边
     * @param {string} edgeId - 边 ID
     * @returns {Promise<{success}>}
     */
    async deleteEdge(edgeId) {
        try {
            await this.db.deleteRelation(edgeId);
            return { success: true };
        } catch (e) {
            console.error('[ClientGraphService] deleteEdge error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 合并重复实体
     * @param {string} keepId - 保留的实体 ID
     * @param {string} removeId - 删除的实体 ID
     * @returns {Promise<{success}>}
     */
    async mergeNodes(keepId, removeId) {
        try {
            const keepEntity = await this.db.getEntity(keepId);
            const removeEntity = await this.db.getEntity(removeId);

            if (!keepEntity || !removeEntity) {
                return { success: false, error: 'Entity not found' };
            }

            // 合并记忆关联
            const keepMemories = new Set(keepEntity.memory_ids || []);
            const removeMemories = new Set(removeEntity.memory_ids || []);
            keepEntity.memory_ids = [...keepMemories, ...removeMemories];

            // 更新关系边
            const relations = await this.db.getAllRelations();
            for (const relation of relations) {
                if (relation.source === removeId) {
                    relation.source = keepId;
                    await this.db.saveRelation(relation);
                }
                if (relation.target === removeId) {
                    relation.target = keepId;
                    await this.db.saveRelation(relation);
                }
            }

            // 删除被合并的实体
            await this.db.deleteEntity(removeId);

            // 去除重复边和自环
            await this._dedupeEdges(keepId);

            return { success: true };
        } catch (e) {
            console.error('[ClientGraphService] mergeNodes error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 探索问答
     * @param {string} question - 问题
     * @param {string} nodeId - 节点 ID（可选）
     * @param {string} edgeId - 边 ID（可选）
     * @param {Array} history - 聊天历史
     * @returns {Promise<{success, answer}>}
     */
    async explore(question, nodeId = null, edgeId = null, history = []) {
        try {
            // 获取相关上下文
            let context = {};
            if (nodeId) {
                const entity = await this.getEntity(nodeId);
                context.node = entity;
            }
            if (edgeId) {
                const relation = await this.db.getRelation(edgeId);
                context.edge = relation;
            }

            // 获取图谱摘要
            const graphData = await this.getGraphData({ max_nodes: 50 });
            context.graph_summary = {
                nodes: graphData.nodes.slice(0, 20),
                edges: graphData.edges.slice(0, 20)
            };

            // 获取相关记忆
            const memories = await this._getContextMemories(context);
            context.memories = memories;

            // 调用服务器计算
            const response = await fetch('/api/graph/explore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question,
                    context,
                    history,
                    language: window.i18n ? window.i18n.currentAiLanguage() : 'Chinese'
                })
            });

            const data = await response.json();
            return data;
        } catch (e) {
            console.error('[ClientGraphService] explore error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 预测下一个节点
     * @param {string} nodeId - 节点 ID
     * @param {number} maxPredictions - 最大预测数
     * @returns {Promise<{success, predictions}>}
     */
    async predictNextNodes(nodeId, maxPredictions = 5) {
        try {
            const entity = await this.db.getEntity(nodeId);
            if (!entity) return { success: false, error: 'Entity not found' };

            // 获取关联节点
            const relations = await this.db.getEntityRelations(nodeId);
            const relatedNodes = [];

            for (const edge of [...relations.incoming, ...relations.outgoing]) {
                const otherId = edge.source === nodeId ? edge.target : edge.source;
                const otherEntity = await this.db.getEntity(otherId);
                if (otherEntity) {
                    relatedNodes.push(otherEntity);
                }
            }

            // 调用服务器预测
            const response = await this.computeApi.predict(entity, relatedNodes, maxPredictions);
            return response;

        } catch (e) {
            console.error('[ClientGraphService] predictNextNodes error:', e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 获取统计信息
     * @returns {Promise<object>}
     */
    async getStatistics() {
        const entities = await this.db.getAllEntities();
        const relations = await this.db.getAllRelations();

        const nodeTypeCounts = {};
        const edgeTypeCounts = {};

        for (const e of entities) {
            nodeTypeCounts[e.type] = (nodeTypeCounts[e.type] || 0) + 1;
        }

        for (const r of relations) {
            edgeTypeCounts[r.type] = (edgeTypeCounts[r.type] || 0) + 1;
        }

        return {
            total_nodes: entities.length,
            total_edges: relations.length,
            node_types: nodeTypeCounts,
            edge_types: edgeTypeCounts,
            average_degree: relations.length * 2 / (entities.length || 1)
        };
    }

    // ==================== Private helpers ====================

    /**
     * 获取与上下文相关的记忆
     */
    async _getContextMemories(context) {
        const allMemories = await this.db.getAllMemories();

        if (context.node) {
            const nodeName = context.node.name.toLowerCase();
            return allMemories.filter(m => {
                const content = (m.content || '').toLowerCase();
                const description = (m.understanding?.description || '').toLowerCase();
                return content.includes(nodeName) || description.includes(nodeName);
            }).slice(0, 5);
        }

        return allMemories.slice(0, 3);
    }

    /**
     * 获取关联某实体的记忆
     */
    async _getMemoriesByEntity(entityId) {
        const allMemories = await this.db.getAllMemories();
        return allMemories.filter(m =>
            m.entities && m.entities.some(e => e.id === entityId)
        );
    }

    /**
     * 去除重复边和自环
     */
    async _dedupeEdges(keepId) {
        const relations = await this.db.getAllRelations();
        const seenEdges = new Map(); // key -> edgeId

        for (const edge of relations) {
            if (edge.source === keepId && edge.target === keepId) {
                // 自环，删除
                await this.db.deleteRelation(edge.id);
                continue;
            }

            const key = `${edge.source}_${edge.type}_${edge.target}`;
            if (seenEdges.has(key)) {
                // 重复边，删除
                await this.db.deleteRelation(edge.id);
            } else {
                seenEdges.set(key, edge.id);
            }
        }
    }
}

// 全局实例（稍后初始化）
let graphService = null;
