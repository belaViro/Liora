/**
 * Liora client-side agent dialogue service.
 * Builds isolated persona context packs from IndexedDB and asks the backend to
 * orchestrate a one-off Luoyi-hosted memory review.
 */

class ClientAgentDialogueService {
    constructor(dbInstance) {
        this.db = dbInstance;
    }

    async createMemoryReview(memoryId, options = {}) {
        const requestPayload = await this._buildMemoryReviewPayload(memoryId, options);
        if (!requestPayload.success) return requestPayload;

        if (options.stream) {
            return this._createMemoryReviewStream(requestPayload.payload, options.onEvent);
        }
        return this._createMemoryReviewJson(requestPayload.payload);
    }

    async getSessionsForMemory(memoryId) {
        return this.db.getAgentDialogueSessionsByMemory(memoryId);
    }

    async _buildMemoryReviewPayload(memoryId, options = {}) {
        const memory = await this.db.getMemory(memoryId);
        if (!memory) {
            return { success: false, error: 'Memory not found' };
        }

        const participants = await this._buildParticipants(memory, options.participants || null);
        if (participants.length === 0) {
            return { success: false, error: 'No person entities in this memory' };
        }

        const includeSummary = options.includeSummary !== undefined ? !!options.includeSummary : true;
        return {
            success: true,
            payload: {
                memory: this._compactMemory(memory, 1200),
                participants,
                rounds: options.rounds !== undefined ? options.rounds : 1,
                start_round: options.startRound || null,
                public_turns: options.history || [],
                include_summary: includeSummary,
                session_id: options.sessionId || null,
                created_at: options.createdAt || null,
                user_question: options.question || this._defaultQuestion(),
                language: window.i18n ? window.i18n.currentAiLanguage() : 'Chinese',
                stream: !!options.stream
            }
        };
    }

    async _createMemoryReviewJson(payload) {
        try {
            const response = await fetch('/api/agents/dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (!response.ok || !data.success) {
                return { success: false, error: data.message || response.statusText };
            }

            const session = data.data?.session;
            if (session) {
                await this.db.saveAgentDialogueSession(session);
            }
            return { success: true, session };
        } catch (error) {
            console.error('[AgentDialogue] createMemoryReview failed:', error);
            return { success: false, error: error.message };
        }
    }

    async _createMemoryReviewStream(payload, onEvent) {
        try {
            const response = await fetch('/api/agents/dialogue', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'text/event-stream'
                },
                body: JSON.stringify({ ...payload, stream: true })
            });

            if (!response.ok) {
                const errorText = await response.text();
                return { success: false, error: errorText || response.statusText };
            }

            const contentType = response.headers.get('content-type') || '';
            if (!response.body || !contentType.includes('text/event-stream')) {
                const data = await response.json();
                const session = data.data?.session;
                if (session) await this.db.saveAgentDialogueSession(session);
                return { success: !!data.success, session, error: data.message };
            }

            let finalSession = null;
            let streamError = '';
            await this._readSseStream(response, async (event, data) => {
                if (event === 'done') {
                    finalSession = data?.session || null;
                    if (finalSession) {
                        await this.db.saveAgentDialogueSession(finalSession);
                    }
                } else if (event === 'error') {
                    streamError = data?.message || data?.error || 'Stream failed';
                }

                if (onEvent) {
                    onEvent(event, data);
                }
            });

            if (streamError) {
                return { success: false, error: streamError, session: finalSession };
            }
            return { success: true, session: finalSession };
        } catch (error) {
            console.error('[AgentDialogue] stream failed:', error);
            return { success: false, error: error.message };
        }
    }

    async _readSseStream(response, onEvent) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';

            for (const rawEvent of events) {
                await this._dispatchSseEvent(rawEvent, onEvent);
            }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
            await this._dispatchSseEvent(buffer, onEvent);
        }
    }

    async _dispatchSseEvent(rawEvent, onEvent) {
        const parsed = this._parseSseEvent(rawEvent);
        if (parsed) {
            await onEvent(parsed.event, parsed.data);
        }
    }

    _parseSseEvent(rawEvent) {
        let event = 'message';
        const dataLines = [];

        for (const line of rawEvent.split(/\r?\n/)) {
            if (!line || line.startsWith(':')) continue;
            const separator = line.indexOf(':');
            const field = separator === -1 ? line : line.slice(0, separator);
            let value = separator === -1 ? '' : line.slice(separator + 1);
            if (value.startsWith(' ')) value = value.slice(1);

            if (field === 'event') event = value;
            if (field === 'data') dataLines.push(value);
        }

        if (!dataLines.length) return { event, data: null };
        const dataText = dataLines.join('\n');
        try {
            return { event, data: JSON.parse(dataText) };
        } catch (error) {
            return { event, data: dataText };
        }
    }

    async _buildParticipants(memory, selectedIds) {
        const personEntities = this._uniquePersons(memory.entities || [], selectedIds).slice(0, 3);
        if (personEntities.length === 0) return [];

        const [allMemories, allRelations, allEntities] = await Promise.all([
            this.db.getAllMemories(),
            this.db.getAllRelations(),
            this.db.getAllEntities()
        ]);
        const entityMap = new Map(allEntities.map(entity => [entity.id, entity]));

        const participants = [];
        for (const memoryEntity of personEntities) {
            const graphEntity = this._resolveGraphEntity(memoryEntity, allEntities) || memoryEntity;
            const relatedMemories = this._findRelatedMemories(graphEntity, allMemories, memory.id);
            const relationships = this._findRelationships(graphEntity, allRelations, entityMap);

            participants.push({
                id: graphEntity.id || memoryEntity.id || memoryEntity.name,
                name: graphEntity.name || memoryEntity.name,
                type: 'PERSON',
                description: graphEntity.description || memoryEntity.description || '',
                aliases: graphEntity.aliases || memoryEntity.aliases || [],
                current_memory_id: memory.id,
                related_memories: relatedMemories.map(item => this._compactMemory(item, 700)),
                relationships,
                persona_profile: this._buildPersonaProfile(graphEntity, relatedMemories)
            });
        }

        return participants;
    }

    _uniquePersons(entities, selectedIds) {
        const selectedSet = selectedIds ? new Set(selectedIds) : null;
        const seen = new Set();
        const people = [];

        for (const entity of entities) {
            if (!entity || entity.type !== 'PERSON' || !entity.name) continue;
            if (this._isDisallowedPersonaName(entity.name)) continue;
            if (selectedSet && !selectedSet.has(entity.id)) continue;
            const key = (entity.id || entity.name).toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            people.push(entity);
        }

        return people;
    }

    _isDisallowedPersonaName(name) {
        const normalized = String(name || '').trim().toLowerCase();
        return ['我', '本人', '自己', '用户', '你', '他', '她', 'ta', 'me', 'i', 'myself', 'user'].includes(normalized);
    }

    _resolveGraphEntity(memoryEntity, allEntities) {
        if (!memoryEntity) return null;
        return allEntities.find(entity => entity.id === memoryEntity.id)
            || allEntities.find(entity => entity.type === 'PERSON' && entity.name === memoryEntity.name)
            || null;
    }

    _findRelatedMemories(entity, allMemories, currentMemoryId) {
        const names = new Set([entity.name, ...(entity.aliases || [])].filter(Boolean).map(name => name.toLowerCase()));
        const ids = new Set([entity.id].filter(Boolean));

        const related = allMemories.filter(memory => {
            if (memory.id === currentMemoryId) return true;
            const entities = memory.entities || [];
            if (entities.some(item => ids.has(item.id) || names.has((item.name || '').toLowerCase()))) return true;
            const text = `${memory.content || ''} ${memory.understanding?.description || ''}`.toLowerCase();
            return [...names].some(name => name && text.includes(name));
        });

        return related
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, 6);
    }

    _findRelationships(entity, allRelations, entityMap) {
        const ids = new Set([entity.id].filter(Boolean));
        return allRelations
            .filter(relation => ids.has(relation.source) || ids.has(relation.target))
            .slice(0, 12)
            .map(relation => {
                const source = entityMap.get(relation.source);
                const target = entityMap.get(relation.target);
                return {
                    id: relation.id,
                    source: relation.source,
                    target: relation.target,
                    source_name: source?.name || relation.source,
                    target_name: target?.name || relation.target,
                    type: relation.type || '相关',
                    fact: relation.fact || relation.description || ''
                };
            });
    }

    _buildPersonaProfile(entity, relatedMemories) {
        const valences = relatedMemories
            .map(memory => memory.emotion?.valence)
            .filter(value => typeof value === 'number');
        const avgValence = valences.length
            ? valences.reduce((sum, value) => sum + value, 0) / valences.length
            : 0;

        let speakingStyle = '自然、简短、像在回忆';
        if (avgValence > 0.25) {
            speakingStyle = '轻松、温和，带一点熟悉感';
        } else if (avgValence < -0.25) {
            speakingStyle = '克制、柔和，避免过度解释';
        }

        return {
            known_traits: [entity.description || ''].filter(Boolean),
            speaking_style: speakingStyle,
            relationship_to_user: this._inferRelationshipToUser(entity)
        };
    }

    _inferRelationshipToUser(entity) {
        const description = `${entity.description || ''} ${(entity.aliases || []).join(' ')}`;
        if (!description) return '';
        return description.slice(0, 120);
    }

    _compactMemory(memory, maxChars) {
        const understanding = memory.understanding || {};
        return {
            id: memory.id || '',
            type: memory.type || 'text',
            created_at: memory.created_at || '',
            content: (memory.content || understanding.description || understanding.summary || '').slice(0, maxChars),
            understanding: {
                summary: understanding.summary || '',
                description: (understanding.description || '').slice(0, 300),
                topics: understanding.topics || [],
                keywords: understanding.keywords || []
            },
            emotion: memory.emotion || {}
        };
    }

    _defaultQuestion() {
        return window.i18n && window.i18n.isEnglish()
            ? 'Take one short turn inside this memory. Keep it conversational.'
            : '你们就这段记忆先各说一句，像真的在场一样互相接话。';
    }
}

let agentDialogueService = null;