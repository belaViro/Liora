/**
 * Liora 前端应用 - 增强版图谱可视化
 */

// 全局状态
let currentTab = 'create';
let graphData = { nodes: [], edges: [] };
let simulation = null;
let socket = null;
let showEdgeLabels = true;
let linkLabelsRef = null;
let linkLabelBgRef = null;
let highlightedNodeIds = new Set(); // 搜索时高亮的节点ID
let expandedSelfLoops = new Set();  // 自环展开状态
let currentLayout = 'force';        // 当前布局类型
let graphZoom = null;               // D3 zoom 行为引用

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

// ==================== Liora 功能函数 ====================

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
    
    initSocket();
    initGraph();
    loadGraphData();
    loadMemories();
    loadStats();

    // 边标签开关事件
    document.getElementById('showEdgeLabels').addEventListener('change', function(e) {
        showEdgeLabels = e.target.checked;
        toggleEdgeLabels(showEdgeLabels);
    });
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

    // 加载对应数据（skipLoad=true时跳过）
    if (!skipLoad) {
        if (tab === 'memories') {
            loadMemories();
        } else if (tab === 'stats') {
            loadStats();
        }
    }
}

// ==================== 记忆录入 ====================

function onTypeChange() {
    const type = document.getElementById('memoryType').value;
    const fileGroup = document.getElementById('fileUploadGroup');

    if (type === 'image' || type === 'audio') {
        fileGroup.style.display = 'block';
    } else {
        fileGroup.style.display = 'none';
        document.getElementById('memoryFile').value = '';
        document.getElementById('filePreview').style.display = 'none';
    }
}

function onFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        const preview = document.getElementById('filePreview');
        preview.textContent = `已选择: ${file.name} (${formatFileSize(file.size)})`;
        preview.style.display = 'block';
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

    const type = document.getElementById('memoryType').value;
    const content = document.getElementById('memoryContent').value.trim();
    const fileInput = document.getElementById('memoryFile');
    const submitBtn = document.getElementById('submitBtn');

    if (!content && !fileInput.files[0]) {
        showToast('请填写内容或上传文件', 'error');
        return;
    }

    // 构建表单数据
    const formData = new FormData();
    formData.append('type', type);
    formData.append('content', content);

    if (fileInput.files[0]) {
        formData.append('file', fileInput.files[0]);
    }

    // 禁用按钮
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="loading"></span>保存中...';

    try {
        const response = await fetch('/api/memory/create', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        if (result.success) {
            showToast('记忆保存成功！', 'success');

            // 清空表单
            document.getElementById('memoryForm').reset();
            document.getElementById('filePreview').style.display = 'none';
            document.getElementById('fileUploadGroup').style.display = 'none';

            // 刷新图谱和列表
            loadGraphData();
            loadMemories();
            loadStats();
        } else {
            showToast(result.message || '保存失败', 'error');
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
        renderGraph();
        return;
    }

    try {
        const response = await fetch('/api/memory/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, limit: 20, use_vector: true })
        });

        const result = await response.json();

        if (result.success) {
            // 先高亮节点（这会触发renderGraph）
            highlightNodesFromMemories(result.results);
            // 再切换标签页（跳过自动加载，因为已有数据）
            switchTab('memories', null, true);
            renderSearchResults(result, query);
        } else {
            showToast(result.message || '搜索失败', 'error');
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
    const matchTypes = result.match_types || [];
    const scores = result.scores || [];
    const searchInfo = result.search_info || {};

    if (memories.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 20px; color: #666;">
                <div>未找到与 "${query}" 相关的记忆</div>
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
                <span>找到 ${memories.length} 个结果</span>
                <span>${searchInfoHtml}</span>
            </div>
        </div>
    `;

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

    // 如果图谱已加载，重新渲染以应用高亮
    if (graphData.nodes && graphData.nodes.length > 0) {
        renderGraph();
        // 聚焦到高亮节点
        focusOnHighlightedNodes();
    }
}

// 聚焦到高亮节点中心
function focusOnHighlightedNodes() {
    if (highlightedNodeIds.size === 0 || !graphZoom) return;
    
    // 获取高亮节点的位置
    const highlightedNodes = graphData.nodes.filter(n => highlightedNodeIds.has(n.id));
    if (highlightedNodes.length === 0) return;
    
    // 计算边界框
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    highlightedNodes.forEach(node => {
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x);
        maxY = Math.max(maxY, node.y);
    });
    
    // 计算中心点和合适的缩放级别
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    const svg = d3.select('#graph-svg');
    const container = svg.node().parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    
    // 计算合适的缩放级别（留一些边距）
    const padding = 100;
    const nodesWidth = maxX - minX + padding * 2;
    const nodesHeight = maxY - minY + padding * 2;
    const scale = Math.min(
        width / nodesWidth,
        height / nodesHeight,
        1.5  // 最大缩放级别
    );
    
    // 计算 transform
    const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(Math.max(0.3, Math.min(scale, 1.5)))
        .translate(-centerX, -centerY);
    
    // 应用平滑过渡动画
    svg.transition()
        .duration(750)
        .call(graphZoom.transform, transform);
}

// ==================== 记忆列表 ====================

async function loadMemories() {
    try {
        const response = await fetch('/api/memories/timeline');
        const result = await response.json();

        if (result.success) {
            renderMemoryList(result.memories);
        }
    } catch (error) {
        console.error('加载记忆失败:', error);
    }
}

function renderMemoryList(memories) {
    const listEl = document.getElementById('memoryList');

    if (memories.length === 0) {
        listEl.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">暂无记忆</div>';
        return;
    }

    listEl.innerHTML = memories.map(memory => {
        const typeLabels = {
            'text': '文字',
            'image': '图片',
            'audio': '音频'
        };

        const date = new Date(memory.created_at).toLocaleString('zh-CN');
        const content = memory.understanding?.description || memory.content || '无内容';
        const entities = memory.entities || [];

        return `
            <div class="memory-item">
                <button class="memory-delete-btn" onclick="confirmDeleteMemory(event, '${memory.id}')" title="删除记忆">×</button>
                <div class="memory-item-header" onclick="viewMemory('${memory.id}')">
                    <span class="memory-type">${typeLabels[memory.type] || memory.type}</span>
                    <span class="memory-date">${date}</span>
                </div>
                <div class="memory-content" onclick="viewMemory('${memory.id}')">${content}</div>
                <div class="memory-entities" onclick="viewMemory('${memory.id}')">
                    ${entities.slice(0, 3).map(e => `<span class="entity-tag">${e.name}</span>`).join('')}
                    ${entities.length > 3 ? `<span class="entity-tag">+${entities.length - 3}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

async function viewMemory(memoryId) {
    try {
        const response = await fetch(`/api/memory/${memoryId}`);
        const result = await response.json();

        if (result.success) {
            console.log('记忆详情:', result.data);
        }
    } catch (error) {
        console.error('获取记忆详情失败:', error);
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
        // 获取图谱统计
        const graphResponse = await fetch('/api/graph/data');
        const graphResult = await graphResponse.json();

        if (graphResult.success) {
            const data = graphResult.data;
            document.getElementById('statEntities').textContent = data.total_nodes;
            document.getElementById('statRelations').textContent = data.total_edges;
        }

        // 获取记忆统计
        const timelineResponse = await fetch('/api/memories/timeline');
        const timelineResult = await timelineResponse.json();

        if (timelineResult.success) {
            const memories = timelineResult.memories;
            document.getElementById('statMemories').textContent = memories.length;

            // 计算今日新增
            const today = new Date().toDateString();
            const todayCount = memories.filter(m =>
                new Date(m.created_at).toDateString() === today
            ).length;
            document.getElementById('statToday').textContent = todayCount;
        }
    } catch (error) {
        console.error('加载统计失败:', error);
    }
}

// ==================== 知识图谱 D3.js 增强版 ====================

function initGraph() {
    const svg = d3.select('#graph-svg');
    const container = svg.node().parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.attr('width', width).attr('height', height)
       .attr('viewBox', `0 0 ${width} ${height}`);

    // 创建缩放行为
    graphZoom = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            g.attr('transform', event.transform);
        });

    svg.call(graphZoom);

    // 创建主容器
    const g = svg.append('g');
    g.attr('class', 'graph-main-group');

    // 存储引用
    svg.node().graphG = g;
}

async function loadGraphData(entityTypes = null) {
    try {
        let url = '/api/graph/data?max_nodes=100';
        if (entityTypes && entityTypes !== 'all') {
            url += `&types=${entityTypes}`;
        }

        const response = await fetch(url);
        const result = await response.json();

        if (result.success) {
            graphData = result.data;
            renderGraph();
            updateLegend();
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

// ========== 布局切换函数 ==========
function changeLayout(layoutType) {
    currentLayout = layoutType;
    renderGraph();
    showToast('已切换布局: ' + getLayoutName(layoutType), 'success');
}

function getLayoutName(layout) {
    const names = {
        'force': '力导向',
        'circular': '圆环布局',
        'hierarchical': '层次树',
        'grid': '网格布局',
        'concentric': '同心圆'
    };
    return names[layout] || layout;
}

// 不同布局的初始位置计算函数
function calculateLayoutPositions(nodes, edges, width, height) {
    const layout = currentLayout;
    const centerX = width / 2;
    const centerY = height / 2;
    
    if (layout === 'force') {
        // 力导向布局 - 使用随机初始位置，让物理模拟自然分布
        return nodes.map(node => ({
            id: node.id,
            x: centerX + (Math.random() - 0.5) * width * 0.6,
            y: centerY + (Math.random() - 0.5) * height * 0.6
        }));
    }
    
    if (layout === 'circular') {
        // 圆环布局
        const radius = Math.min(width, height) * 0.35;
        const angleStep = (2 * Math.PI) / nodes.length;
        return nodes.map((node, i) => ({
            id: node.id,
            x: centerX + radius * Math.cos(i * angleStep - Math.PI / 2),
            y: centerY + radius * Math.sin(i * angleStep - Math.PI / 2)
        }));
    }
    
    if (layout === 'concentric') {
        // 同心圆布局 - 按度数分层
        return calculateConcentricPositions(nodes, centerX, centerY, 3);
    }
    
    if (layout === 'hierarchical') {
        // 层次树布局 - 按度数排序分层
        return calculateHierarchicalPositions(nodes, edges, width, height);
    }
    
    if (layout === 'grid') {
        // 网格布局
        return calculateGridPositions(nodes, width, height);
    }
    
    return nodes.map(n => ({ id: n.id, x: centerX, y: centerY }));
}

// 同心圆位置计算
function calculateConcentricPositions(nodes, centerX, centerY, layers = 4) {
    // 计算节点度数
    const nodeDegree = {};
    nodes.forEach(n => nodeDegree[n.id] = 0);
    graphData.edges.forEach(e => {
        const sourceId = typeof e.source === 'object' ? e.source.id : e.source;
        const targetId = typeof e.target === 'object' ? e.target.id : e.target;
        nodeDegree[sourceId] = (nodeDegree[sourceId] || 0) + 1;
        nodeDegree[targetId] = (nodeDegree[targetId] || 0) + 1;
    });

    // 找出最大度数用于归一化
    let maxDegree = 1;
    nodes.forEach(n => {
        if (nodeDegree[n.id] > maxDegree) maxDegree = nodeDegree[n.id];
    });

    // 按度数分层：度数高的在内层，低的在外层
    const degreeGroups = {};
    nodes.forEach(node => {
        const degree = nodeDegree[node.id] || 0;
        // 归一化度数到 [0, layers-1]，度数高的映射到高层（内层）
        const normalizedDegree = maxDegree > 1 ? degree / maxDegree : 0;
        const layer = Math.min(Math.floor((1 - normalizedDegree) * (layers - 1)), layers - 1);
        if (!degreeGroups[layer]) degreeGroups[layer] = [];
        degreeGroups[layer].push(node);
    });

    // 计算位置
    const positions = {};
    const maxRadius = Math.min(centerX, centerY) * 0.8;

    for (let layer = 0; layer < layers; layer++) {
        const layerNodes = degreeGroups[layer] || [];
        const radius = maxRadius * (layer + 1) / layers;
        // 关键修复：处理单节点情况，避免 angleStep = 2π 导致所有单节点堆叠
        const angleStep = layerNodes.length > 1 ? (2 * Math.PI) / layerNodes.length : 0;
        const startAngle = -Math.PI / 2; // 从顶部开始

        layerNodes.forEach((node, i) => {
            const angle = angleStep > 0 ? startAngle + i * angleStep : startAngle;
            positions[node.id] = {
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            };
        });
    }

    return nodes.map(n => positions[n.id] || { x: centerX, y: centerY });
}

// 层次树位置计算
function calculateHierarchicalPositions(nodes, edges, width, height) {
    const centerX = width / 2;
    const topMargin = height * 0.12;
    const bottomMargin = height * 0.12;
    const availableHeight = height - topMargin - bottomMargin;
    
    // 计算度数和找出根节点（度数最大的）
    const nodeDegree = {};
    const nodeChildren = {};
    nodes.forEach(n => {
        nodeDegree[n.id] = 0;
        nodeChildren[n.id] = [];
    });
    
    edges.forEach(e => {
        if (e.source !== e.target) {
            nodeDegree[e.source] = (nodeDegree[e.source] || 0) + 1;
            nodeDegree[e.target] = (nodeDegree[e.target] || 0) + 1;
            nodeChildren[e.source].push(e.target);
        }
    });
    
    // 按度数排序分层
    const sortedNodes = [...nodes].sort((a, b) => (nodeDegree[b.id] || 0) - (nodeDegree[a.id] || 0));
    const layers = 4;
    const nodesPerLayer = Math.ceil(sortedNodes.length / layers);
    
    const positions = {};
    sortedNodes.forEach((node, i) => {
        const layer = Math.floor(i / nodesPerLayer);
        const indexInLayer = i % nodesPerLayer;
        const layerCount = Math.min(nodesPerLayer, sortedNodes.length - layer * nodesPerLayer);
        
        const y = topMargin + (layer / (layers - 1 || 1)) * availableHeight;
        const layerWidth = width * 0.7;
        const xStep = layerCount > 1 ? layerWidth / (layerCount - 1) : 0;
        const x = centerX - layerWidth / 2 + indexInLayer * xStep;
        
        positions[node.id] = { x, y };
    });
    
    return nodes.map(n => positions[n.id] || { x: centerX, y: height / 2 });
}

// 网格布局
function calculateGridPositions(nodes, width, height) {
    const cols = Math.ceil(Math.sqrt(nodes.length * width / height));
    const rows = Math.ceil(nodes.length / cols);
    
    const cellWidth = width * 0.8 / cols;
    const cellHeight = height * 0.8 / rows;
    const marginX = width * 0.1;
    const marginY = height * 0.1;
    
    return nodes.map((node, i) => ({
        id: node.id,
        x: marginX + (i % cols) * cellWidth + cellWidth / 2,
        y: marginY + Math.floor(i / cols) * cellHeight + cellHeight / 2
    }));
}

// 获取当前布局的力导向参数
// 核心原则：所有布局都使用力模拟，通过初始位置 + 力参数来保持各自特性
// 参考 MiroFish: 所有布局都用 force simulation，只是参数不同
function getLayoutForces() {
    switch (currentLayout) {
        case 'circular':
            // 圆形布局：保持圆形分布，仅用微弱力防止完全重叠
            return {
                linkDistance: 0,
                chargeStrength: -80,    // 微弱排斥，防止节点完全重叠
                collideRadius: 30,
                centerStrength: 0.02,   // 极弱中心引力，维持大致圆形
                alphaDecay: 0.04,       // 较快稳定，保留初始圆形结构
                velocityDecay: 0.4
            };
        case 'concentric':
            // 同心圆布局：保持层次结构，仅用微弱力微调
            return {
                linkDistance: 0,
                chargeStrength: -60,    // 很弱的排斥，避免节点重叠
                collideRadius: 25,
                centerStrength: 0,      // 无中心引力，保持层次
                alphaDecay: 0.03,        // 缓慢稳定
                velocityDecay: 0.3
            };
        case 'hierarchical':
            // 层次布局：需要Y轴约束保持层级
            return {
                linkDistance: 120,
                chargeStrength: -150,
                collideRadius: 30,
                centerStrength: 0.01,
                yStrength: 0.5,         // 强Y轴约束保持层级
                alphaDecay: 0.03,
                velocityDecay: 0.4
            };
        case 'grid':
            // 网格布局：微弱力仅用于避免重叠
            return {
                linkDistance: 0,
                chargeStrength: -50,
                collideRadius: 35,
                centerStrength: 0,
                alphaDecay: 0.08,       // 快速稳定
                velocityDecay: 0.5
            };
        default: // force - 力导向布局
            return {
                linkDistance: 150,       // 参照 MiroFish: 150
                chargeStrength: -400,    // 参照 MiroFish: -400
                collideRadius: 50,        // 参照 MiroFish: 50
                centerStrength: 0.04,    // 参照 MiroFish: 0.04
                alphaDecay: 0.02,
                velocityDecay: 0.3
            };
    }
}

function renderGraph() {
    const svg = d3.select('#graph-svg');
    const container = svg.node().parentElement;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const g = svg.node().graphG;

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

    // 根据当前布局计算节点初始位置
    const layoutPositions = calculateLayoutPositions(sortedNodes, edges, width, height);
    
    // 初始化节点位置
    const nodes = sortedNodes.map((n, i) => {
        const pos = layoutPositions[i] || { x: width / 2, y: height / 2 };
        return {
            id: n.id,
            name: n.name || 'Unnamed',
            type: n.type || 'Entity',
            rawData: n,
            x: pos.x,
            y: pos.y
        };
    });

    // 获取当前布局的力导向参数
    const forces = getLayoutForces();
    
    // 创建力导向模拟
    simulation = d3.forceSimulation(nodes);
    
    // 动态布局（力导向、同心圆、层次）- 启用完整物理模拟
    if (!forces.fixed) {
        simulation
            .force('link', d3.forceLink(edges).id(d => d.id).distance(d => {
                const baseDistance = forces.linkDistance;
                const edgeCount = d.pairTotal || 1;
                return baseDistance + (edgeCount - 1) * 50;  // MiroFish: 50
            }))
            .force('charge', d3.forceManyBody()
                .strength(-400)  // MiroFish: 固定 -400
                .distanceMax(800)
            )
            .force('center', d3.forceCenter(width / 2, height / 2).strength(forces.centerStrength || 0.04))
            .force('collide', d3.forceCollide()
                .radius(50)  // MiroFish: 固定 50
                .strength(0.8)
                .iterations(3)
            )
            .force('x', d3.forceX(width / 2).strength(0.04))  // MiroFish: 0.04
            .force('y', d3.forceY(height / 2).strength(forces.yStrength || 0.04));  // MiroFish: 0.04
        
        // 层次布局冷却更快以保持结构
        if (currentLayout === 'hierarchical') {
            simulation.alphaDecay(0.04).velocityDecay(0.4);
        } else {
            simulation.alphaDecay(0.02).velocityDecay(0.3);
        }
    } else {
        // 固定布局（圆环、网格）- 只保留轻微碰撞检测，禁用其他物理力
        simulation
            .force('collide', d3.forceCollide()
                .radius(forces.collideRadius)
                .strength(0.2)
                .iterations(1)
            )
            .alphaDecay(0.9)
            .velocityDecay(0.9);
    }

    // 创建节点映射用于快速查找（处理固定布局时 source/target 是字符串 ID 的情况）
    const nodeMapById = {};
    nodes.forEach(n => nodeMapById[n.id] = n);
    
    // 计算曲线路径（支持自环）
    function getLinkPath(d) {
        // 处理 source/target 可能是字符串 ID 的情况（固定布局）
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
        .attr('stroke', d => d.isSelfLoop ? '#E91E63' : (edgeColorMap[d.type] || '#C0C0C0'))
        .attr('stroke-width', d => d.isSelfLoop ? 2 : 1.5)
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
        .attr('r', d => highlightedNodeIds.has(d.id) ? 14 : 10)  // MiroFish: 固定 10，高亮 14
        .attr('fill', d => colorMap[d.type] || '#999')
        .attr('stroke', d => highlightedNodeIds.has(d.id) ? '#FFD700' : '#fff')
        .attr('stroke-width', d => highlightedNodeIds.has(d.id) ? 4 : 2.5)
        .style('cursor', 'pointer')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended)
        )
        .on('click', (event, d) => {
            event.stopPropagation();
            node.attr('stroke', d => highlightedNodeIds.has(d.id) ? '#FFD700' : '#fff').attr('stroke-width', d => highlightedNodeIds.has(d.id) ? 4 : 2.5);
            link.attr('stroke', e => e.isSelfLoop ? '#E91E63' : '#C0C0C0').attr('stroke-width', e => e.isSelfLoop ? 2 : 1.5);
            d3.select(event.target).attr('stroke', '#E91E63').attr('stroke-width', 4);
            link.filter(l => l.source.id === d.id || l.target.id === d.id)
                .attr('stroke', '#E91E63')
                .attr('stroke-width', 2.5);
            showNodeDetail(d.rawData);
        })
        .on('mouseenter', (event, d) => {
            d3.select(event.target).attr('stroke', '#333').attr('stroke-width', 3);
        })
        .on('mouseleave', (event, d) => {
            d3.select(event.target).attr('stroke', highlightedNodeIds.has(d.id) ? '#FFD700' : '#fff').attr('stroke-width', highlightedNodeIds.has(d.id) ? 4 : 2.5);
        });

    // 节点标签
    const nodeLabels = nodeGroup.selectAll('text')
        .data(nodes)
        .enter().append('text')
        .text(d => d.name.length > 8 ? d.name.substring(0, 8) + '…' : d.name)
        .attr('font-size', d => highlightedNodeIds.has(d.id) ? '14px' : '11px')
        .attr('fill', d => highlightedNodeIds.has(d.id) ? '#E91E63' : '#333')
        .attr('font-weight', d => highlightedNodeIds.has(d.id) ? '700' : '500')
        .attr('dx', 14)
        .attr('dy', 4)
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
    });
    
    // 固定布局：运行足够多次迭代让节点正确分布
    if (forces.fixed) {
        simulation.tick(100);  // 增加迭代次数确保固定布局正确渲染
        simulation.stop();
    }

    // 点击空白关闭详情面板
    svg.on('click', () => {
        closeDetailPanel();
        expandedSelfLoops.clear();  // 重置自环展开状态
        node.attr('stroke', '#fff').attr('stroke-width', 2.5);
        link.attr('stroke', d => d.isSelfLoop ? '#E91E63' : (edgeColorMap[d.type] || '#C0C0C0')).attr('stroke-width', d => d.isSelfLoop ? 2 : 1.5);
        linkLabelBg.attr('fill', 'rgba(255,255,255,0.95)');
        linkLabels.attr('fill', d => d.isSelfLoop ? '#E91E63' : '#666');
    });
}

// MiroFish 风格拖拽：3px 阈值区分点击和拖拽
function dragstarted(event, d) {
    // 只记录位置，不重启仿真（区分点击和拖拽）
    d.fx = d.x;
    d.fy = d.y;
    d._dragStartX = event.x;
    d._dragStartY = event.y;
    d._isDragging = false;
}

function dragged(event, d) {
    // 检测是否真正开始拖拽（移动超过阈值）
    const dx = event.x - d._dragStartX;
    const dy = event.y - d._dragStartY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (!d._isDragging && distance > 3) {
        // 首次检测到真正拖拽，才重启仿真
        d._isDragging = true;
        if (!event.active) simulation.alphaTarget(0.3).restart();
    }
    
    if (d._isDragging) {
        d.fx = event.x;
        d.fy = event.y;
    }
}

function dragended(event, d) {
    // 只有真正拖拽过才让仿真逐渐停止
    if (d._isDragging) {
        if (!event.active) simulation.alphaTarget(0);
    }
    d.fx = null;
    d.fy = null;
    d._isDragging = false;
    delete d._dragStartX;
    delete d._dragStartY;
}

// ==================== 详情面板 ====================

function showNodeDetail(nodeData) {
    const panel = document.getElementById('detailPanel');
    const title = document.getElementById('detailTitle');
    const badge = document.getElementById('detailTypeBadge');
    const content = document.getElementById('detailContent');

    title.textContent = '节点详情';
    badge.textContent = nodeData.type || 'Entity';
    badge.style.background = colorMap[nodeData.type] || '#999';
    badge.style.display = 'inline-block';

    let html = `
        <div class="detail-row">
            <span class="detail-label">名称:</span>
            <span class="detail-value">${nodeData.name || '未知'}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">ID:</span>
            <span class="detail-value uuid-text">${nodeData.id || '-'}</span>
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
        html += `
            <div class="detail-section">
                <div class="section-title">关联记忆 (${nodeData.memory_ids.length})</div>
                <div style="font-size: 12px; color: #666;">
                    ${nodeData.memory_ids.slice(0, 5).map(id => `<div style="margin-bottom: 4px;">📝 ${id.substring(0, 20)}...</div>`).join('')}
                    ${nodeData.memory_ids.length > 5 ? `<div>... 共 ${nodeData.memory_ids.length} 条</div>` : ''}
                </div>
            </div>
        `;
    }

    content.innerHTML = html;
    panel.classList.add('show');
}

function showEdgeDetail(edgeData) {
    const panel = document.getElementById('detailPanel');
    const title = document.getElementById('detailTitle');
    const badge = document.getElementById('detailTypeBadge');
    const content = document.getElementById('detailContent');

    title.textContent = '关系详情';
    badge.style.display = 'none';

    let html = '';

    // ========== MiroFish 风格：自环组详情 ==========
    if (edgeData.isSelfLoopGroup) {
        html += `
            <div class="edge-relation-header self-loop-header" style="background: linear-gradient(135deg, #fce4ec 0%, #fff 100%); border-left: 3px solid #E91E63;">
                <span style="font-weight: 600; color: #333;">${edgeData.source_name}</span>
                <span style="color: #E91E63; margin: 0 8px;">↻</span>
                <span style="font-size: 12px; color: #666;">自环关系</span>
                <span class="self-loop-count" style="background: #E91E63; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px;">${edgeData.selfLoopCount} 项</span>
            </div>
        `;

        // 自环列表
        if (edgeData.selfLoopEdges && edgeData.selfLoopEdges.length > 0) {
            html += `<div class="self-loop-list" style="margin-top: 12px;">`;
            edgeData.selfLoopEdges.forEach((loop, idx) => {
                const loopId = loop.id || idx;
                const isExpanded = expandedSelfLoops.has(loopId);
                html += `
                    <div class="self-loop-item" style="border: 1px solid #e0e0e0; border-radius: 6px; margin-bottom: 8px; overflow: hidden;">
                        <div class="self-loop-item-header" 
                             style="padding: 10px 12px; background: #f8f8f8; cursor: pointer; display: flex; align-items: center; justify-content: space-between;"
                             onclick="toggleSelfLoopItem('${loopId}')">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="color: #999; font-size: 11px;">#${idx + 1}</span>
                                <span style="font-weight: 500; color: #333;">${getRelationTypeName(loop.type) || '自环'}</span>
                            </div>
                            <span style="color: #999; font-size: 16px;">${isExpanded ? '−' : '+'}</span>
                        </div>
                        <div class="self-loop-item-content" id="self-loop-content-${loopId}" style="display: ${isExpanded ? 'block' : 'none'}; padding: 12px; border-top: 1px solid #e0e0e0; background: #fff;">
                            ${loop.description ? `<div style="margin-bottom: 10px; line-height: 1.5; color: #444; font-size: 13px;">${loop.description}</div>` : ''}
                            <div style="font-size: 11px; color: #999;">
                                <div>ID: <span class="uuid-text">${loop.id || '-'}</span></div>
                                ${loop.memory_ids ? `<div style="margin-top: 4px;">关联记忆: ${loop.memory_ids.length} 条</div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            });
            html += `</div>`;
        }

        content.innerHTML = html;
        panel.classList.add('show');
        return;
    }

    // ========== 普通边详情 ==========
    const edgeTypeName = getRelationTypeName(edgeData.type);
    const edgeColor = edgeColorMap[edgeData.type] || '#999';

    // 更直观的关系描述头部
    html += `
        <div class="edge-relation-header" style="background: linear-gradient(135deg, #f8f8f8 0%, #fff 100%); padding: 16px; border-radius: 8px;">
            <div style="display: flex; align-items: center; justify-content: center; gap: 12px; flex-wrap: wrap;">
                <span style="font-weight: 600; color: #333; font-size: 14px; background: #fff; padding: 6px 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${edgeData.source_name || '未知'}</span>
                <div style="display: flex; flex-direction: column; align-items: center;">
                    <span style="color: ${edgeColor}; font-size: 18px;">→</span>
                    <span style="font-size: 11px; color: ${edgeColor}; font-weight: 500; white-space: nowrap;">${edgeTypeName}</span>
                </div>
                <span style="font-weight: 600; color: #333; font-size: 14px; background: #fff; padding: 6px 12px; border-radius: 6px; border: 1px solid #e0e0e0;">${edgeData.target_name || '未知'}</span>
            </div>
        </div>

        ${formatTemporalInfoForDisplay(edgeData.temporal_info)}
    `;

    // 显示 fact（关系陈述，新字段）
    if (edgeData.fact) {
        html += `
            <div class="detail-section">
                <div class="section-title">关系陈述</div>
                <div style="line-height: 1.6; color: #444; font-size: 13px; padding: 10px; background: #f8f9fa; border-left: 3px solid #3498db; border-radius: 0 6px 6px 0;">
                    ${edgeData.fact}
                </div>
            </div>
        `;
    }

    if (edgeData.description) {
        html += `
            <div class="detail-section">
                <div class="section-title">关系描述</div>
                <div style="line-height: 1.6; color: #444; font-size: 13px;">${edgeData.description}</div>
            </div>
        `;
    }

    // 显示来源证据（合并记忆内容和片段）
    const memorySummaries = edgeData.memory_summaries || [];
    const memoryIds = edgeData.memory_ids || [];
    const episodes = edgeData.episodes || [];
    
    // 合并所有证据来源
    const allEvidence = [];
    
    // 添加记忆摘要作为证据
    memorySummaries.forEach((summary, idx) => {
        if (summary) {
            allEvidence.push({
                type: 'memory',
                content: summary,
                icon: '📝',
                color: '#7b2d8e'
            });
        }
    });
    
    // 添加片段作为证据
    episodes.forEach((ep, idx) => {
        if (ep.snippet) {
            allEvidence.push({
                type: 'episode',
                content: ep.snippet,
                icon: '📄',
                color: '#3498db',
                timestamp: ep.timestamp
            });
        }
    });
    
    // 去重（简单去重：内容相同则合并）
    const uniqueEvidence = [];
    const seen = new Set();
    allEvidence.forEach(ev => {
        const key = ev.content.substring(0, 50);
        if (!seen.has(key)) {
            seen.add(key);
            uniqueEvidence.push(ev);
        }
    });
    
    if (uniqueEvidence.length > 0) {
        html += `
            <div class="detail-section">
                <div class="section-title">来源证据 (${uniqueEvidence.length})</div>
                <div style="display: flex; flex-direction: column; gap: 8px;">
        `;
        uniqueEvidence.slice(0, 5).forEach((ev, idx) => {
            const displayText = ev.content.length > 100 ? ev.content.substring(0, 100) + '...' : ev.content;
            html += `
                <div style="padding: 10px 12px; background: #f8f9fa; border-radius: 6px; font-size: 12px; line-height: 1.6; color: #444; border-left: 3px solid ${ev.color};">
                    <div style="display: flex; align-items: flex-start; gap: 8px;">
                        <span style="color: ${ev.color}; flex-shrink: 0;">${ev.icon}</span>
                        <span>${displayText}</span>
                    </div>
                    ${ev.timestamp ? `<div style="margin-top: 6px; font-size: 10px; color: #999; padding-left: 24px;">${new Date(ev.timestamp).toLocaleString('zh-CN')}</div>` : ''}
                </div>
            `;
        });
        if (uniqueEvidence.length > 5) {
            html += `<div style="text-align: center; color: #999; font-size: 11px; padding: 4px;">... 还有 ${uniqueEvidence.length - 5} 条证据</div>`;
        }
        html += `</div></div>`;
    } else if (memoryIds.length > 0) {
        html += `
            <div class="detail-section">
                <div class="section-title">来源证据</div>
                <div style="padding: 10px 12px; background: #f8f8f8; border-radius: 6px; font-size: 12px; color: #666;">
                    <span style="color: #7b2d8e; margin-right: 6px;">📝</span>共有 ${memoryIds.length} 条相关记忆
                </div>
            </div>
        `;
    }

    content.innerHTML = html;
    panel.classList.add('show');
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
        renderGraph();
        loadMemories();
    }
});

// 监听窗口大小变化
window.addEventListener('resize', () => {
    if (graphData.nodes && graphData.nodes.length > 0) {
        loadGraphData();
    }
});
