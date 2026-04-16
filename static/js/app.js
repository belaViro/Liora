/**
 * Liora 前端应用 - 增强版图谱可视化
 */

// 全局状态
let currentTab = 'create';
let graphData = { nodes: [], edges: [] };
let simulation = null;
let socket = null;
let showEdgeLabels = false;  // MiroFish: 默认隐藏边标签，更简洁
let linkLabelsRef = null;
let linkLabelBgRef = null;
let highlightedNodeIds = new Set(); // 搜索时高亮的节点ID
let expandedSelfLoops = new Set();  // 自环展开状态
let graphZoom = null;               // D3 zoom 行为引用
let highlightedPath = null;         // 路径侦探高亮的路径 {nodeIds: Set, edgeIds: Set}
let luoyiChatHistory = [];          // 洛忆聊天历史

// ==================== IndexedDB 服务初始化 ====================
// 以下全局变量在 DOMContentLoaded 时初始化
let db = null;
let memoryService = null;
let graphService = null;
let vectorSearch = null;

// ==================== 移动端菜单 ====================

function toggleMobileMenu() {
    const menu = document.getElementById('mobileMenu');
    if (menu) {
        menu.classList.toggle('show');
    }
}

// 点击外部关闭移动端菜单
document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobileMenu');
    const btn = document.querySelector('.mobile-menu-btn');
    if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('show');
    }
});

// ==================== 产品详情面板 ====================

function toggleProductInfo() {
    const panel = document.getElementById('piPanel');
    const overlay = document.getElementById('piOverlay');
    if (panel && overlay) {
        panel.classList.toggle('active');
        overlay.classList.toggle('active');
    }
}

// ESC 键关闭产品详情
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const panel = document.getElementById('piPanel');
        if (panel && panel.classList.contains('active')) {
            toggleProductInfo();
        }
    }
});

// ==================== Liora 功能函数 ====================

// 根据情感值获取图标
function getEmotionIcon(valence) {
    if (valence > 0.3) return '😊';
    if (valence < -0.3) return '😔';
    return '😐';
}

// 格式化相对时间
function formatTimeAgo(days) {
    if (days < 30) {
        return `${days} 天前`;
    } else if (days < 365) {
        const months = Math.floor(days / 30);
        return `${months} 个月前`;
    } else {
        const years = Math.floor(days / 365);
        const remainingMonths = Math.floor((days % 365) / 30);
        if (remainingMonths === 0) {
            return `${years} 年前`;
        } else {
            return `${years} 年 ${remainingMonths} 个月前`;
        }
    }
}

// 显示提示消息
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// 渲染关联记忆列表
function renderLinkedMemories(memoryIds) {
    // 如果记忆数据未加载，先显示占位符并异步加载
    if (allMemories.length === 0) {
        // 异步加载记忆并刷新显示
        loadMemories().then(() => {
            const content = document.getElementById('detailContent');
            if (content && currentSelectedNode) {
                showNodeDetail(currentSelectedNode);
            }
        });
        
        return `
            <div class="detail-section">
                <div class="section-title">关联记忆 (${memoryIds.length})</div>
                <div style="font-size: 12px; color: #999; padding: 10px; text-align: center;">
                    加载中...
                </div>
            </div>
        `;
    }
    
    // 从已加载的记忆中查找关联记忆
    const linkedMemories = allMemories.filter(m => memoryIds.includes(m.id));
    
    if (linkedMemories.length === 0) {
        return `
            <div class="detail-section">
                <div class="section-title">关联记忆 (${memoryIds.length})</div>
                <div style="font-size: 12px; color: #999; padding: 10px;">
                    暂无记忆详情
                </div>
            </div>
        `;
    }
    
    return `
        <div class="detail-section">
            <div class="section-title">关联记忆 (${linkedMemories.length})</div>
            <div class="linked-memories-list">
                ${linkedMemories.slice(0, 5).map(m => {
                    const preview = (m.understanding?.description || m.content || '').substring(0, 60);
                    const date = m.created_at ? new Date(m.created_at).toLocaleDateString('zh-CN', {month: 'short', day: 'numeric'}) : '';
                    const hasEmotion = m.emotion?.label;
                    const emotionIcon = hasEmotion ? getEmotionIcon(m.emotion.valence) : '';
                    return `
                        <div class="linked-memory-item" onclick="viewMemory('${m.id}')">
                            <div class="linked-memory-date">${date}</div>
                            <div class="linked-memory-preview">${emotionIcon} ${preview}${preview.length >= 60 ? '...' : ''}</div>
                        </div>
                    `;
                }).join('')}
                ${linkedMemories.length > 5 ? `<div class="linked-memory-more">还有 ${linkedMemories.length - 5} 条记忆...</div>` : ''}
            </div>
        </div>
    `;
}

// 节点颜色映射
const colorMap = {
    'PERSON': '#FF6B35',
    'LOCATION': '#004E89',
    'TIME': '#7B2D8E',
    'EVENT': '#C5283D',
    'OBJECT': '#1A936F',
    'EMOTION': '#E9724C',
    'CONCEPT': '#3498db'
};

// 边的颜色映射（支持中英文）
const edgeColorMap = {
    // 中文映射
    '家族关系': '#E91E63',
    '合作关系': '#9C27B0',
    '领导': '#FF6B35',
    '对抗': '#C5283D',
    '救援': '#1A936F',
    '位于': '#1A936F',
    '发生于': '#7B2D8E',
    '导致': '#C5283D',
    '关联': '#3498db',
    '属于': '#E9724C',
    '相关': '#999999',
    // 英文映射（新增）
    'family_of': '#E91E63',
    'friend_of': '#9C27B0',
    'colleague_with': '#9C27B0',
    'worked_with': '#9C27B0',
    'led': '#FF6B35',
    'led_to': '#C5283D',
    'opposed': '#C5283D',
    'fought_with': '#C5283D',
    'rescued': '#1A936F',
    'located_in': '#1A936F',
    'happened_at': '#7B2D8E',
    'happened_with': '#7B2D8E',
    'caused_by': '#C5283D',
    'associated_with': '#3498db',
    'belongs_to': '#E9724C',
    'part_of': '#E9724C',
    'related': '#999999'
};

// 边类型中文映射（英文→中文）- 内置默认值
let edgeTypeNames = {};

// 内置默认映射（作为fallback）
const defaultEdgeTypeNames = {
    // 中文（保持原样）
    '家族关系': '家族关系',
    '合作关系': '合作',
    '领导': '领导',
    '下属': '下属',
    '对抗': '对抗',
    '竞争': '竞争',
    '救援': '救援',
    '帮助': '帮助',
    '位于': '位于',
    '居住于': '居住于',
    '出生于': '出生于',
    '工作于': '工作于',
    '发生于': '发生于',
    '参与': '参与',
    '导致': '导致',
    '起因': '起因',
    '结果': '结果',
    '关联': '关联',
    '相关': '相关',
    '属于': '属于',
    '成员': '成员',
    '部分': '部分',
    '包含': '包含',
    '拥有': '拥有',
    '创建': '创建',
    '创立': '创立',
    '使用': '使用',
    '学习': '学习',
    '教授': '教授',
    '影响': '影响',
    '继承': '继承',
    // 英文→中文（兼容性）
    'family_of': '家族关系',
    'friend_of': '朋友',
    'colleague_with': '同事',
    'worked_with': '合作',
    'led': '领导',
    'led_to': '导致',
    'opposed': '对抗',
    'fought_with': '交战',
    'rescued': '救援',
    'located_in': '位于',
    'happened_at': '发生于',
    'happened_with': '参与',
    'caused_by': '由...导致',
    'associated_with': '关联',
    'belongs_to': '属于',
    'part_of': '部分',
    'related': '相关',
};

// 加载关系类型配置
async function loadRelationTypes() {
    try {
        const response = await fetch('/data/relation_types.json');
        if (response.ok) {
            const config = await response.json();
            // 合并配置：配置文件优先级高于内置默认值
            edgeTypeNames = { ...defaultEdgeTypeNames, ...config };
            console.log('Loaded relation types from config:', Object.keys(config).length - 2, 'types');
        } else {
            console.warn('Failed to load relation_types.json, using defaults');
            edgeTypeNames = { ...defaultEdgeTypeNames };
        }
    } catch (e) {
        console.warn('Error loading relation types:', e);
        edgeTypeNames = { ...defaultEdgeTypeNames };
    }
}

// 动态添加新的关系类型映射
function addRelationType(key, chineseName) {
    edgeTypeNames[key] = chineseName;
    console.log('Added new relation type:', key, '->', chineseName);
}

// 获取关系类型的中文名称（带fallback）
function getRelationTypeName(type) {
    if (!type) return '相关';
    // 直接命中映射表
    if (edgeTypeNames[type]) {
        return edgeTypeNames[type];
    }
    // 如果已经是中文（不含下划线），直接返回
    if (!type.includes('_') && /[\u4e00-\u9fa5]/.test(type)) {
        return type;
    }
    // 默认格式化：下划线转空格，首字母大写
    return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// 根据时间置信度返回颜色
function getTemporalConfidenceColor(confidence) {
    if (confidence >= 0.8) return '#1a936f';  // 绿色 - 高置信度
    if (confidence >= 0.5) return '#f39c12';  // 橙色 - 中等
    return '#e74c3c';                          // 红色 - 低置信度
}

// 格式化日期时间
function formatDateTime(dateStr) {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        return date.toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return dateStr;
    }
}

// 格式化时间信息用于显示
function formatTemporalInfoForDisplay(temporalInfo) {
    // 暂时显示开发中
    return `
        <div class="detail-row">
            <span class="detail-label">时间信息:</span>
            <span style="color: #999; font-style: italic;">开发中...</span>
        </div>
    `;
}

// 初始化
document.addEventListener('DOMContentLoaded', async function() {
    // 先加载关系类型配置
    await loadRelationTypes();

    // 初始化 IndexedDB 和服务（数据主权在客户端）
    try {
        db = new MemoryWeaverDB();
        await db.init();
        console.log('[App] IndexedDB initialized');

        vectorSearch = new ClientVectorSearch(computeApi);
        await vectorSearch.init();
        console.log('[App] Vector search initialized');

        memoryService = new ClientMemoryService(db, computeApi, vectorSearch);
        graphService = new ClientGraphService(db, computeApi);
        console.log('[App] Client services initialized');

        // 从 IndexedDB 加载已有数据
        const savedGraphData = await db.getGraphData({ max_nodes: 0 });
        if (savedGraphData.nodes && savedGraphData.nodes.length > 0) {
            graphData = savedGraphData;
        }
    } catch (e) {
        console.error('[App] Failed to initialize IndexedDB:', e);
    }

    initSocket();
    initGraph();
    loadGraphData();
    loadMemories();
    loadStats();

    // 边标签开关事件
    const edgeLabelsToggle = document.getElementById('showEdgeLabels');
    if (edgeLabelsToggle) {
        edgeLabelsToggle.addEventListener('change', function(e) {
            showEdgeLabels = e.target.checked;
            toggleEdgeLabels(showEdgeLabels);
        });
    }
    
    // 探索面板回车发送
    const exploreInput = document.getElementById('exploreChatInput');
    if (exploreInput) {
        exploreInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendExploreQuestion();
            }
        });
    }
    
    // 记忆弹窗点击外部关闭
    const memoryModal = document.getElementById('memoryModal');
    if (memoryModal) {
        memoryModal.addEventListener('click', function(e) {
            if (e.target === memoryModal) {
                closeMemoryModal();
            }
        });
    }

    // 洛忆聊天回车发送
    const luoyiInput = document.getElementById('luoyiChatInput');
    if (luoyiInput) {
        luoyiInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendLuoyiMessage();
            }
        });
    }
});

// Socket.IO 连接
function initSocket() {
    socket = io();

    socket.on('connect', function() {
        console.log('已连接到服务器');
    });

    socket.on('processing_status', function(data) {
        showStatus(data.message, data.status);
    });

    socket.on('disconnect', function() {
        console.log('与服务器断开连接');
    });
}

// ==================== 选项卡切换 ====================

function switchTab(tab, event, skipLoad) {
    currentTab = tab;

    // 更新选项卡样式
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // 代码调用时，通过tab参数查找对应元素
        document.querySelector(`.tab[onclick*="${tab}"]`)?.classList.add('active');
    }

    // 切换面板
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`panel-${tab}`).classList.add('active');

    // 离开探索面板时隐藏探索特有区域
    if (tab !== 'explore') {
        const pathFinder = document.getElementById('pathFinder');
        if (pathFinder) pathFinder.style.display = 'none';
        const storyGen = document.querySelector('.explore-story-gen');
        if (storyGen) storyGen.style.display = 'none';
    }

    // 加载对应数据（skipLoad=true时跳过）
    if (!skipLoad) {
        if (tab === 'memories') {
            loadMemories();
        } else if (tab === 'stats') {
            loadStats();
        } else if (tab === 'timetravel') {
            loadTimeTravelMemories();
        }
    }
}

// ==================== 时光旅行 - 历史上的今天 ====================

function openTimeTravelPanel() {
    // 切换到时光面板
    switchTab('timetravel', null, true);
    // 显示时光选项卡
    document.querySelectorAll('.tab').forEach(t => {
        if (t.textContent.includes('录入')) {
            t.classList.remove('active');
        }
    });
    loadTimeTravelMemories();
}

// 显示记忆卡片模态框
async function showMemoryCard(memoryId, daysDiff) {
    const memory = allMemories.find(m => m.id === memoryId);
    if (!memory) return;
    
    const modal = document.getElementById('memoryCardModal');
    
    // 填充卡片内容
    const content = memory.understanding?.description || memory.content || '';
    const date = new Date(memory.created_at);
    const dateStr = date.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
    
    // 情感图标
    const emotionIcon = memory.emotion ? getEmotionIcon(memory.emotion.valence) : '😐';
    
    // 填充卡片元素
    document.getElementById('cardDate').textContent = dateStr;
    document.getElementById('cardEmotion').textContent = emotionIcon;
    
    // 短内容直接显示，长内容等AI摘要
    const contentEl = document.getElementById('cardContent');
    if (content.length <= 80) {
        contentEl.textContent = content;
    } else {
        contentEl.textContent = "正在生成摘要...";
    }
    
    // 获取AI评价和摘要
    const aiQuoteEl = document.getElementById('cardAIQuote');
    aiQuoteEl.textContent = "...";
    
    modal.classList.add('show');
    
    try {
        const response = await fetch('/api/memories/ai-quote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: content,
                days_ago: daysDiff,
                emotion: memory.emotion
            })
        });
        
        const result = await response.json();
        if (result.success) {
            // 如果是长内容，显示AI生成的摘要
            if (content.length > 80) {
                contentEl.textContent = result.data.summary || content.substring(0, 80) + '...';
            }
            aiQuoteEl.textContent = result.data.quote || "这个细节我还记得。";
        } else {
            contentEl.textContent = content.length > 80 ? content.substring(0, 80) + '...' : content;
            aiQuoteEl.textContent = "这个细节我还记得。";
        }
    } catch (error) {
        console.error('获取AI评价失败:', error);
        contentEl.textContent = content.length > 80 ? content.substring(0, 80) + '...' : content;
        aiQuoteEl.textContent = "挺好的。";
    }
}

// 关闭记忆卡片模态框
function closeMemoryCardModal() {
    const modal = document.getElementById('memoryCardModal');
    modal.classList.remove('show');
}

// 下载记忆卡片
async function downloadMemoryCard() {
    const exportCard = document.getElementById('memoryCardExport');
    
    // 使用html2canvas库导出图片
    if (typeof html2canvas === 'undefined') {
        // 动态加载html2canvas
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    
    try {
        showToast('正在生成卡片...', 'info');
        
        const canvas = await html2canvas(exportCard, {
            scale: 3,
            backgroundColor: '#f5f0e6',
            logging: false,
            useCORS: true,
            allowTaint: false,
            foreignObjectRendering: false,
            onclone: (clonedDoc) => {
                const clonedCard = clonedDoc.getElementById('memoryCardExport');
                if (clonedCard) {
                    clonedCard.style.transform = 'none';
                    clonedCard.style.height = 'auto';
                    clonedCard.style.boxShadow = 'none';
                }
            }
        });
        
        // 下载图片
        const link = document.createElement('a');
        link.download = `liora-memory-${Date.now()}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        showToast('卡片已保存', 'success');
    } catch (error) {
        console.error('导出卡片失败:', error);
        showToast('导出失败，请重试', 'error');
    }
}

// 动态加载外部脚本
function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

async function loadTimeTravelMemories() {
    const listEl = document.getElementById('timetravelList');
    const emptyEl = document.getElementById('timetravelEmpty');
    const quoteEl = document.getElementById('timetravelQuote');
    const dateEl = document.getElementById('timetravelDate');
    
    if (!listEl) return;
    
    // 显示加载状态
    listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">加载中...</div>';
    
    try {
        const response = await fetch('/api/memories/on-this-day');
        const result = await response.json();
        
        if (result.success) {
            const data = result.data;
            
            // 更新日期和感悟
            if (dateEl) dateEl.textContent = data.today;
            if (quoteEl) quoteEl.textContent = data.quote;
            
            if (data.memories.length === 0) {
                listEl.style.display = 'none';
                if (emptyEl) emptyEl.style.display = 'block';
            } else {
                listEl.style.display = 'flex';
                if (emptyEl) emptyEl.style.display = 'none';
                
                // 渲染记忆列表
                listEl.innerHTML = data.memories.map(item => {
                    const memory = item.memory;
                    const content = memory.understanding?.description || memory.content || '';
                    const emotion = memory.emotion;
                    const emotionIcon = emotion ? getEmotionIcon(emotion.valence) : '';
                    const emotionLabel = emotion?.label || '';
                    
                    // 优化时间显示
                    let timeDisplay;
                    if (data.has_on_this_day) {
                        // 往年今日显示相对时间
                        timeDisplay = formatTimeAgo(item.days_diff);
                    } else {
                        // 随机记忆显示具体日期
                        timeDisplay = item.date;
                    }
                    
                    return `
                        <div class="timetravel-item">
                            <div class="timetravel-year">
                                ${timeDisplay}
                                <button class="btn-card-share" onclick="event.stopPropagation(); showMemoryCard('${memory.id}', ${item.days_diff})" title="生成精美卡片">
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                        <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                        <polyline points="21 15 16 10 5 21"></polyline>
                                    </svg>
                                    分享卡片
                                </button>
                            </div>
                            <div class="timetravel-content" onclick="viewMemory('${memory.id}')">${content.substring(0, 120)}${content.length > 120 ? '...' : ''}</div>
                            <div class="timetravel-meta" onclick="viewMemory('${memory.id}')">
                                <span class="timetravel-emotion">${emotionIcon}</span>
                                ${emotionLabel ? `<span>${emotionLabel}</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        } else {
            listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">加载失败</div>';
        }
    } catch (error) {
        console.error('加载往年今日记忆失败:', error);
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #999;">加载失败</div>';
    }
}

// ==================== 记忆录入 ====================

// 内容输入处理
function onContentInput(textarea) {
    // 字数统计
    const count = textarea.value.length;
    document.getElementById('charCount').textContent = count + ' 字';
    
    // 检测 @ / # 触发
    checkForMentions(textarea);
}

function onContentKeydown(event, textarea) {
    const popup = document.getElementById('mentionPopup');
    if (!popup.classList.contains('show')) return;
    
    const items = popup.querySelectorAll('.mention-item');
    let selected = popup.querySelector('.mention-item.selected');
    
    switch(event.key) {
        case 'ArrowDown':
            event.preventDefault();
            if (!selected) {
                items[0]?.classList.add('selected');
            } else {
                selected.classList.remove('selected');
                const next = selected.nextElementSibling;
                if (next) next.classList.add('selected');
                else items[0]?.classList.add('selected');
            }
            break;
        case 'ArrowUp':
            event.preventDefault();
            if (!selected) {
                items[items.length - 1]?.classList.add('selected');
            } else {
                selected.classList.remove('selected');
                const prev = selected.previousElementSibling;
                if (prev) prev.classList.add('selected');
                else items[items.length - 1]?.classList.add('selected');
            }
            break;
        case 'Enter':
        case 'Tab':
            if (selected) {
                event.preventDefault();
                insertMention(textarea, selected.textContent);
            }
            break;
        case 'Escape':
            popup.classList.remove('show');
            break;
    }
}

// 检测并显示提示
function checkForMentions(textarea) {
    const popup = document.getElementById('mentionPopup');
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPosition);
    
    // 匹配 @ 或 # 后面的文字
    const mentionMatch = textBeforeCursor.match(/[@#](\w*)$/);
    
    if (mentionMatch) {
        const trigger = mentionMatch[0][0]; // @ 或 #
        const query = mentionMatch[1].toLowerCase();
        
        // 获取建议列表
        let suggestions = [];
        if (trigger === '@' && graphData.nodes) {
            // 提示人物节点
            suggestions = graphData.nodes
                .filter(n => n.type === 'PERSON' && n.name.toLowerCase().includes(query))
                .map(n => n.name)
                .slice(0, 5);
        } else if (trigger === '#') {
            // 常见主题
            const commonTopics = ['工作', '学习', '生活', '旅行', '阅读', '思考', '灵感'];
            suggestions = commonTopics.filter(t => t.toLowerCase().includes(query));
        }
        
        if (suggestions.length > 0) {
            popup.innerHTML = suggestions.map(s => 
                `<div class="mention-item" onclick="insertMention(document.getElementById('memoryContent'), '${s}')">${s}</div>`
            ).join('');
            popup.classList.add('show');
        } else {
            popup.classList.remove('show');
        }
    } else {
        popup.classList.remove('show');
    }
}

// 插入提取
function insertMention(textarea, value) {
    const cursorPosition = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPosition);
    const textAfterCursor = textarea.value.substring(cursorPosition);
    
    // 替换 @ 或 # 及其后的文字
    const newTextBefore = textBeforeCursor.replace(/[@#]\w*$/, '@' + value + ' ');
    
    textarea.value = newTextBefore + textAfterCursor;
    textarea.focus();
    textarea.setSelectionRange(newTextBefore.length, newTextBefore.length);
    
    document.getElementById('mentionPopup').classList.remove('show');
    onContentInput(textarea);
}

function detectFileType(file) {
    const ext = file.name.toLowerCase().split('.').pop();
    const mime = file.type;

    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
        return 'image';
    }
    if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'].includes(ext)) {
        return 'audio';
    }
    if (mime.startsWith('video/') || ['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv'].includes(ext)) {
        return 'video';
    }
    return 'text';
}

function onFileSelect(event) {
    const file = event.target.files[0];
    const hint = document.getElementById('fileTypeHint');
    const preview = document.getElementById('filePreview');
    const contentArea = document.getElementById('memoryContent');

    if (file) {
        const type = detectFileType(file);
        const typeNames = { text: '文字', image: '图片', audio: '音频', video: '视频' };
        hint.textContent = `（自动识别为${typeNames[type]}）`;
        preview.textContent = `已选择: ${file.name} (${formatFileSize(file.size)})`;
        preview.style.display = 'block';

        // 图片或音频文件：预处理提取描述内容
        if (type === 'image' || type === 'audio') {
            hint.textContent = `（自动识别为${typeNames[type]}，正在提取内容...）`;
            const formData = new FormData();
            formData.append('file', file);

            fetch('/api/memory/preprocess', {
                method: 'POST',
                body: formData
            })
            .then(res => res.json())
            .then(data => {
                if (data.success && data.data.content) {
                    contentArea.value = data.data.content;
                    onContentInput(contentArea);
                    hint.textContent = `（自动识别为${typeNames[type]}，已提取内容）`;
                } else {
                    hint.textContent = `（自动识别为${typeNames[type]}）`;
                    showToast('内容提取失败，请手动输入描述', 'warning');
                }
            })
            .catch(err => {
                console.error('预处理失败:', err);
                hint.textContent = `（自动识别为${typeNames[type]}）`;
                showToast('内容提取失败，请手动输入描述', 'warning');
            });
        }
    } else {
        hint.textContent = '';
        preview.style.display = 'none';
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showStatus(message, type) {
    const statusEl = document.getElementById('statusMessage');
    statusEl.textContent = message;
    statusEl.className = `status-message show ${type}`;

    if (type === 'completed' || type === 'error') {
        setTimeout(() => {
            statusEl.classList.remove('show');
        }, 3000);
    }
}

async function submitMemory(event) {
    event.preventDefault();

    const content = document.getElementById('memoryContent').value.trim();
    const fileInput = document.getElementById('memoryFile');
    const submitBtn = document.getElementById('submitBtn');

    if (!content && !fileInput.files[0]) {
        showToast('请填写内容或上传文件', 'error');
        return;
    }

    // 自动识别记忆类型
    let type = 'text';
    if (fileInput.files[0]) {
        type = detectFileType(fileInput.files[0]);
    }

    // 禁用按钮
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading"></span>保存中...';

    try {
        // 使用客户端服务创建记忆（数据存储在 IndexedDB）
        const result = await memoryService.createMemory({
            content: content,
            type: type,
            file: fileInput.files[0] || null
        });

        if (result.success) {
            showToast('记忆保存成功！', 'success');

            // 清空表单
            document.getElementById('memoryForm').reset();
            document.getElementById('filePreview').style.display = 'none';
            document.getElementById('fileTypeHint').textContent = '';
            document.getElementById('charCount').textContent = '0 字';

            // 刷新图谱和列表
            loadGraphData();
            loadMemories();
            loadStats();
        } else {
            showToast(result.error || '保存失败', 'error');
        }
    } catch (error) {
        console.error('保存记忆失败:', error);
        showToast('保存失败，请检查网络', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '保存记忆';
    }
}

// ==================== 记忆搜索 ====================

async function searchMemories() {
    const query = document.getElementById('searchInput').value.trim();

    if (!query) {
        loadMemories();
        highlightedNodeIds.clear();
        highlightedPath = null;
        updateGraphStyles();
        return;
    }

    try {
        // 使用客户端搜索
        const result = await memoryService.searchMemories(query, { limit: 20, useVector: true });

        if (result.success) {
            // 先高亮节点（记忆 + 图谱节点）
            const matchedNodes = []; // 客户端搜索暂不返回节点
            highlightSearchResults(result.results, matchedNodes);
            // 再切换标签页（跳过自动加载，因为已有数据）
            switchTab('memories', null, true);

            // 构造兼容格式
            const compatResult = {
                success: true,
                results: result.results.map(r => r.memory),
                matched_nodes: matchedNodes,
                match_types: result.results.map(r => r.match_type),
                scores: result.results.map(r => ({ combined: r.score, vector: r.score, keyword: 0 })),
                search_info: {
                    vector_enabled: vectorSearch && vectorSearch.getVectorCount() > 0,
                    keyword_enabled: true,
                    total_results: result.results.length
                }
            };
            renderSearchResults(compatResult, query);
        } else {
            showToast(result.error || '搜索失败', 'error');
        }
    } catch (error) {
        console.error('搜索失败:', error);
        showToast('搜索失败，请检查网络', 'error');
    }
}

// 渲染搜索结果（带调试信息）
function renderSearchResults(result, query) {
    const listEl = document.getElementById('memoryList');
    const memories = result.results || [];
    const matchedNodes = result.matched_nodes || [];
    const matchTypes = result.match_types || [];
    const scores = result.scores || [];
    const searchInfo = result.search_info || {};

    if (memories.length === 0 && matchedNodes.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #666;">
                <div>未找到与 "${query}" 相关的记忆或节点</div>
                <div style="font-size: 11px; margin-top: 8px; color: #999;">
                    向量搜索: ${searchInfo.vector_enabled ? '✓' : '✗'} | 
                    关键词搜索: ${searchInfo.keyword_enabled ? '✓' : '✗'}
                </div>
            </div>
        `;
        return;
    }

    // 构建搜索信息提示
    let searchInfoHtml = '';
    if (searchInfo.vector_enabled && searchInfo.keyword_enabled) {
        searchInfoHtml = `<span style="color: #4a6741;">✓ 向量+关键词混合搜索</span>`;
    } else if (searchInfo.vector_enabled) {
        searchInfoHtml = `<span style="color: #f39c12;">⚠ 仅向量搜索</span>`;
    } else if (searchInfo.keyword_enabled) {
        searchInfoHtml = `<span style="color: #f39c12;">⚠ 仅关键词搜索</span>`;
    } else {
        searchInfoHtml = `<span style="color: #e74c3c;">✗ 搜索服务异常</span>`;
    }

    let html = `
        <div style="padding: 10px 12px; background: #f8f8f8; border-radius: 6px; margin-bottom: 12px; font-size: 12px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>找到 ${memories.length} 个记忆${matchedNodes.length > 0 ? '，' + matchedNodes.length + ' 个节点' : ''}</span>
                <span>${searchInfoHtml}</span>
            </div>
        </div>
    `;
    
    // 显示匹配的图谱节点
    if (matchedNodes.length > 0) {
        html += `<div style="margin-bottom: 12px;">`;
        matchedNodes.forEach(node => {
            html += `
                <div class="memory-item" style="border-left: 3px solid #8b7355; background: #faf8f5;" onclick="focusNodeById('${node.id}')">
                    <div class="memory-item-header">
                        <span class="memory-type" style="background: transparent; border: 1px solid #8b7355; color: #8b7355;">节点</span>
                        <span style="font-weight: 500; color: #4a3c2e;">${node.name}</span>
                        <span style="margin-left: auto; color: #999; font-size: 11px;">${node.type}</span>
                    </div>
                    ${node.description ? `<div class="memory-content" style="font-size: 12px; color: #666;">${node.description}</div>` : ''}
                </div>
            `;
        });
        html += `</div>`;
    }

    html += memories.map((memory, idx) => {
        const typeLabels = {
            'text': '文字',
            'image': '图片',
            'audio': '音频'
        };

        const matchType = matchTypes[idx] || 'unknown';
        const score = scores[idx] || {};

        // 匹配类型标签
        let matchBadge = '';
        if (matchType === 'vector' || matchType === 'both') {
            matchBadge += `<span style="background: #e3f2fd; color: #1976d2; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-right: 4px;">向量</span>`;
        }
        if (matchType === 'keyword' || matchType === 'both') {
            matchBadge += `<span style="background: #f3e5f5; color: #7b1fa2; padding: 2px 6px; border-radius: 4px; font-size: 10px;">关键词</span>`;
        }

        const date = new Date(memory.created_at).toLocaleString('zh-CN');
        const content = memory.understanding?.description || memory.content || '无内容';
        const entities = memory.entities || [];

        return `
            <div class="memory-item">
                <button class="memory-delete-btn" onclick="confirmDeleteMemory(event, '${memory.id}')" title="删除记忆">×</button>
                <div class="memory-item-header" onclick="viewMemory('${memory.id}')">
                    <span class="memory-type">${typeLabels[memory.type] || memory.type}</span>
                    <span class="memory-date">${date}</span>
                    <span style="margin-left: auto;">${matchBadge}</span>
                </div>
                <div class="memory-content" onclick="viewMemory('${memory.id}')">${content}</div>
                <div class="memory-entities" onclick="viewMemory('${memory.id}')">
                    ${entities.slice(0, 3).map(e => `<span class="entity-tag">${e.name}</span>`).join('')}
                    ${entities.length > 3 ? `<span class="entity-tag">+${entities.length - 3}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');

    listEl.innerHTML = html;
}

// 根据记忆结果高亮图谱节点
function highlightNodesFromMemories(memories) {
    highlightedNodeIds.clear();

    // 从所有记忆中收集实体ID
    memories.forEach(memory => {
        const entities = memory.entities || [];
        entities.forEach(entity => {
            if (entity.id) {
                highlightedNodeIds.add(entity.id);
            }
        });
    });

    // 如果图谱已加载，更新样式以应用高亮（不重新渲染）
    if (graphData.nodes && graphData.nodes.length > 0) {
        updateGraphStyles();
        // 聚焦到高亮节点
        focusOnHighlightedNodes();
    }
}

// 根据搜索结果高亮节点（记忆 + 图谱节点）
function highlightSearchResults(memories, matchedNodes) {
    highlightedNodeIds.clear();
    console.log('[搜索高亮] 开始处理，记忆数量:', memories?.length, '节点数量:', matchedNodes?.length);

    // 从记忆中收集实体ID
    if (memories) {
        memories.forEach(memory => {
            const entities = memory.entities || [];
            entities.forEach(entity => {
                if (entity.id) {
                    highlightedNodeIds.add(entity.id);
                    console.log('[搜索高亮] 从记忆添加:', entity.id);
                }
            });
        });
    }
    
    // 从匹配的图谱节点添加
    if (matchedNodes) {
        matchedNodes.forEach(node => {
            if (node.id) {
                highlightedNodeIds.add(node.id);
                console.log('[搜索高亮] 从节点匹配添加:', node.id, node.name);
            }
        });
    }
    
    console.log('[搜索高亮] 总共高亮节点数:', highlightedNodeIds.size);

    // 如果图谱已加载，更新样式并聚焦
    if (graphData.nodes && graphData.nodes.length > 0) {
        updateGraphStyles();
        // 延迟聚焦，等待渲染完成
        setTimeout(focusOnHighlightedNodes, 500);
    }
}

// 通过ID聚焦到特定节点
function focusNodeById(nodeId) {
    console.log('[聚焦] 点击节点:', nodeId);
    if (!graphData || !graphData.nodes) return;
    
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) {
        console.log('[聚焦] 节点未找到:', nodeId);
        return;
    }
    
    // 高亮该节点
    highlightedNodeIds.clear();
    highlightedNodeIds.add(nodeId);
    updateGraphStyles();
    
    // 显示详情
    showNodeDetail(node);
    
    // 聚焦到节点
    if (node.x !== undefined && node.y !== undefined) {
        const svg = d3.select('#graph-svg');
        if (svg.empty()) return;
        
        const container = svg.node().parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(1.2)
            .translate(-node.x, -node.y);
        
        svg.transition()
            .duration(750)
            .ease(d3.easeCubicOut)
            .call(graphZoom.transform, transform);
        
        console.log('[聚焦] 已聚焦到节点:', node.name);
    }
}

// 聚焦到高亮节点中心
function focusOnHighlightedNodes() {
    console.log('[聚焦] focusOnHighlightedNodes 被调用', {
        highlightedCount: highlightedNodeIds?.size,
        graphDataExists: !!graphData,
        nodesCount: graphData?.nodes?.length,
        graphZoomExists: !!graphZoom
    });
    
    if (!highlightedNodeIds || highlightedNodeIds.size === 0) {
        console.log('[聚焦] 无高亮节点，跳过');
        return;
    }
    if (!graphData || !graphData.nodes) {
        console.log('[聚焦] 无图谱数据，跳过');
        return;
    }
    if (!graphZoom) {
        console.log('[聚焦] graphZoom 未初始化，跳过');
        return;
    }
    
    // 延迟执行，确保力导向模拟稳定
    setTimeout(() => {
        // 获取高亮节点的坐标
        const highlightedNodes = graphData.nodes.filter(n => highlightedNodeIds.has(n.id));
        console.log('[聚焦] 找到高亮节点:', highlightedNodes.length, highlightedNodes.map(n => n.name));
        
        if (highlightedNodes.length === 0) {
            console.log('[聚焦] 高亮节点未在 graphData 中找到');
            return;
        }
        
        // 计算边界框
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        let validCount = 0;
        highlightedNodes.forEach(node => {
            console.log('[聚焦] 检查节点坐标:', node.name, { x: node.x, y: node.y });
            if (node.x !== undefined && node.y !== undefined && !isNaN(node.x) && !isNaN(node.y)) {
                minX = Math.min(minX, node.x);
                maxX = Math.max(maxX, node.x);
                minY = Math.min(minY, node.y);
                maxY = Math.max(maxY, node.y);
                validCount++;
            }
        });
        
        // 如果没有有效坐标，跳过
        if (validCount === 0) {
            console.log('[聚焦] 无有效坐标，跳过');
            return;
        }
        
        // 计算中心点和合适的缩放级别
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const bboxWidth = Math.max(maxX - minX + 200, 300); // 添加边距，最小 300
        const bboxHeight = Math.max(maxY - minY + 200, 300);
        
        const svg = d3.select('#graph-svg');
        if (svg.empty()) {
            console.log('[聚焦] SVG 不存在');
            return;
        }
        
        const container = svg.node().parentElement;
        const width = container.clientWidth;
        const height = container.clientHeight;
        
        // 计算合适的缩放级别（使所有高亮节点都在视野内）
        const scaleX = width / bboxWidth;
        const scaleY = height / bboxHeight;
        const scale = Math.min(scaleX, scaleY, 1.5); // 最大缩放 1.5 倍
        const clampedScale = Math.max(0.3, Math.min(scale, 2)); // 限制在 0.3-2 之间
        
        console.log('[聚焦] 计算参数:', { centerX, centerY, bboxWidth, bboxHeight, scale: clampedScale });
        
        // 计算 transform
        const transform = d3.zoomIdentity
            .translate(width / 2, height / 2)
            .scale(clampedScale)
            .translate(-centerX, -centerY);
        
        console.log('[聚焦] 应用 transform:', transform);
        
        // 应用平滑过渡动画
        svg.transition()
            .duration(750)
            .ease(d3.easeCubicOut)
            .call(graphZoom.transform, transform);
        
        console.log(`[聚焦] ✅ 已居中 ${validCount} 个节点，缩放: ${clampedScale.toFixed(2)}`);
    }, 800); // 800ms 延迟，等待力导向模拟稳定
}

// ==================== 记忆列表 ====================

async function loadMemories() {
    try {
        // 从 IndexedDB 加载记忆
        const memories = await db.getAllMemories();

        // 按时间排序（最新的在前）
        memories.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        originalMemories = memories; // 保存原始完整列表
        renderMemoryList(memories);
    } catch (error) {
        console.error('加载记忆失败:', error);
    }
}

// 全局存储记忆列表用于搜索
let allMemories = [];
let originalMemories = []; // 保存原始完整列表，用于搜索恢复

function renderMemoryList(memories) {
    const listEl = document.getElementById('memoryList');
    allMemories = memories; // 保存原始列表

    if (memories.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">暂无记忆</div>';
        return;
    }

    // 按时间分组
    const groups = groupMemoriesByDate(memories);
    
    listEl.innerHTML = groups.map(group => `
        <div class="memory-group">
            <div class="memory-group-title">${group.title}</div>
            ${group.memories.map(memory => renderMemoryItem(memory)).join('')}
        </div>
    `).join('');
}

// 按日期分组
function groupMemoriesByDate(memories) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    const groups = {
        'today': { title: '今天', memories: [] },
        'yesterday': { title: '昨天', memories: [] },
        'week': { title: '本周', memories: [] },
        'month': { title: '本月', memories: [] },
        'earlier': { title: '更早', memories: [] }
    };
    
    memories.forEach(memory => {
        const date = new Date(memory.created_at);
        const memoryDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        
        if (memoryDay.getTime() === today.getTime()) {
            groups.today.memories.push(memory);
        } else if (memoryDay.getTime() === yesterday.getTime()) {
            groups.yesterday.memories.push(memory);
        } else if (date > new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
            groups.week.memories.push(memory);
        } else if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
            groups.month.memories.push(memory);
        } else {
            groups.earlier.memories.push(memory);
        }
    });
    
    // 返回非空组
    return Object.values(groups).filter(g => g.memories.length > 0);
}

// 渲染单个记忆项
function renderMemoryItem(memory) {
    const typeLabels = {
        'text': '文字',
        'image': '图片',
        'audio': '音频'
    };

    const date = new Date(memory.created_at);
    const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const content = memory.understanding?.description || memory.content || '无内容';
    const entities = memory.entities || [];
    
    // 情感颜色
    const emotion = memory.emotion || {};
    const emotionColor = getEmotionColor(emotion.valence);

    return `
        <div class="memory-item">
            <button class="memory-delete-btn" onclick="confirmDeleteMemory(event, '${memory.id}')" title="删除记忆">×</button>
            <div class="memory-item-header" onclick="viewMemory('${memory.id}')">
                <span class="memory-type">${typeLabels[memory.type] || memory.type}</span>
                <span class="memory-date">${timeStr}</span>
            </div>
            <div class="memory-content" onclick="viewMemory('${memory.id}')">${content}</div>
            <div class="memory-entities">
                ${entities.slice(0, 3).map(e => `<span class="entity-tag" onclick="event.stopPropagation(); jumpToEntity(event, '${e.name}')">${e.name}</span>`).join('')}
                ${entities.length > 3 ? `<span class="entity-tag" onclick="event.stopPropagation()">+${entities.length - 3}</span>` : ''}
                ${emotion.dominant_emotion ? `<span class="entity-tag" style="border-color: ${emotionColor}; color: ${emotionColor};" onclick="event.stopPropagation()">${emotion.dominant_emotion}</span>` : ''}
            </div>
        </div>
    `;
}

// 根据情感值获取颜色
function getEmotionColor(valence) {
    if (valence === undefined) return '#999';
    if (valence > 0.3) return '#27ae60'; // 积极 - 绿
    if (valence < -0.3) return '#e74c3c'; // 消极 - 红
    return '#f39c12'; // 中性 - 黄
}

// 搜索记忆
function filterMemories(query) {
    if (!query.trim()) {
        renderMemoryList(originalMemories);
        return;
    }
    
    const filtered = originalMemories.filter(m => {
        const content = m.understanding?.description || m.content || '';
        const entities = (m.entities || []).map(e => e.name).join(' ');
        const searchText = (content + ' ' + entities).toLowerCase();
        return searchText.includes(query.toLowerCase());
    });
    
    renderMemoryList(filtered);
}

// 清除搜索
function clearMemorySearch() {
    document.getElementById('memorySearchInput').value = '';
    renderMemoryList(originalMemories);
}

async function viewMemory(memoryId) {
    try {
        const response = await fetch(`/api/memory/${memoryId}`);
        const result = await response.json();

        if (result.success) {
            showMemoryModal(result.data);
        }
    } catch (error) {
        console.error('获取记忆详情失败:', error);
    }
}

// 显示记忆详情弹窗
function showMemoryModal(memory) {
    const modal = document.getElementById('memoryModal');
    const body = document.getElementById('memoryModalBody');
    
    const typeLabels = {
        'text': '文字',
        'image': '图片',
        'audio': '音频'
    };
    
    const date = new Date(memory.created_at).toLocaleString('zh-CN');
    const content = memory.content || '无内容';
    const understanding = memory.understanding || {};
    const entities = memory.entities || [];
    const emotion = memory.emotion || {};
    
    // 情感颜色
    const emotionColor = getEmotionColor(emotion.valence);
    
    body.innerHTML = `
        <div class="memory-modal-meta">
            <span>${typeLabels[memory.type] || memory.type}</span>
            <span>${date}</span>
        </div>
        
        <div class="memory-modal-content-text">${content}</div>
        
        ${understanding.summary ? `
            <div class="memory-modal-section">
                <div class="memory-modal-section-title">摘要</div>
                <div>${understanding.summary}</div>
            </div>
        ` : ''}
        
        ${understanding.keywords?.length ? `
            <div class="memory-modal-section">
                <div class="memory-modal-section-title">关键词</div>
                <div class="memory-modal-entities">
                    ${understanding.keywords.map(k => `<span class="entity-tag">${k}</span>`).join('')}
                </div>
            </div>
        ` : ''}
        
        ${entities.length ? `
            <div class="memory-modal-section">
                <div class="memory-modal-section-title">识别实体 (${entities.length})</div>
                <div class="memory-modal-entities">
                    ${entities.map(e => `<span class="entity-tag" onclick="jumpToEntity(event, '${e.name}'); closeMemoryModal();">${e.name} (${e.type})</span>`).join('')}
                </div>
            </div>
        ` : ''}
        
        ${emotion.dominant_emotion ? `
            <div class="memory-modal-section">
                <div class="memory-modal-section-title">情感</div>
                <div class="memory-modal-emotion">
                    <span class="emotion-indicator" style="background: ${emotionColor};"></span>
                    <span>${emotion.dominant_emotion}</span>
                </div>
            </div>
        ` : ''}
    `;
    
    modal.classList.add('show');
}

// 关闭记忆弹窗
function closeMemoryModal() {
    const modal = document.getElementById('memoryModal');
    modal.classList.remove('show');
}

// 跳转到实体
function jumpToEntity(event, entityName) {
    event.stopPropagation();
    
    // 在图谱中查找实体
    const node = graphData.nodes.find(n => n.name === entityName || (n.aliases && n.aliases.includes(entityName)));
    if (node) {
        // 切换到图谱视图
        closeMemoryModal();
        showNodeDetail(node);
        // 高亮节点
        highlightedNodeIds.add(node.id);
        updateGraphStyles();
    } else {
        showToast('未找到该实体', 'warning');
    }
}

function confirmDeleteMemory(event, memoryId) {
    event.stopPropagation();
    if (confirm('确定删除这条记忆吗？删除后无法恢复。')) {
        deleteMemory(memoryId);
    }
}

async function deleteMemory(memoryId) {
    try {
        const response = await fetch(`/api/memory/${memoryId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (result.success) {
            showToast('记忆已删除', 'success');
            loadMemories();
            loadGraphData();
            loadStats();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除记忆失败:', error);
        showToast('删除失败', 'error');
    }
}

// ==================== 统计信息 ====================

async function loadStats() {
    try {
        // 从 IndexedDB 获取统计数据
        const memoryStats = await memoryService.getStatistics();
        const memories = await db.getAllMemories();

        // 计算今日新增
        const today = new Date().toISOString().split('T')[0];
        let todayCount = 0;
        const dailyStats = {};
        for (let i = 0; i < 30; i++) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            dailyStats[date.toISOString().split('T')[0]] = 0;
        }

        for (const m of memories) {
            const created = m.created_at ? m.created_at.split('T')[0] : null;
            if (created && dailyStats.hasOwnProperty(created)) {
                dailyStats[created]++;
                if (created === today) todayCount++;
            }
        }

        const emotionStats = { positive: 0, neutral: 0, negative: 0 };
        for (const m of memories) {
            const valence = m.emotion?.valence || 0;
            if (valence > 0.3) emotionStats.positive++;
            else if (valence < -0.3) emotionStats.negative++;
            else emotionStats.neutral++;
        }

        // 更新基础指标
        document.getElementById('statMemories').textContent = memoryStats.total_memories;
        document.getElementById('statEntities').textContent = memoryStats.total_entities;
        document.getElementById('statRelations').textContent = 0; // 需要从 relations store 计算

        // 计算今日新增
        document.getElementById('statToday').textContent = todayCount;

        // 渲染记忆热力图
        renderMemoryHeatmap(dailyStats);

        // 渲染实体类型分布
        renderEntityTypeChart(memoryStats.entity_distribution || {});

        // 渲染情感分布
        renderEmotionBars(emotionStats, memoryStats.total_memories);

        // 渲染关系类型
        renderRelationTags({});

    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

// 渲染实体类型图表
function renderEntityTypeChart(entityTypes) {
    const container = document.getElementById('entityTypeChart');
    if (!container) return;

    const typeColors = {
        'PERSON': '#FF6B35',
        'LOCATION': '#004E89',
        'EVENT': '#C5283D',
        'OBJECT': '#1A936F',
        'CONCEPT': '#3498db',
        'EMOTION': '#E9724C',
        'ENTITY': '#95a5a6'
    };

    const typeNames = {
        'PERSON': '人物',
        'LOCATION': '地点',
        'EVENT': '事件',
        'OBJECT': '物品',
        'CONCEPT': '概念',
        'EMOTION': '情感',
        'ENTITY': '其他'
    };

    const total = Object.values(entityTypes).reduce((a, b) => a + b, 0);
    
    if (total === 0) {
        container.innerHTML = '<div class="chart-placeholder">暂无数据</div>';
        return;
    }

    const sortedTypes = Object.entries(entityTypes).sort((a, b) => b[1] - a[1]);
    
    let html = '';
    sortedTypes.forEach(([type, count]) => {
        const percentage = (count / total * 100).toFixed(1);
        const color = typeColors[type] || '#999';
        const name = typeNames[type] || type;
        
        html += `
            <div class="type-bar-item">
                <span class="type-bar-label">${name}</span>
                <div class="type-bar-track">
                    <div class="type-bar-fill" style="width: ${percentage}%; background: ${color};"></div>
                </div>
                <span class="type-bar-count">${count}</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 渲染情感条形图
function renderEmotionBars(emotionStats, total) {
    if (total === 0) return;

    const positive = emotionStats.positive || 0;
    const neutral = emotionStats.neutral || 0;
    const negative = emotionStats.negative || 0;

    const positivePct = (positive / total * 100).toFixed(1);
    const neutralPct = (neutral / total * 100).toFixed(1);
    const negativePct = (negative / total * 100).toFixed(1);

    const posFill = document.getElementById('emotionPositive');
    const neuFill = document.getElementById('emotionNeutral');
    const negFill = document.getElementById('emotionNegative');
    
    const posCount = document.getElementById('emotionPositiveCount');
    const neuCount = document.getElementById('emotionNeutralCount');
    const negCount = document.getElementById('emotionNegativeCount');

    if (posFill) posFill.style.width = `${positivePct}%`;
    if (neuFill) neuFill.style.width = `${neutralPct}%`;
    if (negFill) negFill.style.width = `${negativePct}%`;

    if (posCount) posCount.textContent = positive;
    if (neuCount) neuCount.textContent = neutral;
    if (negCount) negCount.textContent = negative;
}

// 渲染最活跃实体
function renderTopEntities(topEntities) {
    const container = document.getElementById('topEntities');
    if (!container) return;

    if (!topEntities || topEntities.length === 0) {
        container.innerHTML = '<div class="top-entity-item placeholder">暂无数据</div>';
        return;
    }

    const typeColors = {
        'PERSON': '#FF6B35',
        'LOCATION': '#004E89',
        'EVENT': '#C5283D',
        'OBJECT': '#1A936F',
        'CONCEPT': '#3498db',
        'EMOTION': '#E9724C',
        'ENTITY': '#95a5a6'
    };

    const typeIcons = {
        'PERSON': '人',
        'LOCATION': '地',
        'EVENT': '事',
        'OBJECT': '物',
        'CONCEPT': '念',
        'EMOTION': '情',
        'ENTITY': '实'
    };

    let html = '';
    topEntities.forEach((entity, index) => {
        const color = typeColors[entity.type] || '#999';
        const icon = typeIcons[entity.type] || '实';
        
        html += `
            <div class="top-entity-item">
                <span class="entity-rank">${index + 1}</span>
                <div class="entity-avatar" style="background: ${color};">${icon}</div>
                <span class="entity-name">${entity.name}</span>
                <span class="entity-count">${entity.memory_count} 条</span>
            </div>
        `;
    });
    
    container.innerHTML = html;
}

// 渲染记忆热力图
function renderMemoryHeatmap(dailyStats) {
    const container = document.getElementById('memoryHeatmap');
    if (!container) return;

    // 计算连续记录天数
    let currentStreak = 0;
    let maxStreak = 0;
    let tempStreak = 0;
    let hasToday = false;
    
    const dates = Object.keys(dailyStats).sort();
    const today = new Date().toISOString().split('T')[0];
    
    // 从今天往回数连续天数
    for (let i = dates.length - 1; i >= 0; i--) {
        if (dailyStats[dates[i]] > 0) {
            tempStreak++;
            if (dates[i] === today) hasToday = true;
        } else {
            if (dates[i] < today) break;
        }
    }
    currentStreak = tempStreak;
    
    // 计算最大连续天数
    tempStreak = 0;
    dates.forEach(date => {
        if (dailyStats[date] > 0) {
            tempStreak++;
            maxStreak = Math.max(maxStreak, tempStreak);
        } else {
            tempStreak = 0;
        }
    });

    // 计算有记忆的天数
    const activeDays = Object.values(dailyStats).filter(c => c > 0).length;

    // 更新头部信息
    const totalEl = document.getElementById('heatmapTotal');
    const streakEl = document.getElementById('heatmapStreak');
    if (totalEl) totalEl.textContent = `${activeDays} 天有记忆`;
    if (streakEl) streakEl.textContent = currentStreak > 0 ? `连续记录 ${currentStreak} 天 🔥` : '今天还没记忆哦';

    // 计算每天的强度等级 (0-4)
    const counts = Object.values(dailyStats).filter(c => c > 0);
    const maxCount = counts.length > 0 ? Math.max(...counts) : 1;
    
    const getLevel = (count) => {
        if (count === 0) return 0;
        if (count <= maxCount * 0.25) return 1;
        if (count <= maxCount * 0.5) return 2;
        if (count <= maxCount * 0.75) return 3;
        return 4;
    };

    // 生成热力图 HTML（按周分组，每行代表一天）
    let html = '';
    const days = ['日', '一', '二', '三', '四', '五', '六'];
    
    // 显示最近13周（91天）的数据
    const recentDates = dates.slice(-91);
    
    // 按周分组
    const weeks = [];
    let currentWeek = [];
    
    recentDates.forEach(date => {
        const dayOfWeek = new Date(date).getDay();
        currentWeek.push({ date, dayOfWeek, count: dailyStats[date] });
        if (dayOfWeek === 6 || date === recentDates[recentDates.length - 1]) {
            weeks.push(currentWeek);
            currentWeek = [];
        }
    });

    // 生成每行（每天一行，从周日到周六）
    for (let day = 0; day < 7; day++) {
        html += '<div class="heatmap-row">';
        weeks.forEach(week => {
            const dayData = week.find(d => d.dayOfWeek === day);
            if (dayData) {
                const level = getLevel(dayData.count);
                const dateStr = new Date(dayData.date).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
                const title = dayData.count > 0 ? `${dateStr}: ${dayData.count} 条记忆` : dateStr;
                html += `<div class="heatmap-cell level-${level}" title="${title}"></div>`;
            } else {
                html += '<div class="heatmap-cell level-0"></div>';
            }
        });
        html += '</div>';
    }
    
    container.innerHTML = html;
}

// 渲染关系类型标签
function renderRelationTags(relationTypes) {
    const container = document.getElementById('relationTags');
    if (!container) return;

    const sortedRelations = Object.entries(relationTypes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8); // 只显示前8个

    if (sortedRelations.length === 0) {
        container.innerHTML = '<span class="relation-tag-placeholder">暂无数据</span>';
        return;
    }

    const relationNames = {
        'FRIEND': '朋友',
        'FAMILY': '家人',
        'COLLEAGUE': '同事',
        'PARTNER': '伴侣',
        'WORK_AT': '工作于',
        'LIVE_IN': '居住在',
        'BORN_IN': '出生在',
        'STUDY_AT': '就读于',
        'PARTICIPATE': '参与',
        'ORGANIZE': '组织',
        'RELATED': '相关'
    };

    let html = '';
    sortedRelations.forEach(([type, count]) => {
        const name = relationNames[type] || type;
        html += `
            <span class="relation-tag">
                ${name}
                <span class="relation-tag-count">${count}</span>
            </span>
        `;
    });
    
    container.innerHTML = html;
}

// ==================== 知识图谱 D3.js 增强版 ====================

let graphInitialized = false;

function initGraph() {
    if (graphInitialized) return; // 确保只初始化一次
    
    const svg = d3.select('#graph-svg');
    if (svg.empty()) return;
    
    const container = svg.node().parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.attr('width', width).attr('height', height)
       .attr('viewBox', `0 0 ${width} ${height}`);

    // 创建缩放行为
    graphZoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            const g = svg.select('.graph-main-group');
            if (!g.empty()) {
                g.attr('transform', event.transform);
            }
        });

    svg.call(graphZoom);

    // 创建主容器
    const g = svg.append('g');
    g.attr('class', 'graph-main-group');

    // 存储引用
    svg.node().graphG = g;

    graphInitialized = true;
}

async function loadGraphData(entityTypes = null, centerEntity = null) {
    try {
        // 从 IndexedDB 加载图谱数据
        const result = await db.getGraphData({
            entity_types: entityTypes && entityTypes !== 'all' ? entityTypes.split(',') : null,
            center_entity: centerEntity || null,
            max_nodes: 0  // 0 表示不限制
        });

        graphData = result;
        renderGraph();
        updateLegend();
        // 如果有高亮节点，聚焦到它们
        if (highlightedNodeIds && highlightedNodeIds.size > 0) {
            setTimeout(focusOnHighlightedNodes, 1000);
        }
    } catch (error) {
        console.error('加载图谱数据失败:', error);
    }
}

// 图例折叠状态
let legendCollapsed = false;
let legendExpandedSections = { nodes: false, edges: false };

function toggleLegend() {
    const legendEl = document.getElementById('graphLegend');
    legendCollapsed = !legendCollapsed;
    legendEl.classList.toggle('collapsed', legendCollapsed);
}

function toggleLegendSection(section) {
    legendExpandedSections[section] = !legendExpandedSections[section];
    updateLegend();
}

function updateLegend() {
    const legendEl = document.getElementById('graphLegend');
    const legendItems = document.getElementById('legendItems');

    if ((!graphData.nodes || graphData.nodes.length === 0) && (!graphData.edges || graphData.edges.length === 0)) {
        legendEl.style.display = 'none';
        return;
    }

    let html = '';

    // 统计实体类型
    if (graphData.nodes && graphData.nodes.length > 0) {
        const typeCount = {};
        graphData.nodes.forEach(node => {
            const type = node.type || 'Entity';
            typeCount[type] = (typeCount[type] || 0) + 1;
        });

        // 按数量排序
        const sortedTypes = Object.entries(typeCount).sort((a, b) => b[1] - a[1]);
        
        const MAX_SHOWN = 6;
        const showAll = legendExpandedSections.nodes;
        const typesToShow = showAll ? sortedTypes : sortedTypes.slice(0, MAX_SHOWN);
        const hasMore = sortedTypes.length > MAX_SHOWN;

        html += '<div class="legend-section">';
        html += `<div class="legend-section-title">
            节点类型
            <span class="legend-section-count">${sortedTypes.length}种</span>
        </div>`;
        
        typesToShow.forEach(([type, count]) => {
            html += `
                <div class="legend-item">
                    <span class="legend-dot" style="background: ${colorMap[type] || '#999'}"></span>
                    <span class="legend-label">${type} (${count})</span>
                </div>
            `;
        });
        
        if (hasMore && !showAll) {
            html += `<div class="legend-more" onclick="event.stopPropagation(); toggleLegendSection('nodes')">+ ${sortedTypes.length - MAX_SHOWN} 更多...</div>`;
        } else if (hasMore && showAll) {
            html += `<div class="legend-more" onclick="event.stopPropagation(); toggleLegendSection('nodes')">收起</div>`;
        }
        
        html += '</div>';
    }

    // 统计边类型
    if (graphData.edges && graphData.edges.length > 0) {
        const edgeTypeCount = {};
        let selfLoopCount = 0;
        graphData.edges.forEach(edge => {
            const type = edge.type || 'RELATED';
            edgeTypeCount[type] = (edgeTypeCount[type] || 0) + 1;
            if (edge.source === edge.target) {
                selfLoopCount++;
            }
        });

        // 按数量排序
        const sortedEdgeTypes = Object.entries(edgeTypeCount).sort((a, b) => b[1] - a[1]);
        
        const MAX_SHOWN = 6;
        const showAll = legendExpandedSections.edges;
        const typesToShow = showAll ? sortedEdgeTypes : sortedEdgeTypes.slice(0, MAX_SHOWN);
        const hasMore = sortedEdgeTypes.length > MAX_SHOWN;

        html += '<div class="legend-section">';
        html += `<div class="legend-section-title">
            关系类型
            <span class="legend-section-count">${sortedEdgeTypes.length}种</span>
        </div>`;
        
        typesToShow.forEach(([type, count]) => {
            html += `
                <div class="legend-item">
                    <span class="legend-dot" style="background: ${edgeColorMap[type] || '#999'}; width: 8px; height: 3px; border-radius: 2px;"></span>
                    <span class="legend-label">${getRelationTypeName(type)} (${count})</span>
                </div>
            `;
        });
        
        // 自环（如果数量>0）
        if (selfLoopCount > 0 && (showAll || typesToShow.length < MAX_SHOWN)) {
            html += `
                <div class="legend-item">
                    <span class="legend-dot" style="background: #E91E63; width: 8px; height: 3px; border-radius: 2px; border: 1px dashed #E91E63;"></span>
                    <span class="legend-label">自环 (${selfLoopCount})</span>
                </div>
            `;
        }
        
        if (hasMore && !showAll) {
            html += `<div class="legend-more" onclick="event.stopPropagation(); toggleLegendSection('edges')">+ ${sortedEdgeTypes.length - MAX_SHOWN} 更多...</div>`;
        } else if (hasMore && showAll) {
            html += `<div class="legend-more" onclick="event.stopPropagation(); toggleLegendSection('edges')">收起</div>`;
        }
        
        html += '</div>';
    }

    legendItems.innerHTML = html;
    legendEl.style.display = 'block';
}

function renderGraph() {
    const svg = d3.select('#graph-svg');
    if (svg.empty()) return;
    
    const container = svg.node().parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const g = svg.select('.graph-main-group');
    if (g.empty()) return;

    // 清空现有内容
    g.selectAll('*').remove();

    if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
        g.append('text')
            .attr('x', width / 2)
            .attr('y', height / 2)
            .attr('text-anchor', 'middle')
            .attr('fill', '#999')
            .text('暂无数据，请先录入记忆');
        return;
    }

    // 创建节点映射
    const nodeMap = {};
    graphData.nodes.forEach(n => nodeMap[n.id] = n);

    // ========== MiroFish 风格：边数据处理（支持自环和多边形分散）==========
    const edgePairCount = {};      // 统计每对节点间的边数量
    const selfLoopEdges = {};      // 按节点分组的自环边
    const tempEdges = (graphData.edges || [])
        .filter(e => nodeMap[e.source] && nodeMap[e.target]);

    // 统计每对节点之间的边数量，收集自环边
    tempEdges.forEach(e => {
        if (e.source === e.target) {
            // 自环 - 收集到数组中
            if (!selfLoopEdges[e.source]) {
                selfLoopEdges[e.source] = [];
            }
            selfLoopEdges[e.source].push({
                ...e,
                source_name: nodeMap[e.source]?.name,
                target_name: nodeMap[e.target]?.name
            });
        } else {
            const pairKey = [e.source, e.target].sort().join('_');
            edgePairCount[pairKey] = (edgePairCount[pairKey] || 0) + 1;
        }
    });

    // 记录当前处理到每对节点的第几条边
    const edgePairIndex = {};
    const processedSelfLoopNodes = new Set();  // 已处理的自环节点

    const edges = [];

    tempEdges.forEach(e => {
        const isSelfLoop = e.source === e.target;

        if (isSelfLoop) {
            // 自环边 - 每个节点只添加一条合并的自环
            if (processedSelfLoopNodes.has(e.source)) {
                return; // 已处理过，跳过
            }
            processedSelfLoopNodes.add(e.source);

            const allSelfLoops = selfLoopEdges[e.source];
            const nodeName = nodeMap[e.source]?.name || 'Unknown';

            edges.push({
                source: e.source,
                target: e.target,
                type: 'SELF_LOOP',
                name: `自环关系 (${allSelfLoops.length})`,
                curvature: 0,
                isSelfLoop: true,
                rawData: {
                    isSelfLoopGroup: true,
                    source_name: nodeName,
                    target_name: nodeName,
                    selfLoopCount: allSelfLoops.length,
                    selfLoopEdges: allSelfLoops  // 存储所有自环边的详细信息
                }
            });
            return;
        }

        // 普通边 - 多边形分散处理
        const pairKey = [e.source, e.target].sort().join('_');
        const totalCount = edgePairCount[pairKey];
        const currentIndex = edgePairIndex[pairKey] || 0;
        edgePairIndex[pairKey] = currentIndex + 1;

        // 判断边的方向是否与标准化方向一致（源UUID < 目标UUID）
        const isReversed = e.source > e.target;

        // 计算曲率：多条边时分散开
        let curvature = 0;
        if (totalCount > 1) {
            // 均匀分布曲率，边越多曲率范围越大
            const curvatureRange = Math.min(1.2, 0.6 + totalCount * 0.15);
            curvature = ((currentIndex / (totalCount - 1)) - 0.5) * curvatureRange * 2;

            // 如果边的方向与标准化方向相反，翻转曲率
            // 这样确保所有边在同一参考系下分布，不会因方向不同而重叠
            if (isReversed) {
                curvature = -curvature;
            }
        }

        edges.push({
            source: e.source,
            target: e.target,
            type: e.type || 'RELATED',
            name: e.name || e.type || 'RELATED',
            curvature,
            isSelfLoop: false,
            pairIndex: currentIndex,
            pairTotal: totalCount,
            rawData: {
                ...e,
                name: e.name || e.type || 'RELATED',
                source_name: nodeMap[e.source]?.name || e.source,
                target_name: nodeMap[e.target]?.name || e.target
            }
        });
    });

    // 计算节点度数（连接数）- 必须在 D3 修改 edges 之前计算
    const nodeDegree = {};
    edges.forEach(e => {
        const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
        const targetId = typeof e.target === 'object' ? e.target.id : e.target;
        nodeDegree[sourceId] = (nodeDegree[sourceId] || 0) + 1;
        nodeDegree[targetId] = (nodeDegree[targetId] || 0) + 1;
    });

    // 按度数对节点排序，度数高的放在中心附近
    const sortedNodes = [...graphData.nodes].sort((a, b) => {
        const degA = nodeDegree[a.id] || 0;
        const degB = nodeDegree[b.id] || 0;
        return degB - degA;  // 度数高的排前面
    });

    // 初始化节点位置 - 随机分布在中心周围
    const nodes = sortedNodes.map((n, i) => ({
        id: n.id,
        name: n.name || 'Unnamed',
        type: n.type || 'Entity',
        rawData: n,
        x: width / 2 + (Math.random() - 0.5) * width * 0.6,
        y: height / 2 + (Math.random() - 0.5) * height * 0.6
    }));

    // 创建力导向模拟 - MiroFish 风格参数
    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id).distance(d => {
            const edgeCount = d.pairTotal || 1;
            return 150 + (edgeCount - 1) * 50;  // MiroFish: 基础150，每多一条边+50
        }))
        .force('charge', d3.forceManyBody()
            .strength(-400)  // MiroFish: -400
            .distanceMax(800)
        )
        .force('center', d3.forceCenter(width / 2, height / 2).strength(0.04))  // MiroFish: 0.04
        .force('collide', d3.forceCollide()
            .radius(50)  // MiroFish: 50
            .strength(0.8)
            .iterations(3)
        )
        .force('x', d3.forceX(width / 2).strength(0.04))  // MiroFish: 0.04
        .force('y', d3.forceY(height / 2).strength(0.04))  // MiroFish: 0.04
        .alphaDecay(0.02)
        .velocityDecay(0.3);

    // 创建节点映射用于快速查找
    const nodeMapById = {};
    nodes.forEach(n => nodeMapById[n.id] = n);
    
    // 计算曲线路径（支持自环）
    function getLinkPath(d) {
        // 处理 source/target 可能是字符串 ID 的情况
        const sourceNode = typeof d.source === 'object' ? d.source : nodeMapById[d.source];
        const targetNode = typeof d.target === 'object' ? d.target : nodeMapById[d.target];
        
        if (!sourceNode || !targetNode) return '';
        
        const sx = sourceNode.x, sy = sourceNode.y;
        const tx = targetNode.x, ty = targetNode.y;

        // 检测自环
        if (d.isSelfLoop) {
            // 自环：绘制一个圆弧从节点出发再返回
            const loopRadius = 30;
            // 从节点右侧出发，绕一圈回来
            const x1 = sx + 8;  // 起点偏移
            const y1 = sy - 4;
            const x2 = sx + 8;  // 终点偏移
            const y2 = sy + 4;
            // 使用圆弧绘制自环（sweep-flag=1 顺时针）
            return `M${x1},${y1} A${loopRadius},${loopRadius} 0 1,1 ${x2},${y2}`;
        }

        if (d.curvature === 0) {
            return `M${sx},${sy} L${tx},${ty}`;
        }

        // 计算曲线控制点 - 根据边数量和距离动态调整
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        // 垂直于连线方向的偏移，根据距离比例计算，保证曲线明显可见
        const pairTotal = d.pairTotal || 1;
        const offsetRatio = 0.25 + pairTotal * 0.05;  // 基础25%，每多一条边增加5%
        const baseOffset = Math.max(35, dist * offsetRatio);
        const offsetX = -dy / dist * d.curvature * baseOffset;
        const offsetY = dx / dist * d.curvature * baseOffset;
        const cx = (sx + tx) / 2 + offsetX;
        const cy = (sy + ty) / 2 + offsetY;

        return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`;
    }

    // 计算曲线中点（支持自环）
    function getLinkMidpoint(d) {
        // 处理 source/target 可能是字符串 ID 的情况（固定布局）
        const sourceNode = typeof d.source === 'object' ? d.source : nodeMapById[d.source];
        const targetNode = typeof d.target === 'object' ? d.target : nodeMapById[d.target];
        
        if (!sourceNode || !targetNode) return { x: 0, y: 0 };
        
        const sx = sourceNode.x, sy = sourceNode.y;
        const tx = targetNode.x, ty = targetNode.y;

        // 检测自环
        if (d.isSelfLoop) {
            // 自环标签位置：节点右侧
            return { x: sx + 70, y: sy };
        }

        if (d.curvature === 0) {
            return { x: (sx + tx) / 2, y: (sy + ty) / 2 };
        }

        // 二次贝塞尔曲线的中点 t=0.5
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const pairTotal = d.pairTotal || 1;
        const offsetRatio = 0.25 + pairTotal * 0.05;
        const baseOffset = Math.max(35, dist * offsetRatio);
        const offsetX = -dy / dist * d.curvature * baseOffset;
        const offsetY = dx / dist * d.curvature * baseOffset;
        const cx = (sx + tx) / 2 + offsetX;
        const cy = (sy + ty) / 2 + offsetY;

        // 二次贝塞尔曲线公式 B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2, t=0.5
        return {
            x: 0.25 * sx + 0.5 * cx + 0.25 * tx,
            y: 0.25 * sy + 0.5 * cy + 0.25 * ty
        };
    }

    // 边组
    const linkGroup = g.append('g').attr('class', 'links');

    // 绘制边（使用 path 支持曲线和自环）
    const link = linkGroup.selectAll('path')
        .data(edges)
        .enter().append('path')
        .attr('stroke', d => {
            // 路径高亮 - 使用排序后的 ID 匹配
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const edgeKey = [sourceId, targetId].sort().join('_');
            if (highlightedPath?.edgeIds.has(d.id) || highlightedPath?.edgeIds.has(edgeKey)) {
                return '#E91E63';  // 路径边用红色
            }
            if (d.isSelfLoop) return '#E91E63';
            return edgeColorMap[d.type] || '#C0C0C0';
        })
        .attr('stroke-width', d => {
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const edgeKey = [sourceId, targetId].sort().join('_');
            if (highlightedPath?.edgeIds.has(d.id) || highlightedPath?.edgeIds.has(edgeKey)) {
                return 4;  // 路径边加粗
            }
            if (d.isSelfLoop) return 2;
            return 1.5;
        })
        .attr('stroke-dasharray', d => d.isSelfLoop ? '3,2' : 'none')  // 自环用虚线
        .attr('fill', 'none')
        .style('cursor', 'pointer')
        .on('click', (event, d) => {
            event.stopPropagation();
            linkGroup.selectAll('path').attr('stroke', e => e.isSelfLoop ? '#E91E63' : (edgeColorMap[e.type] || '#C0C0C0')).attr('stroke-width', e => e.isSelfLoop ? 2 : 1.5);
            linkLabelBg.attr('fill', 'rgba(255,255,255,0.95)');
            linkLabels.attr('fill', '#666');
            d3.select(event.target).attr('stroke', '#E91E63').attr('stroke-width', 3);
            showEdgeDetail(d.rawData);
        });

    // 边标签背景
    const linkLabelBg = linkGroup.selectAll('rect')
        .data(edges)
        .enter().append('rect')
        .attr('fill', 'rgba(255,255,255,0.95)')
        .attr('rx', 3)
        .attr('ry', 3)
        .style('cursor', 'pointer')
        .style('pointer-events', 'all')
        .style('display', showEdgeLabels ? 'block' : 'none')
        .on('click', (event, d) => {
            event.stopPropagation();
            linkGroup.selectAll('path').attr('stroke', e => e.isSelfLoop ? '#E91E63' : (edgeColorMap[e.type] || '#C0C0C0')).attr('stroke-width', e => e.isSelfLoop ? 2 : 1.5);
            linkLabelBg.attr('fill', 'rgba(255,255,255,0.95)');
            linkLabels.attr('fill', '#666');
            link.filter(l => l === d).attr('stroke', '#E91E63').attr('stroke-width', 3);
            d3.select(event.target).attr('fill', 'rgba(233, 30, 99, 0.1)');
            showEdgeDetail(d.rawData);
        });

    // 边标签
    const linkLabels = linkGroup.selectAll('text')
        .data(edges)
        .enter().append('text')
        .text(d => d.isSelfLoop ? d.name : getRelationTypeName(d.type))
        .attr('font-size', '9px')
        .attr('fill', d => d.isSelfLoop ? '#E91E63' : '#666')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .style('cursor', 'pointer')
        .style('pointer-events', 'all')
        .style('display', showEdgeLabels ? 'block' : 'none')
        .style('font-family', 'system-ui, sans-serif')
        .on('click', (event, d) => {
            event.stopPropagation();
            linkGroup.selectAll('path').attr('stroke', e => e.isSelfLoop ? '#E91E63' : (edgeColorMap[e.type] || '#C0C0C0')).attr('stroke-width', e => e.isSelfLoop ? 2 : 1.5);
            linkLabelBg.attr('fill', 'rgba(255,255,255,0.95)');
            linkLabels.attr('fill', e => e.isSelfLoop ? '#E91E63' : '#666');
            link.filter(l => l === d).attr('stroke', '#E91E63').attr('stroke-width', 3);
            d3.select(event.target).attr('fill', '#E91E63');
            showEdgeDetail(d.rawData);
        });

    linkLabelsRef = linkLabels;
    linkLabelBgRef = linkLabelBg;

    // 节点组
    const nodeGroup = g.append('g').attr('class', 'nodes');

    // 节点圆形
    const node = nodeGroup.selectAll('circle')
        .data(nodes)
        .enter().append('circle')
        .attr('r', d => {
            // 路径高亮优先级最高
            if (highlightedPath?.nodeIds.has(d.id)) return 16;
            if (highlightedNodeIds.has(d.id)) return 14;
            return 10;
        })
        .attr('fill', d => colorMap[d.type] || '#999')
        .attr('stroke', d => {
            if (highlightedPath?.nodeIds.has(d.id)) return '#E91E63';  // 路径节点用红色
            if (highlightedNodeIds.has(d.id)) return '#FFD700';
            return '#fff';
        })
        .attr('stroke-width', d => {
            if (highlightedPath?.nodeIds.has(d.id)) return 5;
            if (highlightedNodeIds.has(d.id)) return 4;
            return 2.5;
        })
        .style('cursor', 'pointer')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended)
        )
        .on('click', (event, d) => {
            event.stopPropagation();
            
            // Shift+点击设置路径终点
            if (event.shiftKey && currentSelectedNode && currentSelectedNode.id !== d.id) {
                pathTargetNode = d.rawData;
                showToast(`已设置终点: ${d.name}，点击"探索关联路径"`, 'info');
                updatePathFinder();
                return;
            }
            
            node.attr('stroke', d => {
                if (highlightedPath?.nodeIds.has(d.id)) return '#E91E63';
                if (highlightedNodeIds.has(d.id)) return '#FFD700';
                return '#fff';
            }).attr('stroke-width', d => {
                if (highlightedPath?.nodeIds.has(d.id)) return 5;
                if (highlightedNodeIds.has(d.id)) return 4;
                return 2.5;
            });
            link.attr('stroke', e => {
                const sId = typeof e.source === 'object' ? e.source.id : e.source;
                const tId = typeof e.target === 'object' ? e.target.id : e.target;
                const edgeKey = [sId, tId].sort().join('_');
                if (highlightedPath?.edgeIds.has(e.id) || highlightedPath?.edgeIds.has(edgeKey)) return '#E91E63';
                if (e.isSelfLoop) return '#E91E63';
                return '#C0C0C0';
            }).attr('stroke-width', e => {
                const sId = typeof e.source === 'object' ? e.source.id : e.source;
                const tId = typeof e.target === 'object' ? e.target.id : e.target;
                const edgeKey = [sId, tId].sort().join('_');
                if (highlightedPath?.edgeIds.has(e.id) || highlightedPath?.edgeIds.has(edgeKey)) return 4;
                if (e.isSelfLoop) return 2;
                return 1.5;
            });
            d3.select(event.target).attr('stroke', '#E91E63').attr('stroke-width', 4);
            link.filter(l => l.source.id === d.id || l.target.id === d.id)
                .attr('stroke', '#E91E63')
                .attr('stroke-width', 2.5);
            showNodeDetail(d.rawData);
            updatePathFinder();
        })
        .on('mouseenter', (event, d) => {
            d3.select(event.target).attr('stroke', '#333').attr('stroke-width', 3);
        })
        .on('mouseleave', (event, d) => {
            const isPathNode = highlightedPath?.nodeIds.has(d.id);
            const isHighlighted = highlightedNodeIds.has(d.id);
            d3.select(event.target)
                .attr('stroke', isPathNode ? '#E91E63' : (isHighlighted ? '#FFD700' : '#fff'))
                .attr('stroke-width', isPathNode ? 5 : (isHighlighted ? 4 : 2.5));
        });

    // 节点标签
    const nodeLabels = nodeGroup.selectAll('text')
        .data(nodes)
        .enter().append('text')
        .text(d => d.name.length > 6 ? d.name.substring(0, 6) + '…' : d.name)  // MiroFish: 6字符截断
        .attr('font-size', d => highlightedNodeIds.has(d.id) ? '13px' : '11px')  // MiroFish: 更小字号
        .attr('fill', d => highlightedNodeIds.has(d.id) ? '#E91E63' : '#555')    // MiroFish: 稍浅颜色
        .attr('font-weight', d => highlightedNodeIds.has(d.id) ? '600' : '400')  // MiroFish: 正常字重
        .attr('dx', 0)      // MiroFish: 标签在节点正下方
        .attr('dy', 18)     // MiroFish: 垂直偏移
        .attr('text-anchor', 'middle')  // MiroFish: 居中对齐
        .style('pointer-events', 'none')
        .style('font-family', 'system-ui, sans-serif');

    // 更新位置
    simulation.on('tick', () => {
        link.attr('d', d => getLinkPath(d));

        linkLabels.each(function(d) {
            const mid = getLinkMidpoint(d);
            d3.select(this)
                .attr('x', mid.x)
                .attr('y', mid.y)
                .attr('transform', '');  // 移除旋转，保持水平
        });

        linkLabelBg.each(function(d, i) {
            const mid = getLinkMidpoint(d);
            const textEl = linkLabels.nodes()[i];
            if (textEl) {
                const bbox = textEl.getBBox();
                d3.select(this)
                    .attr('x', mid.x - bbox.width / 2 - 4)
                    .attr('y', mid.y - bbox.height / 2 - 2)
                    .attr('width', bbox.width + 8)
                    .attr('height', bbox.height + 4)
                    .attr('transform', '');  // 移除旋转
            }
        });

        node.attr('cx', d => d.x).attr('cy', d => d.y);
        nodeLabels.attr('x', d => d.x).attr('y', d => d.y);
        
        // 同步坐标到 graphData.nodes，供聚焦功能使用
        nodes.forEach(n => {
            if (n.rawData) {
                n.rawData.x = n.x;
                n.rawData.y = n.y;
            }
        });
    });
    
    // 点击空白关闭详情面板
    svg.on('click', () => {
        closeDetailPanel();
        expandedSelfLoops.clear();  // 重置自环展开状态
        highlightedPath = null;  // 清除路径高亮
        node.attr('stroke', d => highlightedNodeIds.has(d.id) ? '#FFD700' : '#fff')
            .attr('stroke-width', d => highlightedNodeIds.has(d.id) ? 4 : 2.5);
        link.attr('stroke', d => {
            if (d.isSelfLoop) return '#E91E63';
            return edgeColorMap[d.type] || '#C0C0C0';
        }).attr('stroke-width', d => d.isSelfLoop ? 2 : 1.5);
        linkLabelBg.attr('fill', 'rgba(255,255,255,0.95)');
        linkLabels.attr('fill', d => d.isSelfLoop ? '#E91E63' : '#666');
    });
}

// 拖拽功能
function dragstarted(event, d) {
    if (!event.active && simulation) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active && simulation) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

// ==================== 详情面板 ====================

// 当前选中的节点数据（用于探索面板）
let currentSelectedNode = null;
let currentSelectedEdge = null;
let exploreChatHistory = []; // 探索面板的聊天历史

// 人物视角模式
let isPersonaMode = false;
let personaNodeName = '';

function showNodeDetail(nodeData) {
    const panel = document.getElementById('detailPanel');
    const title = document.getElementById('detailTitle');
    const badge = document.getElementById('detailTypeBadge');
    const content = document.getElementById('detailContent');
    const headerActions = document.getElementById('detailHeaderActions');

    title.textContent = '节点详情';
    badge.style.display = 'none';

    // 在头部添加编辑和删除按钮
    if (headerActions) {
        headerActions.innerHTML = `
            <button class="btn-header-edit" onclick="enableNodeEdit('${nodeData.id}')" title="修改">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="btn-header-delete" onclick="deleteNode('${nodeData.id}', '${nodeData.name || '未知'}')" title="删除">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
    }

    const typeNameMap = {
        'PERSON': '人物',
        'LOCATION': '地点',
        'EVENT': '事件',
        'OBJECT': '物品',
        'CONCEPT': '概念',
        'EMOTION': '情感',
        'ENTITY': '实体'
    };
    const typeName = typeNameMap[nodeData.type] || nodeData.type || '实体';

    let html = `
        <div class="detail-row">
            <span class="detail-label">名称:</span>
            <span class="detail-value">
                <span style="font-weight: 600; font-size: 16px; margin-right: 8px;">${nodeData.name || '未知'}</span>
                <span class="type-badge-inline" style="background: ${colorMap[nodeData.type] || '#999'}; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px;">${typeName}</span>
            </span>
        </div>
    `;

    // 显示别名（新字段）
    if (nodeData.aliases && nodeData.aliases.length > 0) {
        html += `
            <div class="detail-row">
                <span class="detail-label">别名:</span>
                <span class="detail-value">${nodeData.aliases.join(', ')}</span>
            </div>
        `;
    }

    // 显示属性（新字段）
    if (nodeData.attributes && Object.keys(nodeData.attributes).length > 0) {
        html += `
            <div class="detail-section">
                <div class="section-title">属性</div>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${Object.entries(nodeData.attributes).map(([key, value]) => `
                        <span style="background: #f0f0f0; padding: 4px 10px; border-radius: 12px; font-size: 12px; color: #555;">
                            <span style="color: #999;">${key}:</span> ${value}
                        </span>
                    `).join('')}
                </div>
            </div>
        `;
    }

    if (nodeData.description) {
        html += `
            <div class="detail-section">
                <div class="section-title">描述</div>
                <div style="line-height: 1.5; color: #444;">${nodeData.description}</div>
            </div>
        `;
    }

    if (nodeData.memory_ids && nodeData.memory_ids.length > 0) {
        html += renderLinkedMemories(nodeData.memory_ids);
    }

    content.innerHTML = html;
    panel.classList.add('show');

    // 更新探索面板
    updateExplorePanel(nodeData);
    
    // 触发预测功能（如果可用）
    console.log('[预测] 检查预测功能...', typeof onNodeSelectedForPrediction);
    if (typeof onNodeSelectedForPrediction === 'function') {
        onNodeSelectedForPrediction(nodeData);
    } else {
        console.log('[预测] prediction.js 未加载或函数不存在');
    }
}

// ==================== 详情面板编辑功能 ====================

// 当前编辑状态
let editingNodeId = null;
let editingEdgeId = null;

// 启用节点编辑
function enableNodeEdit(nodeId) {
    editingNodeId = nodeId;
    const node = graphData.nodes.find(n => n.id === nodeId);
    if (!node) return;

    const content = document.getElementById('detailContent');
    
    // 将属性转换为键值字符串
    const attrs = node.attributes || {};
    const attrText = Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join('\n');
    
    // 编辑表单
    let html = `
        <div class="edit-form">
            <div class="form-group">
                <label>名称</label>
                <input type="text" id="editNodeName" value="${node.name || ''}" placeholder="实体名称">
            </div>
            <div class="form-group">
                <label>类型</label>
                <select id="editNodeType">
                    <option value="PERSON" ${node.type === 'PERSON' ? 'selected' : ''}>人物</option>
                    <option value="LOCATION" ${node.type === 'LOCATION' ? 'selected' : ''}>地点</option>
                    <option value="EVENT" ${node.type === 'EVENT' ? 'selected' : ''}>事件</option>
                    <option value="OBJECT" ${node.type === 'OBJECT' ? 'selected' : ''}>物品</option>
                    <option value="CONCEPT" ${node.type === 'CONCEPT' ? 'selected' : ''}>概念</option>
                    <option value="EMOTION" ${node.type === 'EMOTION' ? 'selected' : ''}>情感</option>
                    <option value="ENTITY" ${node.type === 'ENTITY' ? 'selected' : ''}>其他</option>
                </select>
            </div>
            <div class="form-group">
                <label>描述</label>
                <textarea id="editNodeDesc" rows="3" placeholder="描述这个实体...">${node.description || ''}</textarea>
            </div>
            <div class="form-group">
                <label>属性（每行一个，格式：键: 值）</label>
                <textarea id="editNodeAttrs" rows="3" placeholder="例如：\n职业: 程序员\n城市: 北京">${attrText}</textarea>
            </div>
            <div class="form-actions">
                <button class="btn-save" onclick="saveNodeEdit()">保存</button>
                <button class="btn-cancel" onclick="cancelEdit()">取消</button>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
}

// 保存节点编辑
async function saveNodeEdit() {
    if (!editingNodeId) return;
    
    const name = document.getElementById('editNodeName').value.trim();
    const type = document.getElementById('editNodeType').value;
    const description = document.getElementById('editNodeDesc')?.value.trim() || '';
    const attrText = document.getElementById('editNodeAttrs')?.value.trim() || '';
    
    if (!name) {
        showToast('名称不能为空', 'warning');
        return;
    }
    
    // 解析属性文本
    const attributes = {};
    attrText.split('\n').forEach(line => {
        const match = line.match(/^(.+?)[:：]\s*(.+)$/);
        if (match) {
            attributes[match[1].trim()] = match[2].trim();
        }
    });
    
    const updates = { name, type };
    if (description) updates.description = description;
    if (Object.keys(attributes).length > 0) updates.attributes = attributes;
    
    try {
        const response = await fetch(`/api/graph/node/${editingNodeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('实体已更新', 'success');
            // 刷新图谱数据
            await loadGraphData();
            // 重新显示详情
            const node = graphData.nodes.find(n => n.id === editingNodeId);
            if (node) showNodeDetail(node);
        } else {
            showToast(result.message || '更新失败', 'error');
        }
    } catch (error) {
        console.error('更新实体失败:', error);
        showToast('更新失败', 'error');
    }
    
    editingNodeId = null;
}

// 启用边编辑
function enableEdgeEdit(edgeId, sourceId, targetId) {
    editingEdgeId = edgeId;
    const edge = graphData.edges.find(e => (e.id || e.uuid) === edgeId);
    if (!edge) return;

    const content = document.getElementById('detailContent');
    const sourceNode = graphData.nodes.find(n => n.id === sourceId);
    const targetNode = graphData.nodes.find(n => n.id === targetId);
    
    // 关系类型选项
    const relationTypes = ['FRIEND', 'FAMILY', 'COLLEAGUE', 'PARTNER', 'WORK_AT', 'LIVE_IN', 'BORN_IN', 'STUDY_AT', 'PARTICIPATE', 'ORGANIZE', 'RELATED'];
    
    let html = `
        <div class="edit-form">
            <div class="form-group">
                <label>源节点</label>
                <input type="text" value="${sourceNode?.name || '未知'}" disabled>
            </div>
            <div class="form-group">
                <label>目标节点</label>
                <input type="text" value="${targetNode?.name || '未知'}" disabled>
            </div>
            <div class="form-group">
                <label>关系类型</label>
                <select id="editEdgeType">
                    ${relationTypes.map(t => `<option value="${t}" ${edge.type === t ? 'selected' : ''}>${getRelationTypeName(t)}</option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label>关系陈述（可选）</label>
                <textarea id="editEdgeFact" rows="3" placeholder="描述这个关系...">${edge.fact || ''}</textarea>
            </div>
            <div class="form-actions">
                <button class="btn-save" onclick="saveEdgeEdit()">保存</button>
                <button class="btn-cancel" onclick="cancelEdit()">取消</button>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
}

// 保存边编辑
async function saveEdgeEdit() {
    if (!editingEdgeId) return;
    
    const type = document.getElementById('editEdgeType').value;
    const fact = document.getElementById('editEdgeFact').value.trim();
    
    try {
        const response = await fetch(`/api/graph/edge/${editingEdgeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, fact })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('关系已更新', 'success');
            // 刷新图谱数据
            await loadGraphData();
            // 关闭详情面板
            closeDetailPanel();
        } else {
            showToast(result.message || '更新失败', 'error');
        }
    } catch (error) {
        console.error('更新关系失败:', error);
        showToast('更新失败', 'error');
    }
    
    editingEdgeId = null;
}

// 删除边
async function deleteEdge(edgeId) {
    if (!edgeId) {
        showToast('无效的关系ID', 'warning');
        return;
    }
    
    if (!confirm('确定要删除这个关系吗？此操作不可恢复。')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/graph/edge/${edgeId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('关系已删除', 'success');
            // 刷新图谱
            await loadGraphData();
            // 关闭详情面板
            closeDetailPanel();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除关系失败:', error);
        showToast('删除失败', 'error');
    }
}

// 取消编辑
function cancelEdit() {
    editingNodeId = null;
    editingEdgeId = null;
    // 重新加载当前选中的节点或边
    if (currentSelectedNode) {
        showNodeDetail(currentSelectedNode);
    } else if (currentSelectedEdge) {
        showEdgeDetail(currentSelectedEdge);
    } else {
        closeDetailPanel();
    }
}

// ==================== 删除功能 ====================

// 删除实体节点
async function deleteNode(nodeId, nodeName) {
    // 确认对话框
    if (!confirm(`确定要删除实体 "${nodeName}" 吗？\n\n注意：这将同时删除所有与该实体相关的关系。`)) {
        return;
    }
    
    try {
        showToast(`正在删除 "${nodeName}"...`, 'info');
        
        const response = await fetch(`/api/graph/node/${nodeId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`"${nodeName}" 已删除`, 'success');
            // 关闭详情面板
            closeDetailPanel();
            // 清除当前选中状态
            currentSelectedNode = null;
            // 刷新图谱数据
            await loadGraphData();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除实体失败:', error);
        showToast('删除失败，请重试', 'error');
    }
}

// 删除关系边
async function deleteEdge(edgeId, sourceName, targetName) {
    // 确认对话框
    if (!confirm(`确定要删除这条关系吗？\n\n${sourceName} → ${targetName}`)) {
        return;
    }
    
    try {
        showToast('正在删除关系...', 'info');
        
        const response = await fetch(`/api/graph/edge/${edgeId}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('关系已删除', 'success');
            // 关闭详情面板
            closeDetailPanel();
            // 清除当前选中状态
            currentSelectedEdge = null;
            // 刷新图谱数据
            await loadGraphData();
        } else {
            showToast(result.message || '删除失败', 'error');
        }
    } catch (error) {
        console.error('删除关系失败:', error);
        showToast('删除失败，请重试', 'error');
    }
}

// 批量删除自环关系
async function deleteAllSelfLoops(nodeName) {
    if (!currentSelectedEdge || !currentSelectedEdge.isSelfLoopGroup) return;
    
    const loops = currentSelectedEdge.selfLoopEdges || [];
    if (loops.length === 0) return;
    
    if (!confirm(`确定要删除 ${nodeName} 的全部 ${loops.length} 条自环关系吗？此操作不可恢复。`)) {
        return;
    }
    
    showToast('正在删除自环关系...', 'info');
    let successCount = 0;
    let failCount = 0;
    
    for (const loop of loops) {
        const loopId = loop.id || loop.uuid;
        if (!loopId) {
            failCount++;
            continue;
        }
        try {
            const response = await fetch(`/api/graph/edge/${loopId}`, { method: 'DELETE' });
            const result = await response.json();
            if (result.success) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (error) {
            console.error('删除自环失败:', error);
            failCount++;
        }
    }
    
    if (successCount > 0) {
        showToast(`已删除 ${successCount} 条自环关系`, 'success');
        await loadGraphData();
        closeDetailPanel();
        currentSelectedEdge = null;
    }
    if (failCount > 0) {
        showToast(`${failCount} 条自环关系删除失败`, 'error');
    }
}

// 查找重复实体
function findDuplicateNodes(nodeId) {
    const currentNode = graphData.nodes.find(n => n.id === nodeId);
    if (!currentNode) return;

    // 查找同名或相似名称的实体
    const duplicates = [];
    const currentName = currentNode.name.toLowerCase();
    
    graphData.nodes.forEach(node => {
        if (node.id === nodeId) return;
        
        const nodeName = node.name.toLowerCase();
        // 简单的相似度检查：完全匹配或包含关系
        if (nodeName === currentName || 
            nodeName.includes(currentName) || 
            currentName.includes(nodeName) ||
            getSimilarity(nodeName, currentName) > 0.6) {
            duplicates.push(node);
        }
    });
    
    if (duplicates.length === 0) {
        showToast('未发现重复实体', 'info');
        return;
    }
    
    // 显示重复实体列表供选择
    showMergeDialog(currentNode, duplicates);
}

// 简单的字符串相似度计算（Levenshtein距离的简化版本）
function getSimilarity(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);
    
    if (maxLen === 0) return 1;
    
    // 计算相同字符数
    let same = 0;
    const minLen = Math.min(len1, len2);
    for (let i = 0; i < minLen; i++) {
        if (str1[i] === str2[i]) same++;
    }
    
    return same / maxLen;
}

// 显示合并对话框
function showMergeDialog(keepNode, duplicates) {
    const content = document.getElementById('detailContent');
    
    let html = `
        <div class="edit-form">
            <div class="merge-section">
                <div class="merge-title">⚠️ 发现 ${duplicates.length} 个可能重复的实体</div>
                <div class="merge-desc">
                    选择要与 "${keepNode.name}" 合并的实体。合并后，选中的实体将被删除，其记忆和关系将转移到 "${keepNode.name}" 。
                </div>
    `;
    
    duplicates.forEach((dup, idx) => {
        html += `
            <div class="top-entity-item" style="margin-bottom: 8px;">
                <span class="entity-rank">${idx + 1}</span>
                <div class="entity-avatar" style="background: ${colorMap[dup.type] || '#999'};">${dup.type === 'PERSON' ? '人' : dup.type === 'LOCATION' ? '地' : dup.type === 'EVENT' ? '事' : dup.type === 'OBJECT' ? '物' : dup.type === 'CONCEPT' ? '念' : dup.type === 'EMOTION' ? '情' : '实'}</div>
                <span class="entity-name">${dup.name}</span>
                <span class="entity-count">${dup.memory_ids?.length || 0} 条记忆</span>
                <button class="btn-edit" style="margin-left: auto;" onclick="confirmMergeNodes('${keepNode.id}', '${dup.id}', '${dup.name}')">
                    合并
                </button>
            </div>
        `;
    });
    
    html += `
                <div class="merge-actions" style="margin-top: 16px;">
                    <button class="btn-cancel" onclick="cancelEdit()" style="flex: 1;">取消</button>
                </div>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
}

// 确认合并实体
async function confirmMergeNodes(keepId, removeId, removeName) {
    if (!confirm(`确定要将 "${removeName}" 合并到当前实体吗？\n\n此操作不可恢复。`)) {
        return;
    }
    
    try {
        const response = await fetch('/api/graph/nodes/merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keep_id: keepId, remove_id: removeId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast(`已合并，共 ${result.data.merged_memory_count} 条记忆`, 'success');
            // 刷新图谱
            await loadGraphData();
            // 重新显示保留的节点
            const keepNode = graphData.nodes.find(n => n.id === keepId);
            if (keepNode) showNodeDetail(keepNode);
        } else {
            showToast(result.message || '合并失败', 'error');
        }
    } catch (error) {
        console.error('合并实体失败:', error);
        showToast('合并失败', 'error');
    }
}

// 更新探索面板
function updateExplorePanel(nodeData) {
    currentSelectedNode = nodeData;
    currentSelectedEdge = null;
    
    // 显示探索选项卡
    const exploreTab = document.getElementById('tab-explore');
    if (exploreTab) {
        exploreTab.style.display = 'block';
    }
    
    // 更新节点卡片
    const nameEl = document.getElementById('exploreNodeName');
    const typeEl = document.getElementById('exploreNodeType');
    const avatarEl = document.getElementById('exploreNodeAvatar');
    const memoryCountEl = document.getElementById('exploreNodeMemoryCount');
    const connectionCountEl = document.getElementById('exploreNodeConnectionCount');
    
    if (nameEl) nameEl.textContent = nodeData.name || '未知';
    if (typeEl) typeEl.textContent = (nodeData.type || 'ENTITY').toUpperCase();
    if (avatarEl) {
        // 根据类型设置不同的头像文字
        const typeIcons = {
            'PERSON': '人',
            'LOCATION': '地',
            'EVENT': '事',
            'OBJECT': '物',
            'CONCEPT': '念',
            'EMOTION': '情',
            'ENTITY': '实'
        };
        avatarEl.textContent = typeIcons[nodeData.type] || '实';
        avatarEl.style.background = colorMap[nodeData.type] || '#999';
    }
    if (memoryCountEl) memoryCountEl.textContent = nodeData.memory_ids?.length || 0;
    
    // 计算连接节点数量
    let connectionCount = 0;
    if (graphData.edges) {
        connectionCount = graphData.edges.filter(e => 
            e.source === nodeData.id || e.target === nodeData.id
        ).length;
    }
    if (connectionCountEl) connectionCountEl.textContent = connectionCount;
    
    // 显示"生成此节点的记忆故事"按钮（节点详情专属）
    const storyGenSection = document.querySelector('.explore-story-gen');
    if (storyGenSection) {
        storyGenSection.style.display = 'block';
    }

    // 重置故事生成状态
    resetStoryGenerator();

    // 清空聊天历史
    exploreChatHistory = [];
    renderExploreChat();

    // 自动切换到探索面板
    switchTab('explore');

    // PERSON 节点显示"以此人视角回忆"按钮
    const personaBtn = document.getElementById('btn-persona');
    if (personaBtn) {
        personaBtn.style.display = nodeData.type === 'PERSON' ? 'inline-block' : 'none';
    }

    // 切换节点时退出 persona 模式
    if (isPersonaMode) {
        exitPersonaMode();
    }
}

// 渲染探索面板聊天
function renderExploreChat() {
    const container = document.getElementById('exploreChatMessages');
    if (!container) return;
    
    if (exploreChatHistory.length === 0) {
        container.innerHTML = `
            <div class="chat-empty">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                </div>
                <p class="empty-text">问关于此节点的任何问题<br>AI 将基于记忆网络回答</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = exploreChatHistory.map(msg => `
        <div class="chat-message ${msg.role}">
            <div class="message-avatar">${msg.role === 'user' ? '我' : 'AI'}</div>
            <div class="message-content">${escapeHtml(msg.content)}</div>
        </div>
    `).join('');
    
    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

// 切换到人物视角模式
function switchToPersonaMode() {
    if (!currentSelectedNode || currentSelectedNode.type !== 'PERSON') {
        showToast('只有人物节点才能使用视角回忆', 'warning');
        return;
    }
    isPersonaMode = true;
    personaNodeName = currentSelectedNode.name;

    // 显示 persona 指示器
    const indicator = document.getElementById('personaIndicator');
    const nameSpan = document.getElementById('personaName');
    if (indicator) {
        indicator.style.display = 'block';
        if (nameSpan) nameSpan.textContent = personaNodeName;
    }

    // 隐藏 persona 按钮
    const personaBtn = document.getElementById('btn-persona');
    if (personaBtn) personaBtn.style.display = 'none';

    // 自动填充问题
    setExploreQuestion(`${personaNodeName}你为什么要这样做？`);

    showToast(`🎭 洛忆已进入「${personaNodeName}」视角`, 'info');
}

// 退出人物视角模式
function exitPersonaMode() {
    const formerPersonaName = personaNodeName;
    isPersonaMode = false;
    personaNodeName = '';

    // 隐藏 persona 指示器
    const indicator = document.getElementById('personaIndicator');
    if (indicator) indicator.style.display = 'none';

    // 如果是 PERSON 节点则重新显示 persona 按钮
    if (currentSelectedNode && currentSelectedNode.type === 'PERSON') {
        const personaBtn = document.getElementById('btn-persona');
        if (personaBtn) personaBtn.style.display = 'inline-block';
    }

    // 清空聊天历史
    exploreChatHistory = [];
    renderExploreChat();

    showToast(`🎭 洛忆已退出「${formerPersonaName}」视角`, 'info');
}

// 设置探索问题
function setExploreQuestion(question) {
    const input = document.getElementById('exploreChatInput');
    if (input) {
        input.value = question;
        input.focus();
    }
}

// 发送探索问题
async function sendExploreQuestion() {
    const input = document.getElementById('exploreChatInput');
    if (!input) return;
    
    const question = input.value.trim();
    if (!question) return;
    if (!currentSelectedNode && !currentSelectedEdge) {
        showToast('请先选择一个节点或关系', 'warning');
        return;
    }
    
    // 添加用户消息
    exploreChatHistory.push({
        role: 'user',
        content: question,
        timestamp: new Date().toISOString()
    });
    renderExploreChat();
    input.value = '';
    
    // 显示加载状态
    const container = document.getElementById('exploreChatMessages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-message assistant';
    loadingDiv.innerHTML = `
        <div class="message-avatar">AI</div>
        <div class="message-content">
            <div class="typing-indicator">思考中...</div>
        </div>
    `;
    container.appendChild(loadingDiv);
    container.scrollTop = container.scrollHeight;
    
    try {
        // 调用后端 API
        const response = await fetch('/api/graph/explore', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question: question,
                node: currentSelectedNode,
                edge: currentSelectedEdge,
                history: exploreChatHistory,
                persona_mode: isPersonaMode,
                persona_node_name: personaNodeName
            })
        });
        
        const result = await response.json();
        
        // 移除加载状态
        loadingDiv.remove();
        
        if (result.success && result.data) {
            exploreChatHistory.push({
                role: 'assistant',
                content: result.data.answer,
                timestamp: result.data.timestamp || new Date().toISOString()
            });
            renderExploreChat();
        } else {
            throw new Error(result.error || '未知错误');
        }
        
    } catch (error) {
        loadingDiv.remove();
        showToast('请求失败: ' + error.message, 'error');
    }
}

// HTML 转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showEdgeDetail(edgeData) {
    const panel = document.getElementById('detailPanel');
    const title = document.getElementById('detailTitle');
    const badge = document.getElementById('detailTypeBadge');
    const content = document.getElementById('detailContent');
    const headerActions = document.getElementById('detailHeaderActions');

    title.textContent = '关系详情';
    badge.style.display = 'none';

    // 在头部添加编辑和删除按钮
    const edgeId = edgeData.id || edgeData.uuid || '';
    const sourceName = edgeData.source_name || '未知';
    const targetName = edgeData.target_name || '未知';
    if (headerActions && edgeId) {
        headerActions.innerHTML = `
            <button class="btn-header-edit" onclick="enableEdgeEdit('${edgeId}', '${edgeData.source}', '${edgeData.target}')" title="修改关系">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>
            </button>
            <button class="btn-header-delete" onclick="deleteEdge('${edgeId}', '${sourceName}', '${targetName}')" title="删除关系">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;
    } else if (headerActions && edgeData.isSelfLoopGroup) {
        headerActions.innerHTML = `
            <button class="btn-header-delete" onclick="deleteAllSelfLoops('${escapeHtml(edgeData.source_name || '')}')" title="删除全部自环">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                <span style="margin-left:4px;font-size:11px;">全部删除</span>
            </button>
        `;
    } else if (headerActions) {
        headerActions.innerHTML = '';
    }

    let html = '';

    // ========== 自环组详情 ==========
    if (edgeData.isSelfLoopGroup) {
        renderSelfLoopDetail(edgeData, content, panel);
        return;
    }

    // ========== 普通边详情 ==========
    const edgeTypeName = getRelationTypeName(edgeData.type);
    const edgeColor = edgeColorMap[edgeData.type] || '#999';
    
    // 计算关系密度和情感色彩
    const memoryCount = edgeData.memory_ids?.length || 0;
    const density = calculateRelationDensity(memoryCount);
    const emotionColor = calculateRelationEmotion(edgeData);

    // 关系头部 - 带密度指示器
    html += `
        <div class="edge-relation-header" style="background: linear-gradient(135deg, #f8f8f8 0%, #fff 100%); padding: 16px; border-radius: 8px; border: 2px solid ${emotionColor}20;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap; margin-bottom: 12px;">
                <span style="font-weight: 600; color: #333; font-size: 14px; background: #fff; padding: 6px 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${edgeData.source_name || '未知'}</span>
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <span style="color: ${edgeColor}; font-size: 18px;">→</span>
                    <span style="font-size: 11px; color: ${edgeColor}; font-weight: 500; white-space: nowrap;">${edgeTypeName}</span>
                </div>
                <span style="font-weight: 600; color: #333; font-size: 14px; background: #fff; padding: 6px 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${edgeData.target_name || '未知'}</span>
            </div>
            
            <!-- 关系密度条 -->
            <div style="display: flex; align-items: center; gap: 8px; padding-top: 12px; border-top: 1px solid #e0e0e0;">
                <span style="font-size: 11px; color: #666;">记忆密度:</span>
                <div style="flex: 1; height: 6px; background: #e0e0e0; border-radius: 3px; overflow: hidden;">
                    <div style="width: ${density}%; height: 100%; background: ${emotionColor}; border-radius: 3px; transition: width 0.3s;"></div>
                </div>
                <span style="font-size: 11px; color: ${emotionColor}; font-weight: 600;">${memoryCount} 条记忆</span>
            </div>
        </div>

        ${formatTemporalInfoForDisplay(edgeData.temporal_info)}
    `;

    // 关系陈述
    if (edgeData.fact) {
        html += `
            <div class="detail-section">
                <div class="section-title">关系陈述</div>
                <div style="line-height: 1.6; color: #444; font-size: 13px; padding: 10px; background: #f8f9fa; border-left: 3px solid ${emotionColor}; border-radius: 0 6px 6px 0;">
                    ${edgeData.fact}
                </div>
            </div>
        `;
    }

    // 记忆时间轴
    html += renderRelationTimeline(edgeData);

    content.innerHTML = html;
    panel.classList.add('show');
    
    // 更新探索面板
    updateExplorePanelForEdge(edgeData);
}

// 渲染自环详情
function renderSelfLoopDetail(edgeData, content, panel) {
    let html = `
        <div class="edge-relation-header self-loop-header" style="background: linear-gradient(135deg, #fce4ec 0%, #fff 100%); border-left: 3px solid #E91E63;">
            <span style="font-weight: 600; color: #333;">${edgeData.source_name}</span>
            <span style="color: #E91E63; margin: 0 8px;">↻</span>
            <span style="font-size: 12px; color: #666;">自我反思</span>
            <span class="self-loop-count" style="background: #E91E63; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">${edgeData.selfLoopCount} 条记忆</span>
        </div>
    `;

    // 自环记忆时间轴
    if (edgeData.selfLoopEdges && edgeData.selfLoopEdges.length > 0) {
        html += `<div class="detail-section"><div class="section-title">记忆时间轴</div><div class="relation-timeline">`;
        
        // 按时间排序
        const sortedLoops = [...edgeData.selfLoopEdges].sort((a, b) => 
            new Date(b.created_at || 0) - new Date(a.created_at || 0)
        );
        
        sortedLoops.forEach((loop, idx) => {
            const date = loop.created_at ? new Date(loop.created_at).toLocaleDateString('zh-CN') : '未知时间';
            const loopId = loop.id || loop.uuid || '';
            const loopSource = escapeHtml(loop.source_name || edgeData.source_name || '未知');
            const loopTarget = escapeHtml(loop.target_name || edgeData.target_name || '未知');
            html += `
                <div class="timeline-item" style="align-items: flex-start;">
                    <div class="timeline-marker" style="background: #E91E63; margin-top: 4px;"></div>
                    <div class="timeline-content" style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div class="timeline-date">${date}</div>
                            ${loopId ? `<button class="btn-header-delete" onclick="deleteEdge('${loopId}', '${loopSource}', '${loopTarget}')" title="删除此自环" style="padding: 2px 6px; font-size: 11px;">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 12px; height: 12px;">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </button>` : ''}
                        </div>
                        <div class="timeline-text" style="margin-top: 4px;">${loop.fact || loop.description || getRelationTypeName(loop.type) || '自我反思'}</div>
                    </div>
                </div>
            `;
        });
        html += `</div></div>`;
    }

    content.innerHTML = html;
    panel.classList.add('show');
}

// 计算关系密度 (0-100)
function calculateRelationDensity(memoryCount) {
    if (memoryCount === 0) return 0;
    if (memoryCount >= 10) return 100;
    return memoryCount * 10;
}

// 计算关系情感色彩
function calculateRelationEmotion(edgeData) {
    const episodes = edgeData.episodes || [];
    if (episodes.length === 0) return '#999';
    
    let positive = 0, negative = 0, neutral = 0;
    episodes.forEach(ep => {
        const valence = ep.valence || 0;
        if (valence > 0.3) positive++;
        else if (valence < -0.3) negative++;
        else neutral++;
    });
    
    if (positive > negative && positive > neutral) return '#27ae60'; // 绿色-积极
    if (negative > positive && negative > neutral) return '#e74c3c'; // 红色-消极
    return '#f39c12'; // 黄色-中性
}

// 渲染关系记忆时间轴
function renderRelationTimeline(edgeData) {
    const memorySummaries = edgeData.memory_summaries || [];
    const memoryIds = edgeData.memory_ids || [];
    const episodes = edgeData.episodes || [];
    
    // 合并所有证据并按时间排序
    const allEvidence = [];
    
    memorySummaries.forEach((summary, idx) => {
        if (summary) {
            allEvidence.push({
                type: 'memory',
                content: summary,
                icon: '📝',
                color: '#7b2d8e',
                timestamp: episodes[idx]?.timestamp || null,
                valence: episodes[idx]?.valence || 0
            });
        }
    });
    
    episodes.forEach((ep, idx) => {
        if (ep.snippet && !allEvidence.find(e => e.content === ep.snippet)) {
            allEvidence.push({
                type: 'episode',
                content: ep.snippet,
                icon: '📄',
                color: '#3498db',
                timestamp: ep.timestamp,
                valence: ep.valence || 0
            });
        }
    });
    
    // 按时间排序（最新在前）
    allEvidence.sort((a, b) => {
        const timeA = a.timestamp ? new Date(a.timestamp) : new Date(0);
        const timeB = b.timestamp ? new Date(b.timestamp) : new Date(0);
        return timeB - timeA;
    });
    
    if (allEvidence.length === 0) return '';
    
    let html = `
        <div class="detail-section">
            <div class="section-title">记忆时间轴 (${allEvidence.length})</div>
            <div class="relation-timeline">
    `;
    
    allEvidence.forEach((ev, idx) => {
        const date = ev.timestamp ? new Date(ev.timestamp).toLocaleDateString('zh-CN') : '时间未知';
        const emotionColor = ev.valence > 0.3 ? '#27ae60' : ev.valence < -0.3 ? '#e74c3c' : '#999';
        const displayText = ev.content.length > 80 ? ev.content.substring(0, 80) + '...' : ev.content;
        
        html += `
            <div class="timeline-item">
                <div class="timeline-marker" style="background: ${ev.color}; box-shadow: 0 0 0 3px ${ev.color}20;"></div>
                <div class="timeline-content">
                    <div class="timeline-header">
                        <span class="timeline-date">${date}</span>
                        <span class="timeline-emotion" style="color: ${emotionColor};">${ev.valence > 0.3 ? '😊' : ev.valence < -0.3 ? '😢' : '•'}</span>
                    </div>
                    <div class="timeline-text">${displayText}</div>
                </div>
            </div>
        `;
    });
    
    html += `</div></div>`;
    return html;
}

// 更新探索面板（关系）
function updateExplorePanelForEdge(edgeData) {
    currentSelectedEdge = edgeData;
    currentSelectedNode = null;
    
    // 显示探索选项卡
    const exploreTab = document.getElementById('tab-explore');
    if (exploreTab) {
        exploreTab.style.display = 'block';
    }
    
    // 更新节点卡片（显示关系信息）
    const nameEl = document.getElementById('exploreNodeName');
    const typeEl = document.getElementById('exploreNodeType');
    const avatarEl = document.getElementById('exploreNodeAvatar');
    const memoryCountEl = document.getElementById('exploreNodeMemoryCount');
    const connectionCountEl = document.getElementById('exploreNodeConnectionCount');
    
    if (nameEl) nameEl.textContent = edgeData.isSelfLoopGroup 
        ? edgeData.source_name 
        : `${edgeData.source_name} → ${edgeData.target_name}`;
    if (typeEl) typeEl.textContent = edgeData.isSelfLoopGroup ? '自环关系' : '关系';
    if (avatarEl) {
        avatarEl.textContent = edgeData.isSelfLoopGroup ? '自' : '关';
        avatarEl.style.background = edgeData.isSelfLoopGroup ? '#E91E63' : '#3498db';
    }
    if (memoryCountEl) memoryCountEl.textContent = edgeData.memory_ids?.length || 0;
    if (connectionCountEl) connectionCountEl.textContent = edgeData.isSelfLoopGroup ? edgeData.selfLoopCount || 0 : 1;
    
    // 显示"生成此关系的记忆故事"按钮
    const storyGenSection = document.querySelector('.explore-story-gen');
    if (storyGenSection) {
        storyGenSection.style.display = 'block';
    }

    // 重置故事生成状态
    resetStoryGenerator();

    // 清空聊天历史
    exploreChatHistory = [];
    renderExploreChat();

    // 自动切换到探索面板
    switchTab('explore');

    // 隐藏 persona 按钮，退出 persona 模式
    const personaBtn = document.getElementById('btn-persona');
    if (personaBtn) personaBtn.style.display = 'none';
    if (isPersonaMode) exitPersonaMode();
}

// 切换自环项展开/折叠状态
function toggleSelfLoopItem(loopId) {
    const contentEl = document.getElementById(`self-loop-content-${loopId}`);
    if (!contentEl) return;

    const isExpanded = expandedSelfLoops.has(loopId);
    if (isExpanded) {
        expandedSelfLoops.delete(loopId);
        contentEl.style.display = 'none';
    } else {
        expandedSelfLoops.add(loopId);
        contentEl.style.display = 'block';
    }

    // 更新展开/折叠图标
    const headerEl = contentEl.previousElementSibling;
    if (headerEl) {
        const toggleEl = headerEl.querySelector('span:last-child');
        if (toggleEl) {
            toggleEl.textContent = isExpanded ? '+' : '−';
        }
    }
}

function closeDetailPanel() {
    const panel = document.getElementById('detailPanel');
    panel.classList.remove('show');
    expandedSelfLoops.clear();  // 重置自环展开状态
    
    // 清空头部操作区
    const headerActions = document.getElementById('detailHeaderActions');
    if (headerActions) headerActions.innerHTML = '';
    
    // 隐藏探索选项卡，切回录入记忆
    const exploreTab = document.getElementById('tab-explore');
    if (exploreTab) {
        exploreTab.style.display = 'none';
    }
    
    // 清空选中状态
    currentSelectedNode = null;
    currentSelectedEdge = null;
    pathTargetNode = null;
    exploreChatHistory = [];
    
    // 隐藏路径侦探器和结果
    const pathFinder = document.getElementById('pathFinder');
    if (pathFinder) pathFinder.style.display = 'none';
    const pathResult = document.getElementById('pathResult');
    if (pathResult) pathResult.classList.remove('show');
    const storyResult = document.getElementById('storyResult');
    if (storyResult) storyResult.classList.remove('show');
    
    // 清除路径高亮
    highlightedPath = null;

    // 退出 persona 模式
    if (isPersonaMode) exitPersonaMode();

    // 隐藏 persona 按钮和指示器
    const personaBtn = document.getElementById('btn-persona');
    if (personaBtn) personaBtn.style.display = 'none';
    const personaIndicator = document.getElementById('personaIndicator');
    if (personaIndicator) personaIndicator.style.display = 'none';

    // 切回录入记忆面板
    switchTab('create');
}

function toggleEdgeLabels(show) {
    if (linkLabelsRef) {
        linkLabelsRef.style('display', show ? 'block' : 'none');
    }
    if (linkLabelBgRef) {
        linkLabelBgRef.style('display', show ? 'block' : 'none');
    }
}

function filterGraph(type) {
    // 更新按钮状态
    document.querySelectorAll('.control-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // 重新加载图谱数据
    loadGraphData(type);
}

function resetGraph() {
    loadGraphData('all');
}

// ==================== 工具函数 ====================

// 监听回车键搜索
document.getElementById('searchInput')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchMemories();
    }
});

// 监听搜索框清空
document.getElementById('searchInput')?.addEventListener('input', function(e) {
    if (e.target.value.trim() === '') {
        highlightedNodeIds.clear();
        highlightedPath = null;
        updateGraphStyles();
        loadMemories();
    }
});

// 禁用 resize 自动重绘 - 避免页面元素变化导致图谱抖动
// 如需手动刷新，可调用 loadGraphData()

// 更新图谱样式（不重新渲染，只更新高亮状态）
function updateGraphStyles() {
    const svg = d3.select('#graph-svg');
    if (svg.empty()) return;
    
    const g = svg.select('.graph-main-group');
    if (g.empty()) return;
    
    // 更新节点样式
    g.selectAll('.nodes circle')
        .attr('r', d => {
            if (highlightedPath?.nodeIds.has(d.id)) return 16;
            if (highlightedNodeIds.has(d.id)) return 14;
            return 10;
        })
        .attr('stroke', d => {
            if (highlightedPath?.nodeIds.has(d.id)) return '#E91E63';
            if (highlightedNodeIds.has(d.id)) return '#FFD700';
            return '#fff';
        })
        .attr('stroke-width', d => {
            if (highlightedPath?.nodeIds.has(d.id)) return 5;
            if (highlightedNodeIds.has(d.id)) return 4;
            return 2.5;
        });
    
    // 更新边样式
    g.selectAll('.links path')
        .attr('stroke', d => {
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const edgeKey = [sourceId, targetId].sort().join('_');
            if (highlightedPath?.edgeIds.has(d.id) || highlightedPath?.edgeIds.has(edgeKey)) return '#E91E63';
            if (d.isSelfLoop) return '#E91E63';
            return edgeColorMap[d.type] || '#C0C0C0';
        })
        .attr('stroke-width', d => {
            const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
            const targetId = typeof d.target === 'object' ? d.target.id : d.target;
            const edgeKey = [sourceId, targetId].sort().join('_');
            if (highlightedPath?.edgeIds.has(d.id) || highlightedPath?.edgeIds.has(edgeKey)) return 4;
            if (d.isSelfLoop) return 2;
            return 1.5;
        });
}

// ==================== 有意思的功能 ====================

// 路径侦探目标节点
let pathTargetNode = null;

// 更新路径侦探器显示
function updatePathFinder() {
    const pathFinder = document.getElementById('pathFinder');
    if (!pathFinder || !currentSelectedNode) return;
    
    // 如果已选中起点和终点，显示侦探器
    if (pathTargetNode && currentSelectedNode.id !== pathTargetNode.id) {
        pathFinder.style.display = 'block';
        document.getElementById('pathFrom').textContent = currentSelectedNode.name;
        document.getElementById('pathTo').textContent = pathTargetNode.name;
    } else {
        pathFinder.style.display = 'none';
    }
}

// BFS 查找最短路径
function findShortestPath(startId, endId) {
    if (!graphData || !graphData.edges) return null;
    
    const queue = [[startId]];
    const visited = new Set([startId]);
    
    while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];
        
        if (current === endId) {
            return path;
        }
        
        // 查找相邻节点
        for (const edge of graphData.edges) {
            // 处理 D3 处理后的边（source/target 可能是对象或字符串）
            const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
            const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
            
            let neighbor = null;
            if (sourceId === current && targetId !== current) {
                neighbor = targetId;
            } else if (targetId === current && sourceId !== current) {
                neighbor = sourceId;
            }
            
            if (neighbor && !visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push([...path, neighbor]);
            }
        }
    }
    
    return null;
}

// 查找关系路径
async function findRelationPath() {
    if (!currentSelectedNode || !pathTargetNode) {
        showToast('请先选择两个节点', 'warning');
        return;
    }
    
    const resultDiv = document.getElementById('pathResult');
    const btn = document.querySelector('.btn-find-path');
    
    btn.disabled = true;
    btn.textContent = '探索中...';
    
    // 查找路径
    const path = findShortestPath(currentSelectedNode.id, pathTargetNode.id);
    
    if (!path) {
        resultDiv.innerHTML = '<div style="color: #999; text-align: center;">未找到直接关联路径</div>';
        resultDiv.classList.add('show');
        btn.disabled = false;
        btn.textContent = '探索关联路径';
        return;
    }
    
    // 构建路径详情并收集边ID
    const pathDetails = [];
    const pathEdgeIds = new Set();
    const pathNodeIds = new Set(path);
    
    for (let i = 0; i < path.length - 1; i++) {
        const fromNode = graphData.nodes.find(n => n.id === path[i]);
        const toNode = graphData.nodes.find(n => n.id === path[i + 1]);
        
        // 查找关系（处理 source/target 可能是对象的情况）
        const edge = graphData.edges.find(e => {
            const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
            const targetId = typeof e.target === 'object' ? e.target.id : e.target;
            return (sourceId === path[i] && targetId === path[i + 1]) ||
                   (sourceId === path[i + 1] && targetId === path[i]);
        });
        
        if (edge) {
            // 使用排序后的 ID，确保无论方向如何都能匹配
            const edgeId = edge.id || [path[i], path[i+1]].sort().join('_');
            pathEdgeIds.add(edgeId);
        }
        
        pathDetails.push({
            from: fromNode?.name || path[i],
            to: toNode?.name || path[i + 1],
            relation: edge?.name || '关联'
        });
    }
    
    // 保存高亮路径并重新渲染
    highlightedPath = {
        nodeIds: pathNodeIds,
        edgeIds: pathEdgeIds
    };
    renderGraph();
    
    // 调用 AI 解读路径
    try {
        const response = await fetch('/api/graph/explore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: `请解读以下关联路径，用侦探推理的方式描述这些节点如何联系在一起：\n${pathDetails.map((p, i) => `${i + 1}. ${p.from} ${p.relation} ${p.to}`).join('\n')}`,
                node: currentSelectedNode,
                history: []
            })
        });
        
        const result = await response.json();
        
        let html = '<div style="font-weight: 600; margin-bottom: 10px; color: var(--color-memory);">🔍 侦探结果</div>';
        
        // 显示路径步骤
        pathDetails.forEach((step, idx) => {
            html += `
                <div class="path-step">
                    <div class="path-step-num">${idx + 1}</div>
                    <div class="path-step-text">
                        <strong>${step.from}</strong> 
                        <span style="color: var(--color-text-secondary);">${step.relation}</span> 
                        <strong>${step.to}</strong>
                    </div>
                </div>
            `;
        });
        
        // AI 解读
        if (result.success && result.data) {
            html += `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--color-border-light); font-style: italic; color: var(--color-text-secondary);">${result.data.answer}</div>`;
        }
        
        resultDiv.innerHTML = html;
        resultDiv.classList.add('show');
        
    } catch (error) {
        resultDiv.innerHTML = '<div style="color: #c62828;">探索失败: ' + error.message + '</div>';
        resultDiv.classList.add('show');
    }
    
    btn.disabled = false;
    btn.textContent = '探索关联路径';
}

// 生成记忆故事
// 重置故事生成器状态
function resetStoryGenerator() {
    const resultDiv = document.getElementById('storyResult');
    const btn = document.querySelector('.btn-story');
    
    if (resultDiv) {
        resultDiv.innerHTML = '';
        resultDiv.classList.remove('show');
    }
    
    if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
            生成关于此节点的记忆故事
        `;
    }
}

async function generateMemoryStory() {
    if (!currentSelectedNode && !currentSelectedEdge) {
        showToast('请先选择一个节点或关系', 'warning');
        return;
    }
    
    const resultDiv = document.getElementById('storyResult');
    const btn = document.querySelector('.btn-story');
    const targetName = currentSelectedNode?.name || 
        (currentSelectedEdge?.isSelfLoopGroup 
            ? currentSelectedEdge?.source_name 
            : `${currentSelectedEdge?.source_name} → ${currentSelectedEdge?.target_name}`);
    
    // 清除之前的结果
    resultDiv.innerHTML = '';
    resultDiv.classList.remove('show');
    
    btn.disabled = true;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
            <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle>
        </svg>
        <span class="loading-dots">创作中</span>
    `;
    
    try {
        const response = await fetch('/api/graph/explore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: `请基于以下信息，创作一段关于"${targetName}"的记忆故事。这是用户记忆网络中的内容，请用第一人称"我"来叙述，像在回忆一段往事。文字要有情感、有画面感，控制在200字左右。`,
                node: currentSelectedNode,
                edge: currentSelectedEdge,
                history: []
            })
        });
        
        const result = await response.json();

        if (result.success && result.data) {
            // 将文本分段，每段用p标签包裹
            const paragraphs = result.data.answer
                .split('\n')
                .filter(p => p.trim())
                .map(p => `<p>${p.trim()}</p>`)
                .join('');
            
            const html = `
                <div class="story-result-header">
                    <span class="story-result-title">关于「${targetName}」的记忆</span>
                </div>
                <div class="story-result-content">
                    ${paragraphs}
                </div>
                <div class="story-result-footer">
                    <span class="story-result-brand">Liora · 记忆网络</span>
                </div>
            `;
            resultDiv.innerHTML = html;
            resultDiv.classList.add('show');
        } else {
            throw new Error(result.error || '生成失败');
        }
        
    } catch (error) {
        resultDiv.innerHTML = `
            <div class="story-error">
                <strong>创作失败</strong><br>
                ${error.message}
            </div>
        `;
        resultDiv.classList.add('show');
    }
    
    btn.disabled = false;
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
        </svg>
        重新生成记忆故事
    `;
}

// 修改节点选中逻辑，支持路径侦探的双选
function setupPathFinder(nodeData) {
    if (!currentSelectedNode) {
        // 第一次选中，设为起点
        return;
    }

    // 如果按住 Shift 键，设为终点
    if (window.event && window.event.shiftKey) {
        pathTargetNode = nodeData;
        showToast(`已设置终点: ${nodeData.name}，点击"探索关联路径"`, 'info');
        updatePathFinder();
    } else {
        // 清空之前的终点
        pathTargetNode = null;
        updatePathFinder();
    }
}

// ==================== 导入导出 ====================

function exportMemories() {
    showToast('正在导出记忆...', 'info');
    window.location.href = '/api/memories/export';
}

function importMemories(input) {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    showToast('正在导入记忆...', 'info');
    fetch('/api/memories/import', {
        method: 'POST',
        body: formData
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            showToast(data.message, 'success');
            loadMemories();
            loadGraphData();
        } else {
            showToast(data.message || '导入失败', 'error');
        }
    })
    .catch(err => {
        showToast('导入失败: ' + err.message, 'error');
    })
    .finally(() => {
        input.value = '';
    });
}

// ==================== 洛忆聊天 ====================

// 洛忆聊天历史（已在上方全局声明）

/**
 * 发送消息给洛忆
 */
function sendLuoyiMessage() {
    const input = document.getElementById('luoyiChatInput');
    const message = input.value.trim();

    if (!message) return;

    // 添加用户消息到历史
    luoyiChatHistory.push({ role: 'user', content: message });

    // 清空输入框
    input.value = '';

    // 渲染用户消息
    renderLuoyiMessages();

    // 显示洛忆正在输入
    showLuoyiTyping();

    // 调用 API
    fetch('/api/luoyi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: message,
            history: luoyiChatHistory
        })
    })
    .then(r => r.json())
    .then(data => {
        // 移除正在输入状态
        hideLuoyiTyping();

        if (data.success) {
            // 添加洛忆回复到历史
            luoyiChatHistory.push({ role: 'assistant', content: data.reply });
            // 渲染消息
            renderLuoyiMessages();
        } else {
            // 添加错误消息
            luoyiChatHistory.push({ role: 'assistant', content: '抱歉，我刚才走神了... ' + (data.error || '') });
            renderLuoyiMessages();
        }
    })
    .catch(err => {
        hideLuoyiTyping();
        luoyiChatHistory.push({ role: 'assistant', content: '网络有点问题，稍后再试试？' });
        renderLuoyiMessages();
    });
}

/**
 * 渲染洛忆聊天消息
 */
function renderLuoyiMessages() {
    const container = document.getElementById('luoyiChatMessages');
    if (!container) return;

    // 欢迎消息卡片
    let html = `
        <div class="luoyi-welcome-card">
            <div class="luoyi-welcome-avatar">洛</div>
            <div class="luoyi-welcome-bubble">
                <p>你好！我是洛忆，你记忆网络的小伙伴~</p>
                <p>有什么想聊的，或者想回忆的？尽管问我吧！</p>
            </div>
        </div>
    `;

    // 渲染聊天历史
    for (const msg of luoyiChatHistory) {
        if (msg.role === 'user') {
            html += `
                <div class="luoyi-message luoyi-message-user">
                    <div class="luoyi-message-content">${escapeHtml(msg.content)}</div>
                </div>
            `;
        } else {
            html += `
                <div class="luoyi-message luoyi-message-luoyi">
                    <div class="luoyi-message-avatar">洛</div>
                    <div class="luoyi-message-content">${escapeHtml(msg.content)}</div>
                </div>
            `;
        }
    }

    container.innerHTML = html;

    // 滚动到底部
    container.scrollTop = container.scrollHeight;
}

/**
 * 显示洛忆正在输入
 */
function showLuoyiTyping() {
    const container = document.getElementById('luoyiChatMessages');
    if (!container) return;

    const typingHtml = `
        <div class="luoyi-typing" id="luoyiTypingIndicator">
            <div class="luoyi-message-avatar">洛</div>
            <div class="luoyi-typing-bubble">
                <div class="luoyi-typing-dot"></div>
                <div class="luoyi-typing-dot"></div>
                <div class="luoyi-typing-dot"></div>
            </div>
        </div>
    `;
    container.insertAdjacentHTML('beforeend', typingHtml);
    container.scrollTop = container.scrollHeight;
}

/**
 * 隐藏洛忆正在输入
 */
function hideLuoyiTyping() {
    const indicator = document.getElementById('luoyiTypingIndicator');
    if (indicator) {
        indicator.remove();
    }
}
