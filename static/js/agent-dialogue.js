/**
 * UI glue for Luoyi-hosted multi-persona memory review.
 */

let agentDialogueRuntime = {
    memoryId: null,
    session: null,
    running: false,
    summarized: false,
    currentHistoryMemoryId: null,
    panelId: 'agentDialogueWorkbenchPanel',
    historyId: 'agentDialogueWorkbenchHistory',
    selectedMemoryId: null,
    setupCandidates: []
};

function openAgentDialogueWorkbench(memoryId = null, options = {}) {
    if (typeof switchTab === 'function') {
        switchTab('agent-dialogue', null, true);
    }

    const sidebar = document.getElementById('sidebarPanel');
    if (sidebar && window.innerWidth <= 768) {
        sidebar.classList.add('mobile-open');
        document.body.style.overflow = 'hidden';
    }

    agentDialogueRuntime = {
        ...agentDialogueRuntime,
        panelId: 'agentDialogueWorkbenchPanel',
        historyId: 'agentDialogueWorkbenchHistory'
    };

    if (memoryId) {
        agentDialogueRuntime.selectedMemoryId = memoryId;
        return;
    }

    if (!options.preserveSelection && !agentDialogueRuntime.selectedMemoryId) {
        renderAgentDialogueWorkbenchHome();
    } else if (agentDialogueRuntime.selectedMemoryId) {
        renderAgentDialogueWorkbenchMemory(agentDialogueRuntime.selectedMemoryId);
    }
}

async function renderAgentDialogueWorkbenchHome(searchTerm = '') {
    const selectedEl = document.getElementById('agentDialogueSelectedMemory');
    const pickerEl = document.getElementById('agentDialogueMemoryPicker');
    const historyEl = document.getElementById('agentDialogueWorkbenchHistory');
    const panel = document.getElementById('agentDialogueWorkbenchPanel');
    if (!pickerEl) return;

    agentDialogueRuntime.panelId = 'agentDialogueWorkbenchPanel';
    agentDialogueRuntime.historyId = 'agentDialogueWorkbenchHistory';
    if (selectedEl) selectedEl.innerHTML = '';
    if (historyEl) historyEl.innerHTML = '';
    if (panel) {
        panel.style.display = 'none';
        panel.innerHTML = '';
    }

    pickerEl.innerHTML = `
        <div class="agent-workbench-search">
            <input type="text" id="agentDialogueMemorySearch" value="${escapeAgentDialogueHtml(searchTerm)}" placeholder="${isAgentDialogueEnglish() ? 'Search memories with people...' : '搜索包含人物的记忆...'}" oninput="renderAgentDialogueWorkbenchHome(this.value)">
        </div>
        <div class="agent-workbench-loading">${isAgentDialogueEnglish() ? 'Loading memories...' : '正在读取记忆...'}</div>
    `;

    try {
        const memories = await db.getAllMemories();
        const query = String(searchTerm || '').trim().toLowerCase();
        const candidates = memories
            .filter(memory => agentDialogueMemoryHasPerson(memory))
            .filter(memory => {
                if (!query) return true;
                const text = `${memory.content || ''} ${memory.understanding?.summary || ''} ${memory.understanding?.description || ''}`.toLowerCase();
                return text.includes(query);
            })
            .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
            .slice(0, 20);

        pickerEl.innerHTML = `
            <div class="agent-workbench-search">
                <input type="text" id="agentDialogueMemorySearch" value="${escapeAgentDialogueHtml(searchTerm)}" placeholder="${isAgentDialogueEnglish() ? 'Search memories with people...' : '搜索包含人物的记忆...'}" oninput="renderAgentDialogueWorkbenchHome(this.value)">
            </div>
            ${candidates.length ? `
                <div class="agent-workbench-list">
                    ${candidates.map(memory => renderAgentDialogueMemoryOption(memory)).join('')}
                </div>
            ` : `
                <div class="agent-workbench-empty">
                    ${isAgentDialogueEnglish() ? 'No memories with person entities yet.' : '还没有包含人物实体的记忆。'}
                </div>
            `}
        `;
    } catch (error) {
        console.warn('[AgentDialogue] load workbench memories failed:', error);
        pickerEl.innerHTML = `<div class="agent-dialogue-error">${escapeAgentDialogueHtml(error.message || (isAgentDialogueEnglish() ? 'Failed to load memories.' : '读取记忆失败。'))}</div>`;
    }
}

async function renderAgentDialogueWorkbenchMemory(memoryId) {
    const selectedEl = document.getElementById('agentDialogueSelectedMemory');
    const pickerEl = document.getElementById('agentDialogueMemoryPicker');
    const historyEl = document.getElementById('agentDialogueWorkbenchHistory');
    if (!selectedEl || !pickerEl) return;

    agentDialogueRuntime.panelId = 'agentDialogueWorkbenchPanel';
    agentDialogueRuntime.historyId = 'agentDialogueWorkbenchHistory';
    agentDialogueRuntime.selectedMemoryId = memoryId;
    if (historyEl) historyEl.innerHTML = '';

    try {
        const memory = await db.getMemory(memoryId);
        if (!memory) {
            selectedEl.innerHTML = '';
            pickerEl.innerHTML = `<div class="agent-workbench-empty">${isAgentDialogueEnglish() ? 'Memory not found.' : '未找到这条记忆。'}</div>`;
            return;
        }

        selectedEl.innerHTML = renderAgentDialogueSelectedMemory(memory);
        pickerEl.innerHTML = `
            <button type="button" class="agent-workbench-change" onclick="clearAgentDialogueWorkbenchMemory()">
                ${isAgentDialogueEnglish() ? 'Choose another memory' : '选择其他记忆'}
            </button>
        `;
        await loadAgentDialogueSessionsForMemory(memoryId);
    } catch (error) {
        console.warn('[AgentDialogue] render selected memory failed:', error);
    }
}

function clearAgentDialogueWorkbenchMemory() {
    agentDialogueRuntime.selectedMemoryId = null;
    agentDialogueRuntime.memoryId = null;
    agentDialogueRuntime.session = null;
    agentDialogueRuntime.summarized = false;
    renderAgentDialogueWorkbenchHome();
}

function renderAgentDialogueMemoryOption(memory) {
    const title = agentDialogueMemoryTitle(memory);
    const date = memory.created_at ? new Date(memory.created_at).toLocaleDateString(currentLocale(), { month: 'short', day: 'numeric' }) : '';
    const people = (memory.entities || []).filter(entity => entity.type === 'PERSON').slice(0, 3).map(entity => entity.name).filter(Boolean).join(' / ');
    return `
        <button type="button" class="agent-workbench-memory" onclick="startAgentDialogueForMemory('${escapeAgentDialogueHtml(memory.id)}')">
            <span class="agent-workbench-memory-title">${escapeAgentDialogueHtml(title)}</span>
            <span class="agent-workbench-memory-meta">${escapeAgentDialogueHtml([date, people].filter(Boolean).join(' · '))}</span>
        </button>
    `;
}

function renderAgentDialogueSelectedMemory(memory) {
    const title = agentDialogueMemoryTitle(memory);
    const date = memory.created_at ? new Date(memory.created_at).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    return `
        <div class="agent-workbench-selected-card">
            <div class="agent-workbench-selected-label">${isAgentDialogueEnglish() ? 'Selected memory' : '当前记忆'}</div>
            <div class="agent-workbench-selected-title">${escapeAgentDialogueHtml(title)}</div>
            <div class="agent-workbench-selected-meta">${escapeAgentDialogueHtml(date)}</div>
        </div>
    `;
}

function agentDialogueMemoryTitle(memory) {
    return (memory.understanding?.summary || memory.understanding?.description || memory.content || '').slice(0, 80) || (isAgentDialogueEnglish() ? 'Untitled memory' : '未命名记忆');
}

function agentDialogueMemoryHasPerson(memory) {
    return (memory.entities || []).some(entity => entity.type === 'PERSON' && !['我', '本人', '自己', '用户', '你', '他', '她', 'ta', 'me', 'i', 'myself', 'user'].includes((entity.name || '').trim().toLowerCase()));
}

function getAgentDialoguePanelElement() {
    return document.getElementById(agentDialogueRuntime.panelId || 'agentDialogueWorkbenchPanel')
        || document.getElementById('agentDialogueWorkbenchPanel')
        || document.getElementById('agentDialoguePanel');
}

function getAgentDialogueHistoryElement() {
    return document.getElementById(agentDialogueRuntime.historyId || 'agentDialogueWorkbenchHistory')
        || document.getElementById('agentDialogueWorkbenchHistory')
        || document.getElementById('agentDialogueHistory');
}
async function startAgentDialogueForMemory(memoryId) {
    openAgentDialogueWorkbench(memoryId);
    const panel = getAgentDialoguePanelElement();
    if (!panel) return;

    if (!agentDialogueService) {
        showAgentDialogueError(panel, isAgentDialogueEnglish() ? 'Agent dialogue service is not ready.' : '多人物复盘服务尚未就绪。');
        return;
    }

    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="agent-dialogue-loading">
            ${isAgentDialogueEnglish() ? 'Loading persona options...' : '正在读取可参与人物...'}
        </div>
    `;

    const result = await agentDialogueService.getParticipantCandidates(memoryId);
    if (!result.success) {
        showAgentDialogueError(panel, result.error || (isAgentDialogueEnglish() ? 'No personas available.' : '没有可参与的人物。'));
        return;
    }

    const candidates = result.candidates || [];
    if (!candidates.some(candidate => candidate.type === 'PERSON')) {
        showAgentDialogueError(panel, isAgentDialogueEnglish() ? 'No person entities in this memory.' : '这条记忆里没有可推演的人物实体。');
        return;
    }

    agentDialogueRuntime = {
        ...agentDialogueRuntime,
        memoryId,
        session: null,
        running: false,
        summarized: false,
        currentHistoryMemoryId: memoryId,
        selectedMemoryId: memoryId,
        setupCandidates: candidates
    };

    await renderAgentDialogueWorkbenchMemory(memoryId);
    renderAgentDialogueSetup(memoryId, candidates, result.default_selected_ids || [], panel);
}

function renderAgentDialogueSetup(memoryId, candidates, defaultSelectedIds, container) {
    const selectedIds = defaultSelectedIds.length
        ? defaultSelectedIds
        : candidates.filter(candidate => candidate.type === 'PERSON').slice(0, 3).map(candidate => candidate.id);

    container.innerHTML = `
        <div class="agent-dialogue-card agent-dialogue-setup-card">
            <div class="agent-dialogue-card-header">
                <div>
                    <div class="agent-dialogue-title">${isAgentDialogueEnglish() ? 'Start Multi-person Review' : '开始多人物推演'}</div>
                    <div class="agent-dialogue-subtitle">${isAgentDialogueEnglish() ? 'Choose personas and a simulation mode' : '选择参与人物和推演模式'}</div>
                </div>
                <button class="agent-dialogue-close" onclick="hideAgentDialoguePanel()">×</button>
            </div>
            <div class="agent-dialogue-setup-body">
                <div class="agent-dialogue-setup-section">
                    <div class="agent-dialogue-setup-label">${isAgentDialogueEnglish() ? 'Personas' : '参与人物'} <span>${isAgentDialogueEnglish() ? 'up to 3' : '最多 3 位'}</span></div>
                    <div class="agent-dialogue-picker-list" id="agentDialogueParticipantList">
                        ${renderAgentDialogueParticipantOptions(candidates, selectedIds)}
                    </div>
                    <div class="agent-dialogue-setup-hint" id="agentDialogueParticipantHint"></div>
                </div>
                <div class="agent-dialogue-setup-section">
                    <div class="agent-dialogue-setup-label">${isAgentDialogueEnglish() ? 'Mode' : '推演模式'}</div>
                    <div class="agent-dialogue-mode-grid" id="agentDialogueModeGrid">
                        ${renderAgentDialogueModeOptions('review')}
                    </div>
                </div>
                <div class="agent-dialogue-setup-actions">
                    <button type="button" class="agent-dialogue-action-btn" onclick="confirmAgentDialogueSetup('${escapeAgentDialogueHtml(memoryId)}')">
                        ${isAgentDialogueEnglish() ? 'Start' : '开始推演'}
                    </button>
                </div>
            </div>
        </div>
    `;
    onAgentDialogueParticipantToggle();
}

function renderAgentDialogueParticipantOptions(candidates, selectedIds) {
    const selectedSet = new Set(selectedIds);
    return candidates.map(candidate => {
        const sourceLabel = agentDialogueCandidateSourceLabel(candidate.source);
        const checked = selectedSet.has(candidate.id) ? 'checked' : '';
        return `
            <label class="agent-dialogue-persona-option ${candidate.type === 'SELF' ? 'self' : ''}">
                <input type="checkbox" value="${escapeAgentDialogueHtml(candidate.id)}" ${checked} onchange="onAgentDialogueParticipantToggle()">
                <span class="agent-dialogue-persona-avatar">${escapeAgentDialogueHtml((candidate.name || '?').slice(0, 1))}</span>
                <span class="agent-dialogue-persona-main">
                    <span class="agent-dialogue-persona-name">${escapeAgentDialogueHtml(candidate.name)}</span>
                    <span class="agent-dialogue-persona-source">${escapeAgentDialogueHtml(sourceLabel)}</span>
                </span>
            </label>
        `;
    }).join('');
}

function renderAgentDialogueModeOptions(selectedMode) {
    return agentDialogueModes().map(mode => `
        <label class="agent-dialogue-mode-option">
            <input type="radio" name="agentDialogueMode" value="${mode.id}" ${mode.id === selectedMode ? 'checked' : ''}>
            <span>
                <strong>${escapeAgentDialogueHtml(mode.label)}</strong>
                <small>${escapeAgentDialogueHtml(mode.description)}</small>
            </span>
        </label>
    `).join('');
}

async function confirmAgentDialogueSetup(memoryId) {
    const participantIds = selectedAgentDialogueParticipantIds();
    if (participantIds.length === 0) {
        showToast(isAgentDialogueEnglish() ? 'Choose at least one persona' : '请至少选择一位人物', 'error');
        return;
    }

    const simulationMode = selectedAgentDialogueMode();
    const selectedCandidates = participantIds
        .map(id => (agentDialogueRuntime.setupCandidates || []).find(candidate => candidate.id === id))
        .filter(Boolean);
    const liveSession = {
        id: `pending_${Date.now()}`,
        memory_id: memoryId,
        mode: 'memory_review',
        simulation_mode: simulationMode,
        host: agentDialogueHostName(),
        participants: selectedCandidates.map(candidate => ({ id: candidate.id, name: candidate.name, type: candidate.type })),
        turns: [],
        created_at: new Date().toISOString()
    };

    agentDialogueRuntime = {
        ...agentDialogueRuntime,
        memoryId,
        session: liveSession,
        running: false,
        summarized: false,
        currentHistoryMemoryId: memoryId
    };

    const panel = getAgentDialoguePanelElement();
    if (panel) {
        renderAgentDialogueSession(liveSession, panel, { streaming: true });
    }

    await runAgentDialogueStep({
        memoryId,
        session: liveSession,
        rounds: 1,
        startRound: 1,
        includeSummary: false,
        participantIds,
        simulationMode,
        openingStatus: isAgentDialogueEnglish() ? 'Luoyi is inviting the personas...' : '洛忆正在邀请人物入场...'
    });
}

function selectedAgentDialogueParticipantIds() {
    return Array.from(document.querySelectorAll('#agentDialogueParticipantList input[type="checkbox"]:checked'))
        .map(input => input.value)
        .slice(0, 3);
}

function selectedAgentDialogueMode() {
    const input = document.querySelector('input[name="agentDialogueMode"]:checked');
    return input ? input.value : 'review';
}

function onAgentDialogueParticipantToggle() {
    const inputs = Array.from(document.querySelectorAll('#agentDialogueParticipantList input[type="checkbox"]'));
    const checked = inputs.filter(input => input.checked);
    inputs.forEach(input => {
        input.disabled = !input.checked && checked.length >= 3;
    });
    const hint = document.getElementById('agentDialogueParticipantHint');
    if (hint) {
        hint.textContent = isAgentDialogueEnglish()
            ? `${checked.length}/3 selected`
            : `已选择 ${checked.length}/3 位`;
    }
}

function agentDialogueModes() {
    return isAgentDialogueEnglish()
        ? [
            { id: 'review', label: 'Review', description: 'Recall what each persona can support from the memory.' },
            { id: 'confrontation', label: 'Confrontation', description: 'Surface possible misunderstandings or tension.' },
            { id: 'fill_gaps', label: 'Fill gaps', description: 'Mark likely motives or missing context as inference.' },
            { id: 'relationship', label: 'Relationship', description: 'Focus on how the relationship may have shifted.' },
            { id: 'counterfactual', label: 'What if', description: 'Explore one alternative choice without treating it as fact.' }
        ]
        : [
            { id: 'review', label: '复盘', description: '各自回忆这段记忆里有依据的感受和线索。' },
            { id: 'confrontation', label: '对质', description: '围绕误会、分歧或没说出口的部分回应。' },
            { id: 'fill_gaps', label: '补全空白', description: '把可能的动机或背景标成推测。' },
            { id: 'relationship', label: '关系变化', description: '关注亲近、疏远、信任或未完成感。' },
            { id: 'counterfactual', label: '如果当时', description: '轻量假设另一种选择会怎样。' }
        ];
}

function agentDialogueModeLabel(modeId) {
    const mode = agentDialogueModes().find(item => item.id === modeId);
    return mode ? mode.label : agentDialogueModes()[0].label;
}

function agentDialogueCandidateSourceLabel(source) {
    if (isAgentDialogueEnglish()) {
        return source === 'current' ? 'in this memory' : source === 'related' ? 'graph related' : 'self';
    }
    return source === 'current' ? '当前记忆' : source === 'related' ? '图谱相关' : '本人';
}
async function continueAgentDialogueRound() {
    const session = agentDialogueRuntime.session;
    if (!session || agentDialogueRuntime.running) return;

    await runAgentDialogueStep({
        memoryId: agentDialogueRuntime.memoryId || session.memory_id,
        session,
        rounds: 1,
        startRound: inferNextAgentDialogueRound(session.turns || []),
        includeSummary: false,
        openingStatus: isAgentDialogueEnglish() ? 'Continuing the next round...' : '正在继续下一轮...'
    });
}

async function summarizeAgentDialogue() {
    const session = agentDialogueRuntime.session;
    if (!session || agentDialogueRuntime.running) return;

    await runAgentDialogueStep({
        memoryId: agentDialogueRuntime.memoryId || session.memory_id,
        session,
        rounds: 0,
        startRound: inferLastAgentDialogueRound(session.turns || []) || 1,
        includeSummary: true,
        openingStatus: isAgentDialogueEnglish() ? 'Luoyi is summarizing...' : '洛忆正在总结...'
    });
}

async function runAgentDialogueStep({ memoryId, session, rounds, startRound, includeSummary, openingStatus, userQuestion, participantIds, simulationMode }) {
    if (!agentDialogueService || !memoryId || !session || agentDialogueRuntime.running) return;

    agentDialogueRuntime.memoryId = memoryId;
    agentDialogueRuntime.session = session;
    agentDialogueRuntime.running = true;
    updateAgentDialogueControls();
    updateAgentDialogueStatus(openingStatus || (isAgentDialogueEnglish() ? 'Generating...' : '生成中...'));

    const activeParticipantIds = participantIds || (session.participants || []).map(participant => participant.id).filter(Boolean);
    const activeSimulationMode = simulationMode || session.simulation_mode || 'review';
    const result = await agentDialogueService.createMemoryReview(memoryId, {
        stream: true,
        rounds,
        startRound,
        includeSummary,
        history: session.turns || [],
        question: userQuestion,
        participants: activeParticipantIds,
        simulationMode: activeSimulationMode,
        sessionId: agentDialogueRequestSessionId(session),
        createdAt: session.created_at || null,
        onEvent: (event, payload) => handleAgentDialogueStreamEvent(event, payload)
    });

    removeAllAgentDialogueTyping();
    agentDialogueRuntime.running = false;

    if (!result.success) {
        updateAgentDialogueStatus(result.error || (isAgentDialogueEnglish() ? 'Review failed.' : '复盘失败。'), true);
        updateAgentDialogueControls();
        return;
    }

    if (result.session) {
        mergeAgentDialogueSession(result.session);
    }

    agentDialogueRuntime.summarized = hasAgentDialogueSummary(agentDialogueRuntime.session);
    updateAgentDialogueStatus(includeSummary
        ? (isAgentDialogueEnglish() ? 'Luoyi has summarized.' : '洛忆已总结。')
        : (isAgentDialogueEnglish() ? 'Personas have replied.' : '人物已回应。'));
    updateAgentDialogueControls();

    showToast(includeSummary
        ? (isAgentDialogueEnglish() ? 'Summary generated' : '总结已生成')
        : (isAgentDialogueEnglish() ? 'Personas replied' : '人物已回应'), 'success');
    await loadAgentDialogueSessionsForMemory(memoryId);
}

function handleAgentDialogueStreamEvent(event, payload) {
    if (event === 'metadata') {
        const session = payload?.session;
        if (session) {
            mergeAgentDialogueSession(session);
            updateAgentDialogueControls();
        }
        updateAgentDialogueStatus(isAgentDialogueEnglish() ? 'Personas are taking turns...' : '人物正在轮流发言...');
        return;
    }

    if (event === 'speaking') {
        showAgentDialogueTyping(payload || {});
        const name = payload?.agent_name || '';
        const isHost = payload?.role === 'host' || payload?.agent_id === 'luoyi';
        updateAgentDialogueStatus(isHost
            ? (isAgentDialogueEnglish() ? 'Luoyi is speaking...' : '洛忆正在发言...')
            : (isAgentDialogueEnglish() ? `${name} is speaking...` : `${name} 正在发言...`));
        return;
    }

    if (event === 'turn') {
        const turn = payload?.turn;
        if (!turn) return;
        removeAgentDialogueTyping(turn);
        addAgentDialogueTurnToSession(turn);
        appendAgentDialogueTurn(turn);
        persistAgentDialogueSessionSoon();
        updateAgentDialogueStatus(turn.role === 'host' || turn.agent_id === 'luoyi'
            ? (isAgentDialogueEnglish() ? 'Luoyi has spoken.' : '洛忆已发言。')
            : (isAgentDialogueEnglish() ? `${turn.agent_name} has spoken.` : `${turn.agent_name} 已发言。`));
        return;
    }

    if (event === 'done') {
        removeAllAgentDialogueTyping();
        if (payload?.session) {
            mergeAgentDialogueSession(payload.session);
        }
        return;
    }

    if (event === 'error') {
        removeAllAgentDialogueTyping();
        updateAgentDialogueStatus(payload?.message || (isAgentDialogueEnglish() ? 'Review failed.' : '复盘失败。'), true);
    }
}

async function loadAgentDialogueSessionsForMemory(memoryId) {
    const historyEl = getAgentDialogueHistoryElement();
    if (!historyEl || !agentDialogueService) return;
    agentDialogueRuntime.currentHistoryMemoryId = memoryId;

    try {
        const sessions = await agentDialogueService.getSessionsForMemory(memoryId);
        if (!sessions || sessions.length === 0) {
            historyEl.innerHTML = '';
            return;
        }

        historyEl.innerHTML = `
            <div class="agent-dialogue-history-title">
                ${isAgentDialogueEnglish() ? 'Previous reviews' : '历史复盘'}
            </div>
            ${sessions.slice(0, 3).map(session => `
                <div class="agent-dialogue-history-item" data-session-id="${escapeAgentDialogueHtml(session.id)}">
                    <button type="button" class="agent-dialogue-history-open" onclick="showSavedAgentDialogueSession(this.closest('.agent-dialogue-history-item').dataset.sessionId)">
                        <span>${formatAgentDialogueDate(session.created_at)}</span>
                        <span>${(session.participants || []).map(p => escapeAgentDialogueHtml(p.name)).join(' / ')}</span>
                    </button>
                    <button type="button" class="agent-dialogue-history-delete" title="${isAgentDialogueEnglish() ? 'Delete' : '删除'}" aria-label="${isAgentDialogueEnglish() ? 'Delete review' : '删除历史复盘'}" onclick="deleteAgentDialogueSession(event, this.closest('.agent-dialogue-history-item').dataset.sessionId)">×</button>
                </div>
            `).join('')}
        `;
    } catch (error) {
        console.warn('[AgentDialogue] load history failed:', error);
    }
}

async function deleteAgentDialogueSession(event, sessionId) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    if (!sessionId || !db) return;

    const confirmed = window.confirm(isAgentDialogueEnglish() ? 'Delete this review?' : '删除这条历史复盘？');
    if (!confirmed) return;

    const historyItem = event?.currentTarget?.closest('.agent-dialogue-history-item') || null;
    const memoryId = agentDialogueRuntime.currentHistoryMemoryId || agentDialogueRuntime.memoryId;

    try {
        const session = await db.getAgentDialogueSession(sessionId);
        const refreshMemoryId = session?.memory_id || memoryId;

        if (historyItem) {
            historyItem.remove();
        }

        await db.deleteAgentDialogueSession(sessionId);

        if (agentDialogueRuntime.session?.id === sessionId) {
            hideAgentDialoguePanel();
            agentDialogueRuntime.session = null;
            agentDialogueRuntime.summarized = false;
        }

        if (refreshMemoryId) {
            await loadAgentDialogueSessionsForMemory(refreshMemoryId);
        }
        showToast(isAgentDialogueEnglish() ? 'Review deleted' : '历史复盘已删除', 'success');
    } catch (error) {
        console.warn('[AgentDialogue] delete history failed:', error);
        if (memoryId) {
            await loadAgentDialogueSessionsForMemory(memoryId);
        }
        showToast(error.message || (isAgentDialogueEnglish() ? 'Delete failed' : '删除失败'), 'error');
    }
}
async function showSavedAgentDialogueSession(sessionId) {
    if (!agentDialogueService) return;
    const panel = getAgentDialoguePanelElement();
    if (!panel) return;

    const session = await db.getAgentDialogueSession(sessionId);
    if (!session) return;

    agentDialogueRuntime = {
        ...agentDialogueRuntime,
        memoryId: session.memory_id,
        selectedMemoryId: session.memory_id,
        session,
        running: false,
        summarized: hasAgentDialogueSummary(session),
        currentHistoryMemoryId: session.memory_id
    };

    await renderAgentDialogueWorkbenchMemory(session.memory_id);
    panel.style.display = 'block';
    renderAgentDialogueSession(session, panel);
}

function renderAgentDialogueSession(session, container, options = {}) {
    if (!session || !container) return;

    const turns = session.turns || [];
    const modeLabel = agentDialogueModeLabel(session.simulation_mode || 'review');
    container.innerHTML = `
        <div class="agent-dialogue-card">
            <div class="agent-dialogue-card-header">
                <div>
                    <div class="agent-dialogue-title">${isAgentDialogueEnglish() ? 'Multi-person Review' : '多人物推演'}</div>
                    <div class="agent-dialogue-subtitle">${isAgentDialogueEnglish() ? 'Exploratory dialogue hosted by Luoyi' : '由洛忆主持的探索性对话'} · ${escapeAgentDialogueHtml(modeLabel)}</div>
                </div>
                <button class="agent-dialogue-close" onclick="hideAgentDialoguePanel()">×</button>
            </div>
            <div class="agent-dialogue-notice">
                ${isAgentDialogueEnglish()
                    ? 'This is an exploratory simulation. Personas can infer motives and links inside the memory story; only the original memory text is factual.'
                    : '这是探索性模拟。人物会在记忆故事内推演动机和关系；只有记忆原文才应视为事实。'}
            </div>
            <div class="agent-dialogue-status ${options.streaming ? 'streaming' : ''}" id="agentDialogueStatus">
                ${options.streaming ? (isAgentDialogueEnglish() ? 'Preparing...' : '准备中...') : ''}
            </div>
            <div class="agent-dialogue-turns" id="agentDialogueTurns">
                ${turns.map(turn => renderAgentDialogueTurn(turn)).join('')}
            </div>
            <div class="agent-dialogue-controls" id="agentDialogueControls">
                ${renderAgentDialogueControlsHtml(session, options)}
            </div>
        </div>
    `;
}

function renderAgentDialogueControlsHtml(session, options = {}) {
    const turns = session?.turns || [];
    const hasParticipantTurns = turns.some(turn => turn.role === 'participant');
    const running = options.running ?? agentDialogueRuntime.running;
    const summarized = options.summarized ?? hasAgentDialogueSummary(session);
    const chatDisabled = running || !hasParticipantTurns || summarized;
    const summaryDisabled = running || !hasParticipantTurns || summarized;
    const placeholder = summarized
        ? (isAgentDialogueEnglish() ? 'This review has been summarized.' : '这场复盘已经总结。')
        : (isAgentDialogueEnglish() ? 'Join the conversation...' : '输入你的回应，参与这场对话...');

    return `
        <div class="agent-dialogue-chatbar">
            <textarea id="agentDialogueUserInput" class="agent-dialogue-chat-input" rows="2" maxlength="500" placeholder="${escapeAgentDialogueHtml(placeholder)}" onkeydown="onAgentDialogueInputKeydown(event)" ${chatDisabled ? 'disabled' : ''}></textarea>
            <button type="button" class="agent-dialogue-action-btn" onclick="sendAgentDialogueUserMessage()" ${chatDisabled ? 'disabled' : ''}>
                ${isAgentDialogueEnglish() ? 'Send' : '发送'}
            </button>
        </div>
        <button type="button" class="agent-dialogue-action-btn secondary" onclick="summarizeAgentDialogue()" ${summaryDisabled ? 'disabled' : ''}>
            ${summarized ? (isAgentDialogueEnglish() ? 'Summarized' : '已总结') : (isAgentDialogueEnglish() ? 'Luoyi Summary' : '洛忆总结')}
        </button>
    `;
}

async function sendAgentDialogueUserMessage() {
    const session = agentDialogueRuntime.session;
    if (!session || agentDialogueRuntime.running || hasAgentDialogueSummary(session)) return;

    const input = document.getElementById('agentDialogueUserInput');
    const content = (input?.value || '').trim();
    if (!content) return;

    const memoryId = agentDialogueRuntime.memoryId || session.memory_id;
    if (!memoryId) return;

    const round = inferNextAgentDialogueRound(session.turns || []);
    const userTurn = {
        id: `user_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        role: 'user',
        agent_id: 'user',
        agent_name: isAgentDialogueEnglish() ? 'You' : '你',
        content,
        round,
        evidence_ids: [],
        created_at: new Date().toISOString()
    };

    session.turns = mergeAgentDialogueTurns(session.turns || [], [userTurn]);
    session.updated_at = new Date().toISOString();
    agentDialogueRuntime.session = session;
    appendAgentDialogueTurn(userTurn);
    if (input) input.value = '';
    updateAgentDialogueControls();

    try {
        await db.saveAgentDialogueSession(session);
    } catch (error) {
        console.warn('[AgentDialogue] save user turn failed:', error);
    }

    await runAgentDialogueStep({
        memoryId,
        session,
        rounds: 1,
        startRound: round,
        includeSummary: false,
        userQuestion: content,
        openingStatus: isAgentDialogueEnglish() ? 'Personas are replying...' : '人物正在回应你...'
    });
}

function onAgentDialogueInputKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    sendAgentDialogueUserMessage();
}

function persistAgentDialogueSessionSoon() {
    const session = agentDialogueRuntime.session;
    if (!db || !session || !session.id || session.id.startsWith('pending_')) return;
    db.saveAgentDialogueSession(session).catch(error => {
        console.warn('[AgentDialogue] save streamed turn failed:', error);
    });
}
function updateAgentDialogueControls() {
    const controlsEl = document.getElementById('agentDialogueControls');
    if (!controlsEl) return;
    controlsEl.innerHTML = renderAgentDialogueControlsHtml(agentDialogueRuntime.session, {
        running: agentDialogueRuntime.running,
        summarized: agentDialogueRuntime.summarized
    });
}

function appendAgentDialogueTurn(turn) {
    const turnsEl = document.getElementById('agentDialogueTurns');
    if (!turnsEl) return;

    const key = agentDialogueTurnDomKey(turn);
    if (turnsEl.querySelector(`[data-turn-key="${key}"]`)) return;

    turnsEl.insertAdjacentHTML('beforeend', renderAgentDialogueTurn(turn));
    turnsEl.scrollTop = turnsEl.scrollHeight;
}

function showAgentDialogueTyping(speaker) {
    const turnsEl = document.getElementById('agentDialogueTurns');
    if (!turnsEl) return;

    removeAgentDialogueTyping(speaker);
    turnsEl.insertAdjacentHTML('beforeend', renderAgentDialogueTyping(speaker));
    turnsEl.scrollTop = turnsEl.scrollHeight;
}

function removeAgentDialogueTyping(speaker) {
    const turnsEl = document.getElementById('agentDialogueTurns');
    if (!turnsEl) return;
    const key = agentDialogueTypingDomKey(speaker);
    const node = turnsEl.querySelector(`[data-typing-key="${key}"]`);
    if (node) node.remove();
}

function removeAllAgentDialogueTyping() {
    document.querySelectorAll('.agent-dialogue-turn.typing').forEach(node => node.remove());
}

function updateAgentDialogueStatus(message, isError = false) {
    const statusEl = document.getElementById('agentDialogueStatus');
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('error', !!isError);
    statusEl.classList.toggle('streaming', !!message && !isError && agentDialogueRuntime.running);
}

function renderAgentDialogueTurn(turn) {
    const isHost = turn.role === 'host' || turn.agent_id === 'luoyi';
    const isUser = turn.role === 'user' || turn.agent_id === 'user';
    const turnClass = isHost ? 'host' : (isUser ? 'user' : 'participant');
    const roundLabel = turn.round && !isHost
        ? `<span class="agent-dialogue-round">${isAgentDialogueEnglish() ? `Round ${turn.round}` : `第 ${turn.round} 轮`}</span>`
        : '';
    return `
        <div class="agent-dialogue-turn ${turnClass}" data-turn-key="${agentDialogueTurnDomKey(turn)}">
            <div class="agent-dialogue-avatar">${escapeAgentDialogueHtml((turn.agent_name || '?').slice(0, 1))}</div>
            <div class="agent-dialogue-bubble">
                <div class="agent-dialogue-speaker">
                    ${escapeAgentDialogueHtml(turn.agent_name || '')}
                    ${roundLabel}
                </div>
                <div class="agent-dialogue-content">${escapeAgentDialogueHtml(turn.content || '')}</div>
                ${renderAgentDialogueTurnMeta(turn)}
            </div>
        </div>
    `;
}

function renderAgentDialogueTurnMeta(turn) {
    const evidenceRefs = Array.isArray(turn.evidence_refs) ? turn.evidence_refs : [];
    const inferenceNotes = Array.isArray(turn.inference_notes) ? turn.inference_notes : [];
    if (turn.role === 'user' || (!evidenceRefs.length && !inferenceNotes.length && !turn.confidence)) {
        return '';
    }

    const confidence = normalizeAgentDialogueConfidence(turn.confidence);
    const evidenceHtml = evidenceRefs.length
        ? `<div class="agent-dialogue-meta-group">
            <div class="agent-dialogue-meta-title">${isAgentDialogueEnglish() ? 'Evidence' : '依据'}</div>
            <ul>${evidenceRefs.map(ref => `
                <li>
                    <span class="agent-dialogue-memory-id">${escapeAgentDialogueHtml(ref.memory_id || (isAgentDialogueEnglish() ? 'memory' : '记忆'))}</span>
                    ${ref.quote ? `<div>${escapeAgentDialogueHtml(ref.quote)}</div>` : ''}
                    ${ref.reason ? `<small>${escapeAgentDialogueHtml(ref.reason)}</small>` : ''}
                </li>
            `).join('')}</ul>
        </div>`
        : '';
    const inferenceHtml = inferenceNotes.length
        ? `<div class="agent-dialogue-meta-group">
            <div class="agent-dialogue-meta-title">${isAgentDialogueEnglish() ? 'Inference' : '推测'}</div>
            <ul>${inferenceNotes.map(note => `<li>${escapeAgentDialogueHtml(note)}</li>`).join('')}</ul>
        </div>`
        : '';

    return `
        <details class="agent-dialogue-meta">
            <summary>
                <span>${isAgentDialogueEnglish() ? 'Evidence / inference' : '依据 / 推测'}</span>
                <span class="agent-dialogue-confidence ${confidence}">${agentDialogueConfidenceLabel(confidence)}</span>
            </summary>
            ${evidenceHtml}
            ${inferenceHtml}
        </details>
    `;
}

function normalizeAgentDialogueConfidence(value) {
    const normalized = String(value || '').toLowerCase();
    return ['high', 'medium', 'low'].includes(normalized) ? normalized : 'medium';
}

function agentDialogueConfidenceLabel(value) {
    if (isAgentDialogueEnglish()) {
        return value === 'high' ? 'High' : value === 'low' ? 'Low' : 'Medium';
    }
    return value === 'high' ? '高' : value === 'low' ? '低' : '中';
}
function renderAgentDialogueTyping(speaker) {
    const isHost = speaker.role === 'host' || speaker.agent_id === 'luoyi';
    const name = speaker.agent_name || (isHost ? agentDialogueHostName() : '?');
    const text = isHost
        ? (isAgentDialogueEnglish() ? 'Summarizing' : '正在总结')
        : (isAgentDialogueEnglish() ? 'Speaking' : '正在发言');
    const roundLabel = speaker.round && !isHost
        ? `<span class="agent-dialogue-round">${isAgentDialogueEnglish() ? `Round ${speaker.round}` : `第 ${speaker.round} 轮`}</span>`
        : '';

    return `
        <div class="agent-dialogue-turn ${isHost ? 'host' : 'participant'} typing" data-typing-key="${agentDialogueTypingDomKey(speaker)}">
            <div class="agent-dialogue-avatar">${escapeAgentDialogueHtml(name.slice(0, 1))}</div>
            <div class="agent-dialogue-bubble">
                <div class="agent-dialogue-speaker">
                    ${escapeAgentDialogueHtml(name)}
                    ${roundLabel}
                </div>
                <div class="agent-dialogue-content agent-dialogue-typing-text">
                    ${escapeAgentDialogueHtml(text)}<span class="agent-dialogue-typing-dots"><span></span><span></span><span></span></span>
                </div>
            </div>
        </div>
    `;
}

function mergeAgentDialogueSession(nextSession) {
    const current = agentDialogueRuntime.session || {};
    const turns = mergeAgentDialogueTurns(current.turns || [], nextSession.turns || []);
    agentDialogueRuntime.session = { ...current, ...nextSession, turns };
    agentDialogueRuntime.summarized = hasAgentDialogueSummary(agentDialogueRuntime.session);
    return agentDialogueRuntime.session;
}

function addAgentDialogueTurnToSession(turn) {
    const session = agentDialogueRuntime.session;
    if (!session) return;
    session.turns = mergeAgentDialogueTurns(session.turns || [], [turn]);
    agentDialogueRuntime.summarized = hasAgentDialogueSummary(session);
}

function mergeAgentDialogueTurns(existing, incoming) {
    const seen = new Set();
    const result = [];
    [...existing, ...incoming].forEach(turn => {
        const key = agentDialogueTurnDomKey(turn);
        if (seen.has(key)) return;
        seen.add(key);
        result.push(turn);
    });
    return result;
}

function inferNextAgentDialogueRound(turns) {
    return inferLastAgentDialogueRound(turns) + 1;
}

function inferLastAgentDialogueRound(turns) {
    const participantRounds = (turns || [])
        .filter(turn => turn.role === 'participant')
        .map(turn => Number(turn.round || 0));
    return participantRounds.length ? Math.max(...participantRounds) : 0;
}

function hasAgentDialogueSummary(session) {
    return (session?.turns || []).some(turn => turn.role === 'host' || turn.agent_id === 'luoyi');
}

function agentDialogueRequestSessionId(session) {
    const id = session?.id || '';
    return id.startsWith('pending_') ? null : id;
}

function agentDialogueTurnDomKey(turn) {
    if (!turn) return 'unknown';
    return sanitizeAgentDialogueDomKey(turn.id || `${turn.role || 'turn'}_${turn.agent_id || turn.agent_name || 'agent'}_${turn.round || 0}_${turn.content || ''}`);
}

function agentDialogueTypingDomKey(speaker) {
    if (!speaker) return 'typing_unknown';
    return sanitizeAgentDialogueDomKey(`typing_${speaker.role || 'participant'}_${speaker.agent_id || speaker.agent_name || 'agent'}_${speaker.round || 0}`);
}

function sanitizeAgentDialogueDomKey(value) {
    return String(value || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

function hideAgentDialoguePanel() {
    const panel = getAgentDialoguePanelElement();
    if (panel) {
        panel.style.display = 'none';
    }
}

function showAgentDialogueError(panel, message) {
    panel.style.display = 'block';
    panel.innerHTML = `
        <div class="agent-dialogue-error">
            ${escapeAgentDialogueHtml(message)}
        </div>
    `;
    showToast(message, 'error');
}

function formatAgentDialogueDate(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString(currentLocale(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (error) {
        return value;
    }
}

function isAgentDialogueEnglish() {
    return currentLocale() === 'en-US';
}

function agentDialogueHostName() {
    return isAgentDialogueEnglish() ? 'Luoyi' : '洛忆';
}

function escapeAgentDialogueHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}









