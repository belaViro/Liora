/**
 * UI glue for Luoyi-hosted multi-persona memory review.
 */

let agentDialogueRuntime = {
    memoryId: null,
    session: null,
    running: false,
    summarized: false,
    currentHistoryMemoryId: null
};

async function startAgentDialogueForMemory(memoryId) {
    const panel = document.getElementById('agentDialoguePanel');
    if (!panel) return;

    if (!agentDialogueService) {
        showAgentDialogueError(panel, isAgentDialogueEnglish() ? 'Agent dialogue service is not ready.' : '多人物复盘服务尚未就绪。');
        return;
    }

    const liveSession = {
        id: `pending_${Date.now()}`,
        memory_id: memoryId,
        host: agentDialogueHostName(),
        participants: [],
        turns: [],
        created_at: new Date().toISOString()
    };

    agentDialogueRuntime = {
        memoryId,
        session: liveSession,
        running: false,
        summarized: false,
        currentHistoryMemoryId: memoryId
    };

    panel.style.display = 'block';
    renderAgentDialogueSession(liveSession, panel, { streaming: true });

    await runAgentDialogueStep({
        memoryId,
        session: liveSession,
        rounds: 1,
        startRound: 1,
        includeSummary: false,
        openingStatus: isAgentDialogueEnglish() ? 'Luoyi is inviting the personas...' : '洛忆正在邀请人物入场...'
    });
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

async function runAgentDialogueStep({ memoryId, session, rounds, startRound, includeSummary, openingStatus, userQuestion }) {
    if (!agentDialogueService || !memoryId || !session || agentDialogueRuntime.running) return;

    agentDialogueRuntime.memoryId = memoryId;
    agentDialogueRuntime.session = session;
    agentDialogueRuntime.running = true;
    updateAgentDialogueControls();
    updateAgentDialogueStatus(openingStatus || (isAgentDialogueEnglish() ? 'Generating...' : '生成中...'));

    const result = await agentDialogueService.createMemoryReview(memoryId, {
        stream: true,
        rounds,
        startRound,
        includeSummary,
        history: session.turns || [],
        question: userQuestion,
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
    const historyEl = document.getElementById('agentDialogueHistory');
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
    const panel = document.getElementById('agentDialoguePanel');
    if (!panel) return;

    const session = await db.getAgentDialogueSession(sessionId);
    if (!session) return;

    agentDialogueRuntime = {
        memoryId: session.memory_id,
        session,
        running: false,
        summarized: hasAgentDialogueSummary(session),
        currentHistoryMemoryId: session.memory_id
    };

    panel.style.display = 'block';
    renderAgentDialogueSession(session, panel);
}

function renderAgentDialogueSession(session, container, options = {}) {
    if (!session || !container) return;

    const turns = session.turns || [];
    container.innerHTML = `
        <div class="agent-dialogue-card">
            <div class="agent-dialogue-card-header">
                <div>
                    <div class="agent-dialogue-title">${isAgentDialogueEnglish() ? 'Multi-person Review' : '多人物推演'}</div>
                    <div class="agent-dialogue-subtitle">${isAgentDialogueEnglish() ? 'Exploratory dialogue hosted by Luoyi' : '由洛忆主持的探索性对话'}</div>
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
            </div>
        </div>
    `;
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
    const panel = document.getElementById('agentDialoguePanel');
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