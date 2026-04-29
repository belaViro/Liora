/**
 * Liora i18n runtime.
 * Keeps UI language separate from user memory content.
 */
(function () {
    const STORAGE_KEY = 'lioraLanguage';
    const SUPPORTED_LANGUAGES = ['zh-CN', 'en-US'];

    const messages = {
        'zh-CN': {
            app: {
                title: 'Liora - 个人记忆网络',
                language: '语言'
            },
            lang: {
                zh: '中文',
                en: 'English'
            },
            time: {
                daysAgo: '{count} 天前',
                monthsAgo: '{count} 个月前',
                yearsAgo: '{count} 年前',
                yearsMonthsAgo: '{years} 年 {months} 个月前',
                activeDays: '{count} 天有记忆',
                streak: '连续记录 {count} 天 🔥',
                noMemoryToday: '今天还没记忆哦',
                unknown: '未知时间'
            },
            memory: {
                charCount: '{count} 字',
                linked: '关联记忆 ({count})',
                moreLinked: '还有 {count} 条记忆...',
                densityCount: '{count} 条记忆',
                noDetail: '暂无记忆详情',
                noMemories: '暂无记忆',
                loading: '加载中...',
                loadFailed: '加载失败',
                selectedFile: '已选择: {name} ({size})',
                detectedType: '（自动识别为{type}）',
                extractingType: '（自动识别为{type}，正在提取内容...）',
                extractedType: '（自动识别为{type}，已提取内容）'
            },
            fileType: {
                text: '文本',
                image: '图片',
                audio: '音频',
                video: '视频',
                unknown: '文件'
            },
            entityType: {
                PERSON: '人物',
                LOCATION: '地点',
                TIME: '时间',
                EVENT: '事件',
                OBJECT: '物品',
                CONCEPT: '概念',
                EMOTION: '情感',
                ENTITY: '实体'
            },
            relationType: {
                fallback: '相关'
            },
            detail: {
                nodeTitle: '节点详情',
                edgeTitle: '关系详情',
                name: '名称:',
                alias: '别名:',
                properties: '属性',
                description: '描述',
                relationStatement: '关系陈述',
                memoryDensity: '记忆密度:',
                temporalInfo: '时间信息:',
                inProgress: '开发中...',
                sourceNode: '源节点',
                targetNode: '目标节点',
                relation: '关系',
                unknown: '未知',
                selfLoopRelation: '自环关系',
                node: '节点'
            },
            action: {
                save: '保存记忆',
                saving: '保存中...',
                send: '发送',
                delete: '删除',
                edit: '修改',
                close: '关闭',
                downloadImage: '保存图片',
                explorePath: '探索关联路径',
                exploring: '探索中...',
                regenerateStory: '重新生成记忆故事'
            },
            toast: {
                cardGenerating: '正在生成卡片...',
                cardSaved: '卡片已保存',
                cardExportFailed: '导出失败，请重试',
                extractionFailed: '内容提取失败，请手动输入描述',
                contentRequired: '请填写内容或上传文件',
                memorySaved: '记忆保存成功！',
                saveFailed: '保存失败',
                saveNetworkFailed: '保存失败，请检查网络',
                searchFailed: '搜索失败',
                searchNetworkFailed: '搜索失败，请检查网络',
                entityNotFound: '未找到该实体',
                memoryDeleted: '记忆已删除',
                deleteFailed: '删除失败',
                deleteRetryFailed: '删除失败，请重试',
                updateFailed: '更新失败',
                entityUpdated: '实体已更新',
                relationUpdated: '关系已更新',
                relationDeleted: '关系已删除',
                relationDeleting: '正在删除关系...',
                invalidRelationId: '无效的关系ID',
                nodeNameRequired: '名称不能为空',
                deletingNode: '正在删除 "{name}"...',
                nodeDeleted: '"{name}" 已删除',
                duplicateNone: '未发现重复实体',
                merged: '已合并',
                mergeFailed: '合并失败',
                needNodeOrRelation: '请先选择一个节点或关系',
                needTwoNodes: '请先选择两个节点',
                personaOnlyPerson: '只有人物节点才能使用视角回忆',
                personaEntered: '🎭 洛忆已进入「{name}」视角',
                personaExited: '已退出视角模式',
                requestFailed: '请求失败: {message}',
                pathTargetSet: '已设置终点: {name}，点击"探索关联路径"',
                noDirectPath: '未找到直接关联路径',
                exportStarting: '正在导出记忆...',
                exported: '已导出 {count} 条记忆',
                exportFailed: '导出失败',
                importStarting: '正在导入记忆...',
                importInvalidFile: '文件格式错误：不是有效的 .loyi 文件',
                importJsonFailed: '文件格式错误：无法解析 JSON',
                importInvalidMemoryFile: '文件格式错误：不是有效的记忆文件',
                imported: '已导入 {count} 条记忆',
                importFailed: '导入失败: {message}',
                sampleLoading: '正在加载示例数据...',
                sampleInvalid: '示例数据文件格式错误',
                sampleLoaded: '已加载 {count} 条示例记忆',
                sampleFailed: '加载示例数据失败: {message}',
                edgeLabelsShown: '已显示边标签',
                edgeLabelsHidden: '已隐藏边标签'
            },
            confirm: {
                deleteMemory: '确定删除这条记忆吗？删除后无法恢复。',
                deleteRelation: '确定要删除这个关系吗？此操作不可恢复。',
                deleteNamedNode: '确定要删除实体 "{name}" 吗？\n\n注意：这将同时删除所有与该实体相关的关系。',
                deleteNamedRelation: '确定要删除这条关系吗？\n\n{source} → {target}',
                deleteSelfLoops: '确定要删除 {name} 的全部 {count} 条自环关系吗？此操作不可恢复。',
                mergeNode: '确定要将 "{name}" 合并到当前实体吗？\n\n此操作不可恢复。',
                loadSample: '确定要加载示例数据吗？这将添加示例记忆到现有数据中。'
            },
            ai: {
                replyLanguage: '请用中文回答。',
                storyPrompt: '请基于以下信息，创作一段关于"{target}"的记忆故事。这是用户记忆网络中的内容，请用第一人称"我"来叙述，像在回忆一段往事。文字要有情感、有画面感，控制在200字左右。',
                pathPrompt: '请解读以下关联路径，用侦探推理的方式描述这些节点如何联系在一起：\n{path}'
            },
            luoyi: {
                distracted: '抱歉，我刚才走神了... {message}',
                networkIssue: '网络有点问题，稍后再试试？',
                welcome1: '你好！我是洛忆，你记忆网络的小伙伴~',
                welcome2: '有什么想聊的，或者想回忆的？尽管问我吧！'
            },
            prediction: {
                button: '预测关联',
                thinking: '思考中',
                analyzing: '正在分析可能的关联节点...',
                found: '发现 {count} 个可能的关联',
                none: '暂无预测结果',
                failed: '预测失败，请重试',
                sectionTitle: '联想',
                subtitle: '基于现有记忆的延伸',
                confidence: '概率 {percent}%',
                adopt: '加入',
                footer: '点击"加入"按钮添加到记忆网络',
                adding: '正在添加 "{name}" 到图谱...',
                added: '已成功添加 "{name}"',
                allAdopted: '全部预测已采纳',
                addFailed: '添加失败，请重试',
                rejectedAll: '已放弃全部预测'
            }
        },
        'en-US': {
            app: {
                title: 'Liora - Personal Memory Network',
                language: 'Language'
            },
            lang: {
                zh: '中文',
                en: 'English'
            },
            time: {
                daysAgo: '{count} days ago',
                monthsAgo: '{count} months ago',
                yearsAgo: '{count} years ago',
                yearsMonthsAgo: '{years} years {months} months ago',
                activeDays: '{count} active days',
                streak: '{count}-day streak 🔥',
                noMemoryToday: 'No memories today yet',
                unknown: 'Unknown time'
            },
            memory: {
                charCount: '{count} chars',
                linked: 'Linked memories ({count})',
                moreLinked: '{count} more memories...',
                densityCount: '{count} memories',
                noDetail: 'No memory details yet',
                noMemories: 'No memories yet',
                loading: 'Loading...',
                loadFailed: 'Failed to load',
                selectedFile: 'Selected: {name} ({size})',
                detectedType: '(Detected as {type})',
                extractingType: '(Detected as {type}, extracting content...)',
                extractedType: '(Detected as {type}, content extracted)'
            },
            fileType: {
                text: 'Text',
                image: 'Image',
                audio: 'Audio',
                video: 'Video',
                unknown: 'File'
            },
            entityType: {
                PERSON: 'Person',
                LOCATION: 'Location',
                TIME: 'Time',
                EVENT: 'Event',
                OBJECT: 'Object',
                CONCEPT: 'Concept',
                EMOTION: 'Emotion',
                ENTITY: 'Entity'
            },
            relationType: {
                fallback: 'Related'
            },
            detail: {
                nodeTitle: 'Node Details',
                edgeTitle: 'Relation Details',
                name: 'Name:',
                alias: 'Aliases:',
                properties: 'Properties',
                description: 'Description',
                relationStatement: 'Relation Statement',
                memoryDensity: 'Memory density:',
                temporalInfo: 'Time:',
                inProgress: 'In progress...',
                sourceNode: 'Source',
                targetNode: 'Target',
                relation: 'Relation',
                unknown: 'Unknown',
                selfLoopRelation: 'Self-loop relation',
                node: 'Node'
            },
            action: {
                save: 'Save Memory',
                saving: 'Saving...',
                send: 'Send',
                delete: 'Delete',
                edit: 'Edit',
                close: 'Close',
                downloadImage: 'Save Image',
                explorePath: 'Explore Path',
                exploring: 'Exploring...',
                regenerateStory: 'Regenerate Story'
            },
            toast: {
                cardGenerating: 'Generating card...',
                cardSaved: 'Card saved',
                cardExportFailed: 'Export failed, please try again',
                extractionFailed: 'Content extraction failed. Please enter a description.',
                contentRequired: 'Enter content or upload a file',
                memorySaved: 'Memory saved',
                saveFailed: 'Save failed',
                saveNetworkFailed: 'Save failed. Check your network.',
                searchFailed: 'Search failed',
                searchNetworkFailed: 'Search failed. Check your network.',
                entityNotFound: 'Entity not found',
                memoryDeleted: 'Memory deleted',
                deleteFailed: 'Delete failed',
                deleteRetryFailed: 'Delete failed, please try again',
                updateFailed: 'Update failed',
                entityUpdated: 'Entity updated',
                relationUpdated: 'Relation updated',
                relationDeleted: 'Relation deleted',
                relationDeleting: 'Deleting relation...',
                invalidRelationId: 'Invalid relation ID',
                nodeNameRequired: 'Name is required',
                deletingNode: 'Deleting "{name}"...',
                nodeDeleted: '"{name}" deleted',
                duplicateNone: 'No duplicate entities found',
                merged: 'Merged',
                mergeFailed: 'Merge failed',
                needNodeOrRelation: 'Select a node or relation first',
                needTwoNodes: 'Select two nodes first',
                personaOnlyPerson: 'Persona recall only works for person nodes',
                personaEntered: '🎭 Luoyi is now recalling as "{name}"',
                personaExited: 'Exited persona mode',
                requestFailed: 'Request failed: {message}',
                pathTargetSet: 'Target set: {name}. Click "Explore Path".',
                noDirectPath: 'No direct relation path found',
                exportStarting: 'Exporting memories...',
                exported: 'Exported {count} memories',
                exportFailed: 'Export failed',
                importStarting: 'Importing memories...',
                importInvalidFile: 'File format error: not a valid .loyi file',
                importJsonFailed: 'File format error: could not parse JSON',
                importInvalidMemoryFile: 'File format error: not a valid memory file',
                imported: 'Imported {count} memories',
                importFailed: 'Import failed: {message}',
                sampleLoading: 'Loading sample data...',
                sampleInvalid: 'Sample data file format error',
                sampleLoaded: 'Loaded {count} sample memories',
                sampleFailed: 'Failed to load sample data: {message}',
                edgeLabelsShown: 'Edge labels shown',
                edgeLabelsHidden: 'Edge labels hidden'
            },
            confirm: {
                deleteMemory: 'Delete this memory? This cannot be undone.',
                deleteRelation: 'Delete this relation? This cannot be undone.',
                deleteNamedNode: 'Delete entity "{name}"?\n\nThis will also delete all relations linked to it.',
                deleteNamedRelation: 'Delete this relation?\n\n{source} → {target}',
                deleteSelfLoops: 'Delete all {count} self-loop relations for {name}? This cannot be undone.',
                mergeNode: 'Merge "{name}" into the current entity?\n\nThis cannot be undone.',
                loadSample: 'Load sample data? This will add sample memories to your existing data.'
            },
            ai: {
                replyLanguage: 'Please answer in English.',
                storyPrompt: 'Based on the information below, write a memory story about "{target}". This comes from the user\'s memory network. Use first person "I", as if recalling a past moment. Make it vivid and emotional, around 200 words.',
                pathPrompt: 'Interpret the relation path below like a detective, explaining how these nodes connect:\n{path}'
            },
            luoyi: {
                distracted: 'Sorry, I lost my train of thought... {message}',
                networkIssue: 'The network seems unstable. Try again later?',
                welcome1: 'Hi, I am Luoyi, your memory network companion.',
                welcome2: 'Ask me anything you want to revisit or talk through.'
            },
            prediction: {
                button: 'Predict Links',
                thinking: 'Thinking',
                analyzing: 'Analyzing possible related nodes...',
                found: 'Found {count} possible links',
                none: 'No predictions yet',
                failed: 'Prediction failed, please try again',
                sectionTitle: 'Associations',
                subtitle: 'Extensions from existing memories',
                confidence: '{percent}% likely',
                adopt: 'Add',
                footer: 'Click "Add" to add it to the memory network',
                adding: 'Adding "{name}" to the graph...',
                added: 'Added "{name}"',
                allAdopted: 'All predictions adopted',
                addFailed: 'Add failed, please try again',
                rejectedAll: 'All predictions dismissed'
            }
        }
    };

    const exactPairs = [
        ['正在唤醒记忆网络...', 'Waking the memory network...'],
        ['记忆网络', 'Memory Network'],
        ['收起/展开侧边栏', 'Collapse/expand sidebar'],
        ['全部', 'All'],
        ['人物', 'People'],
        ['地点', 'Places'],
        ['事件', 'Events'],
        ['情感', 'Emotions'],
        ['重置', 'Reset'],
        ['标签', 'Labels'],
        ['显示边标签', 'Show edge labels'],
        ['导出', 'Export'],
        ['导出记忆', 'Export memories'],
        ['导入', 'Import'],
        ['导入记忆', 'Import memories'],
        ['示例', 'Sample'],
        ['加载示例数据', 'Load sample data'],
        ['图例', 'Legend'],
        ['详情', 'Details'],
        ['探索', 'Explore'],
        ['问一个问题...', 'Ask a question...'],
        ['发送', 'Send'],
        ['删除记忆', 'Delete memory'],
        ['生成精美卡片', 'Create card'],
        ['分享卡片', 'Share card'],
        ['正在生成摘要...', 'Generating summary...'],
        ['这个细节我还记得。', 'I still remember this detail.'],
        ['挺好的。', 'That was nice.'],
        ['这是谁？', 'Who is this?'],
        ['记忆来源', 'Memory source'],
        ['相关事件', 'Related events'],
        ['总结此人', 'Summarize this person'],
        ['生成记忆故事', 'Generate Memory Story'],
        ['以此人视角回忆', 'Recall as this person'],
        ['退出', 'Exit'],
        ['Liora · 记忆网络', 'Liora · Memory Network'],
        ['这不是一本日记，而是一座', 'This is not a diary, but a '],
        ['不断生长的记忆宫殿', 'growing memory palace'],
        ['每一段文字、每一张照片、每一段声音，都是神经元般的节点。AI 自动抽取实体、编织关系，让你的记忆从碎片变成网络。', 'Every note, photo, and sound becomes a node. AI extracts entities and weaves relations so fragments become a network.'],
        ['在这里，', 'Here, '],
        ['遗忘是一种选择，而非命运', 'forgetting becomes a choice, not fate'],
        ['。跨时间、跨空间、跨情感，Liora 帮你发现那些隐秘却动人的联系。', '. Across time, space, and emotion, Liora helps reveal hidden connections.'],
        ['从「记得」到「联想」，从「记录」到「预知」。', 'From remembering to associating, from recording to anticipating.'],
        ['欢迎来到你的', 'Welcome to your '],
        ['第二大脑', 'second brain'],
        ['开启记忆之旅', 'Start the Journey'],
        ['洛忆', 'Luoyi'],
        ['记忆织网者', 'Memory Weaver'],
        ['你的第二大脑', 'Your Second Brain'],
        ['从碎片到图谱，从遗忘到预知', 'From fragments to graph, from forgetting to foresight'],
        ['让每一次记录都成为未来灵感的伏笔', 'Turn every record into a future cue'],
        ['知识图谱', 'Knowledge Graph'],
        ['D3.js 力导向图谱，可视化你的"思维神经元"，拖拽缩放探索记忆网络', 'A D3.js force graph visualizes your mental nodes with drag and zoom exploration.'],
        ['多模态录入', 'Multimodal Capture'],
        ['文字/图片/音频，AI 自动解析实体与隐秘关联，@关联人物 #标记主题', 'Text, images, and audio with AI entity extraction, @mentions, and #topics.'],
        ['混合搜索', 'Hybrid Search'],
        ['FAISS 向量 + BM25 关键词，既懂语义又懂精准，多角度找回记忆', 'Vector and keyword retrieval help recall memories from multiple angles.'],
        ['记忆探索', 'Memory Exploration'],
        ['沿时间线顺藤摸瓜，AI 推理还原完整故事链，发现隐秘联系', 'Trace timelines and let AI reconstruct story chains and hidden links.'],
        ['AI 洛忆', 'AI Luoyi'],
        ['懂你情绪的智能伙伴，支持第一人称视角代述，像老友一样回应', 'An emotional memory companion with first-person recall and friend-like replies.'],
        ['智能预测', 'Smart Prediction'],
        ['基于图谱拓扑结构，预言你可能遗忘的关联，补全记忆盲区', 'Predict overlooked associations from graph topology and fill memory gaps.'],
        ['.loyi 归档', '.loyi Archive'],
        ['完整备份与迁移，数据主权属于你，一键导入导出', 'Full backup and migration with one-click import/export. Your data remains yours.'],
        ['"时间会流逝，但织网永存。"', '"Time passes, but the weave remains."'],
        ['保存图片', 'Save Image'],
        ['关闭', 'Close'],
        ['搜索你的记忆..', 'Search your memories...'],
        ['搜索', 'Search'],
        ['历史上的今天', 'On This Day'],
        ['时光', 'Time'],
        ['打开菜单', 'Open menu'],
        ['关闭菜单', 'Close menu'],
        ['菜单', 'Menu'],
        ['录入记忆', 'Create'],
        ['记忆列表', 'Memories'],
        ['统计', 'Stats'],
        ['内容描述', 'Content'],
        ['0 字', '0 chars'],
        ['上传文件（可选）', 'Upload file (optional)'],
        ['点击或拖拽文件到这里（自动识别类型）', 'Click or drag a file here (type detected automatically)'],
        ['保存记忆', 'Save Memory'],
        ['搜索记忆...', 'Search memories...'],
        ['记忆详情', 'Memory Details'],
        ['记忆总数', 'Memories'],
        ['实体数量', 'Entities'],
        ['关系数量', 'Relations'],
        ['今日新记忆', 'Today'],
        ['记忆活动热力', 'Memory Activity'],
        ['少', 'Less'],
        ['多', 'More'],
        ['实体类型分布', 'Entity Types'],
        ['加载中...', 'Loading...'],
        ['情感分布', 'Emotion'],
        ['😊 积极', '😊 Positive'],
        ['😐 中性', '😐 Neutral'],
        ['😔 消极', '😔 Negative'],
        ['关系类型', 'Relation Types'],
        ['历史上的今天', 'On This Day'],
        ['正在唤醒沉睡的记忆..', 'Waking sleeping memories...'],
        ['还没有记忆', 'No memories yet'],
        ['开始记录你的第一条记忆', 'Start with your first memory'],
        ['选中节点', 'Selected Node'],
        ['关联记忆', 'Linked memories'],
        ['连接节点', 'Connected nodes'],
        ['问答探索', 'Q&A Exploration'],
        ['问关于此节点的任何问题', 'Ask anything about this node'],
        ['AI 将基于记忆网络回答', 'AI will answer from your memory network'],
        ['快捷提示', 'Quick Prompts'],
        ['关系路径探索', 'Relation Path'],
        ['起点', 'Start'],
        ['终点', 'Target'],
        ['探索关联路径', 'Explore Path'],
        ['记忆故事', 'Memory Story'],
        ['生成关于此节点的记忆故事', 'Generate a story for this node'],
        ['记忆伙伴 · 在线', 'Memory companion · online'],
        ['和洛忆聊聊...', 'Chat with Luoyi...'],
        ['点击快捷按钮或输入问题探索此节点', 'Use a quick prompt or ask about this node'],
        ['点击快捷按钮或输入问题探索此关系', 'Use a quick prompt or ask about this relation'],
        ['输入 @ 可提取人物，# 可标记主题', 'Use @ to extract people, # to tag topics'],
        ['记录你的想法、感受或事件..', 'Record a thought, feeling, or event...']
    ];

    const exactIndex = new Map();
    exactPairs.forEach(([zh, en]) => {
        exactIndex.set(zh, { 'zh-CN': zh, 'en-US': en });
        exactIndex.set(en, { 'zh-CN': zh, 'en-US': en });
    });

    function getLanguage() {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (SUPPORTED_LANGUAGES.includes(saved)) return saved;
        return 'zh-CN';
    }

    function locale() {
        return getLanguage();
    }

    function readPath(source, path) {
        return path.split('.').reduce((obj, part) => (obj && obj[part] !== undefined ? obj[part] : undefined), source);
    }

    function interpolate(template, params) {
        return String(template).replace(/\{(\w+)\}/g, (_, key) => (
            params && params[key] !== undefined ? params[key] : `{${key}}`
        ));
    }

    function t(key, params = {}) {
        const lang = getLanguage();
        const value = readPath(messages[lang], key) ?? readPath(messages['zh-CN'], key) ?? key;
        return interpolate(value, params);
    }

    function tr(value) {
        if (value === null || value === undefined) return value;
        const text = String(value);
        const entry = exactIndex.get(text.trim());
        if (!entry) return value;
        return entry[getLanguage()];
    }

    function translateTextNodes(root) {
        if (!root || !root.ownerDocument) return;
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                if (['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT'].includes(parent.tagName)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });

        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            const value = node.nodeValue;
            const trimmed = value.trim();
            const translated = tr(trimmed);
            if (translated === trimmed) return;
            const prefix = value.match(/^\s*/)[0];
            const suffix = value.match(/\s*$/)[0];
            node.nodeValue = `${prefix}${translated}${suffix}`;
        });
    }

    function translateAttributes(root) {
        if (!root || !root.querySelectorAll) return;
        root.querySelectorAll('[placeholder], [title], [aria-label], [data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-aria-label]').forEach(el => {
            const textKey = el.getAttribute('data-i18n');
            const placeholderKey = el.getAttribute('data-i18n-placeholder');
            const titleKey = el.getAttribute('data-i18n-title');
            const ariaKey = el.getAttribute('data-i18n-aria-label');

            if (textKey) el.textContent = t(textKey);
            if (placeholderKey) el.setAttribute('placeholder', t(placeholderKey));
            if (titleKey) el.setAttribute('title', t(titleKey));
            if (ariaKey) el.setAttribute('aria-label', t(ariaKey));

            ['placeholder', 'title', 'aria-label'].forEach(attr => {
                if (!el.hasAttribute(attr)) return;
                const current = el.getAttribute(attr);
                const translated = tr(current);
                if (translated !== current) el.setAttribute(attr, translated);
            });
        });
    }

    let applying = false;
    function applyI18n(root = document) {
        if (applying) return;
        applying = true;
        try {
            const lang = getLanguage();
            document.documentElement.lang = lang;
            document.title = t('app.title');
            translateAttributes(root);
            translateTextNodes(root.body ? root.body : root);
            updateLanguageSwitch();
        } finally {
            applying = false;
        }
    }

    function updateLanguageSwitch() {
        document.querySelectorAll('[data-lang-choice]').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('data-lang-choice') === getLanguage());
        });
    }

    function setLanguage(lang) {
        if (!SUPPORTED_LANGUAGES.includes(lang)) return;
        const previous = getLanguage();
        localStorage.setItem(STORAGE_KEY, lang);
        applyI18n();
        if (previous !== lang) {
            document.dispatchEvent(new CustomEvent('languagechange', { detail: { language: lang } }));
        }
    }

    function toggleLanguage() {
        setLanguage(getLanguage() === 'zh-CN' ? 'en-US' : 'zh-CN');
    }

    function isEnglish() {
        return getLanguage() === 'en-US';
    }

    function currentAiLanguage() {
        return isEnglish() ? 'English' : 'Chinese';
    }

    function startObserver() {
        if (!document.body || !window.MutationObserver) return;
        const observer = new MutationObserver(mutations => {
            if (applying) return;
            const shouldApply = mutations.some(m => m.addedNodes && m.addedNodes.length > 0);
            if (shouldApply) {
                requestAnimationFrame(() => applyI18n());
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    window.i18n = {
        t,
        tr,
        locale,
        getLanguage,
        setLanguage,
        toggleLanguage,
        applyI18n,
        isEnglish,
        currentAiLanguage
    };

    window.t = t;
    window.tr = tr;
    window.setAppLanguage = setLanguage;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applyI18n();
            startObserver();
        });
    } else {
        applyI18n();
        startObserver();
    }
})();
