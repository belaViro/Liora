/**
 * 节点预测功能 - AI 预测下一个可能的节点
 */

// 存储当前显示的预测节点
let currentPredictions = [];
let predictionLinks = [];

// 显示预测按钮（添加到节点详情面板）
function showPredictionButton(node) {
    const actionsDiv = document.getElementById('detailHeaderActions');
    if (!actionsDiv) {
        console.log('[预测] detailHeaderActions 元素不存在');
        return;
    }
    
    // 检查是否已有预测按钮
    if (actionsDiv.querySelector('.btn-predict')) {
        console.log('[预测] 按钮已存在，跳过');
        return;
    }
    
    console.log('[预测] 正在添加预测按钮...', node.name);
    
    const predictBtn = document.createElement('button');
    predictBtn.className = 'btn-predict';
    predictBtn.id = 'btn-predict';
    predictBtn.innerHTML = `
        <svg class="predict-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 16v-4"></path>
            <path d="M12 8h.01"></path>
        </svg>
        <span class="predict-text">预测关联</span>
    `;
    predictBtn.onclick = () => loadPredictions(node, predictBtn);
    
    actionsDiv.appendChild(predictBtn);
}

// 加载预测节点
async function loadPredictions(node, btnElement) {
    // 设置按钮为加载状态
    if (btnElement) {
        btnElement.disabled = true;
        btnElement.classList.add('predict-loading');
        btnElement.innerHTML = `
            <span class="predict-dots">···</span>
            <span class="predict-text">思考中</span>
        `;
    }
    
    showToast('正在分析可能的关联节点...', 'info');
    
    try {
        const response = await fetch(`/api/graph/predict/${node.id}?limit=3`);
        const result = await response.json();
        
        if (result.success && result.data.predictions.length > 0) {
            currentPredictions = result.data.predictions.map((p, idx) => ({
                id: `prediction_${idx}`,
                name: p.name,
                type: p.type,
                relation: p.relation,
                reason: p.reason,
                confidence: p.confidence,
                sourceNode: node
            }));
            
            showPredictionPanel(result.data.predictions);
            showToast(`发现 ${currentPredictions.length} 个可能的关联`, 'success');
        } else {
            showToast('暂无预测结果', 'info');
        }
    } catch (error) {
        console.error('加载预测失败:', error);
        showToast('预测失败，请重试', 'error');
    } finally {
        // 恢复按钮状态
        if (btnElement) {
            btnElement.disabled = false;
            btnElement.classList.remove('predict-loading');
            btnElement.innerHTML = `
                <svg class="predict-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 16v-4"></path>
                    <path d="M12 8h.01"></path>
                </svg>
                <span class="predict-text">预测关联</span>
            `;
        }
    }
}

// 清除预测状态（仅数据）
function clearPredictions() {
    currentPredictions = [];
    predictionLinks = [];
}

// 获取置信度颜色
function getConfidenceColor(confidence) {
    if (confidence >= 0.8) return '#27ae60';
    if (confidence >= 0.5) return '#f39c12';
    return '#e74c3c';
}

// 显示预测面板
function showPredictionPanel(predictions) {
    const detailContent = document.getElementById('detailContent');
    if (!detailContent) return;
    
    const html = `
        <div class="prediction-section" id="predictionPanel">
            <div class="prediction-header">
                <div class="prediction-title-wrap">
                    <span class="prediction-label">联想</span>
                    <span class="prediction-subtitle">基于现有记忆的延伸</span>
                </div>
                <button class="btn-reject-all" onclick="rejectAllPredictions()">×</button>
            </div>
            <div class="prediction-list">
                ${predictions.map((p, idx) => `
                    <div class="prediction-item" id="prediction-item-${idx}" onclick="adoptPrediction(${idx})">
                        <div class="prediction-marker" style="background: ${getConfidenceColor(p.confidence)}"></div>
                        <div class="prediction-info">
                            <div class="prediction-name">${p.name}</div>
                            <div class="prediction-meta-line">
                                ${p.type} · ${p.relation}
                                <span class="prediction-confidence" style="color: ${getConfidenceColor(p.confidence)}">
                                    概率 ${Math.round(p.confidence * 100)}%
                                </span>
                            </div>
                            <div class="prediction-reason">${p.reason}</div>
                        </div>
                        <button class="btn-adopt" onclick="event.stopPropagation(); adoptPrediction(${idx})">
                            加入
                        </button>
                    </div>
                `).join('')}
            </div>
            <div class="prediction-footer">
                点击"加入"按钮添加到记忆网络
            </div>
        </div>
    `;
    
    // 插入到详情面板顶部
    const existingContent = detailContent.innerHTML;
    detailContent.innerHTML = html + existingContent;
}



// 采纳预测节点 - 轻量级直接添加
async function adoptPrediction(index) {
    const prediction = currentPredictions[index];
    if (!prediction) {
        console.error('[预测] 未找到预测数据, index:', index);
        return;
    }
    
    console.log('[预测] 采纳预测:', prediction.name, prediction);
    
    // 防止重复点击
    const itemEl = document.getElementById(`prediction-item-${index}`);
    if (itemEl && itemEl.classList.contains('adopted')) {
        return;
    }
    
    showToast(`正在添加 "${prediction.name}" 到图谱...`, 'info');
    
    try {
        // 使用轻量级 API 直接添加节点和关系，不经过 LLM 分析
        const response = await fetch('/api/graph/adopt-prediction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source_node_id: prediction.sourceNode.id,
                prediction: {
                    name: prediction.name,
                    type: prediction.type,
                    relation: prediction.relation,
                    reason: prediction.reason,
                    confidence: prediction.confidence
                }
            })
        });
        
        const result = await response.json();
        console.log('[预测] API 响应:', result);
        
        if (result.success) {
            showToast(`已成功添加 "${prediction.name}"`, 'success');
            
            // 标记为已采纳（视觉反馈）
            if (itemEl) {
                itemEl.classList.add('adopted');
                itemEl.style.opacity = '0.5';
                itemEl.style.pointerEvents = 'none';
            }
            
            // 刷新图谱显示新节点
            console.log('[预测] 刷新图谱...');
            await loadGraphData();
            console.log('[预测] 图谱刷新完成');
            
            // 高亮新添加的节点
            if (result.data && result.data.entity_id) {
                const newNodeId = result.data.entity_id;
                const newNode = graphData.nodes.find(n => n.id === newNodeId);
                if (newNode) {
                    console.log('[预测] 选中新节点:', newNode.name);
                    // 显示详情面板
                    if (typeof showNodeDetail === 'function') {
                        showNodeDetail(newNode);
                    }
                    // 在图谱中高亮节点（使用 D3）
                    setTimeout(() => {
                        d3.selectAll('.node-group').classed('selected', false);
                        d3.selectAll('.node-group').filter(d => d.id === newNodeId)
                            .classed('selected', true)
                            .select('circle')
                            .attr('stroke', '#E91E63')
                            .attr('stroke-width', 3);
                    }, 100);
                }
            }
            
            // 检查是否全部已采纳
            const remaining = currentPredictions.filter((p, i) => {
                const el = document.getElementById(`prediction-item-${i}`);
                return el && !el.classList.contains('adopted');
            });
            
            if (remaining.length === 0) {
                // 全部采纳完毕，延迟后清除面板
                setTimeout(() => {
                    rejectAllPredictions();
                    showToast('全部预测已采纳', 'success');
                }, 1500);
            }
        } else {
            console.error('[预测] API 返回失败:', result.message);
            showToast('添加失败: ' + result.message, 'error');
        }
    } catch (error) {
        console.error('[预测] 采纳预测失败:', error);
        showToast('添加失败，请重试', 'error');
    }
}

// 从图谱中移除单个预测节点
function removeSinglePrediction(index) {
    // 仅标记数据，图谱上不再显示预测节点
    // 保留函数供 adoptPrediction 调用
}

// 放弃全部预测
function rejectAllPredictions() {
    clearPredictions();
    // 移除预测面板
    const panel = document.getElementById('predictionPanel');
    if (panel) {
        panel.style.opacity = '0';
        setTimeout(() => panel.remove(), 300);
    }
    showToast('已放弃全部预测', 'info');
}

// 清除预测并刷新（保留函数供其他代码使用）
function clearPredictionsAndRefresh() {
    rejectAllPredictions();
}

// 在节点详情中显示预测按钮
// 注意：currentSelectedNode 变量在 app.js 中已定义，这里直接使用

// 修改 showNodeDetail 函数（需要在 app.js 中调用）
function onNodeSelectedForPrediction(node) {
    console.log('[预测] onNodeSelectedForPrediction 被调用', node.name);
    showPredictionButton(node);
}
