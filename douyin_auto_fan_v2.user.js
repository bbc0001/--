// ==UserScript==
// @name         抖音自动刷视频收藏助手
// @namespace    douyin-autofan
// @version      2.0
// @description  自动刷抖音推荐流视频，按点赞数和发布时间分类收藏到指定收藏夹
// @author       AutoFan
// @match        https://www.douyin.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        // A级：7天内 + 30万~80万点赞
        A_LEVEL_MIN_LIKES: 300000,
        A_LEVEL_MAX_LIKES: 800000,
        A_LEVEL_DAYS: 7,
        A_LEVEL_FOLDER: 'A级待分类',
        
        // S级：7天外+80万以上点赞，或者100万点赞以上（不受时间限制）
        S_LEVEL_MIN_LIKES: 800000,
        S_LEVEL_DAYS: 7,
        S_LEVEL_FOLDER: 'S级待分类',
        
        CHECK_INTERVAL: 1000,
        VIDEO_END_DELAY: 1500,
        COLLECTION_DELAY: 500
    };

    let isProcessing = false;
    let controlPanel = null;
    let stats = {
        skipped: 0,
        aLevel: 0,
        sLevel: 0,
        errors: 0
    };

    function init() {
        console.log('[抖音自动助手 v2.0] 脚本已启动');
        console.log('📌 A级分类：7天内发布 + 30万~80万点赞 → 收藏到"A级待分类"');
        console.log('📌 S级分类：7天以上发布 + 80万以上点赞 或 100万点赞以上 → 收藏到"S级待分类"');
        
        createControlPanel();
        setupObserver();
        startMonitoring();
    }

    function createControlPanel() {
        controlPanel = document.createElement('div');
        controlPanel.id = 'douyin-autofan-panel';
        controlPanel.innerHTML = `
            <style>
                #douyin-autofan-panel {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    color: white;
                    padding: 16px 20px;
                    border-radius: 14px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 13px;
                    z-index: 999999;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.4);
                    min-width: 280px;
                    border: 1px solid rgba(255, 255, 255, 0.1);
                }
                #douyin-autofan-panel h3 {
                    margin: 0 0 12px 0;
                    font-size: 15px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                #douyin-autofan-panel .rule-box {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                    padding: 10px 12px;
                    margin-bottom: 10px;
                    font-size: 11px;
                    line-height: 1.6;
                }
                #douyin-autofan-panel .rule-box .rule-title {
                    font-weight: 600;
                    margin-bottom: 6px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                #douyin-autofan-panel .rule-box .A级 { color: #fbbf24; }
                #douyin-autofan-panel .rule-box .S级 { color: #f472b6; }
                #douyin-autofan-panel .status {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 12px;
                    padding: 10px 12px;
                    background: rgba(255, 255, 255, 0.08);
                    border-radius: 8px;
                }
                #douyin-autofan-panel .status-dot {
                    width: 10px;
                    height: 10px;
                    border-radius: 50%;
                    background: #4ade80;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.2); }
                }
                #douyin-autofan-panel .video-info {
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                    padding: 10px 12px;
                    margin-bottom: 12px;
                    font-size: 12px;
                }
                #douyin-autofan-panel .video-info .row {
                    display: flex;
                    justify-content: space-between;
                    padding: 4px 0;
                }
                #douyin-autofan-panel .video-info .label { color: #94a3b8; }
                #douyin-autofan-panel .video-info .value { font-weight: 600; }
                #douyin-autofan-panel .video-info .A级-value { color: #fbbf24; }
                #douyin-autofan-panel .video-info .S级-value { color: #f472b6; }
                #douyin-autofan-panel .video-info .skip-value { color: #94a3b8; }
                #douyin-autofan-panel .stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                }
                #douyin-autofan-panel .stat-item {
                    background: rgba(255, 255, 255, 0.05);
                    padding: 10px;
                    border-radius: 8px;
                    text-align: center;
                }
                #douyin-autofan-panel .stat-value {
                    font-size: 20px;
                    font-weight: 700;
                }
                #douyin-autofan-panel .stat-label {
                    font-size: 10px;
                    opacity: 0.7;
                    margin-top: 4px;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                #douyin-autofan-panel button {
                    width: 100%;
                    padding: 10px;
                    margin-top: 12px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s;
                    background: #ef4444;
                    color: white;
                }
                #douyin-autofan-panel button:hover {
                    background: #dc2626;
                }
            </style>
            <h3>🎬 抖音自动收藏助手 v2.0</h3>
            
            <div class="rule-box">
                <div class="rule-title"><span class="A级">⭐ A级</span> 7天内 · 30万~80万点赞</div>
                <div>收藏到: "A级待分类"</div>
            </div>
            <div class="rule-box">
                <div class="rule-title"><span class="S级">🌟 S级</span> 7天外+80万 或 100万以上</div>
                <div>收藏到: "S级待分类"</div>
            </div>
            
            <div class="status">
                <div class="status-dot"></div>
                <span id="status-text">正在扫描视频...</span>
            </div>
            
            <div class="video-info">
                <div class="row">
                    <span class="label">当前点赞</span>
                    <span class="value" id="current-likes">--</span>
                </div>
                <div class="row">
                    <span class="label">发布时间</span>
                    <span class="value" id="current-time">--</span>
                </div>
                <div class="row">
                    <span class="label">判断结果</span>
                    <span class="value" id="result-text">--</span>
                </div>
            </div>
            
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-value A级-value" id="a-level-count">0</div>
                    <div class="stat-label">A级收藏</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value S级-value" id="s-level-count">0</div>
                    <div class="stat-label">S级收藏</div>
                </div>
            </div>
            
            <button id="stop-btn">⏹ 停止脚本</button>
        `;

        document.body.appendChild(controlPanel);

        document.getElementById('stop-btn').addEventListener('click', () => {
            if (controlPanel) {
                controlPanel.remove();
                controlPanel = null;
            }
            console.log('[抖音自动助手] 脚本已停止');
        });
    }

    function updateStatus(text) {
        const element = document.getElementById('status-text');
        if (element) element.textContent = text;
    }

    function updateVideoInfo(likes, timeAgo, result, resultClass) {
        const likesEl = document.getElementById('current-likes');
        const timeEl = document.getElementById('current-time');
        const resultEl = document.getElementById('result-text');
        
        if (likesEl) likesEl.textContent = likes;
        if (timeEl) timeEl.textContent = timeAgo;
        if (resultEl) {
            resultEl.textContent = result;
            resultEl.className = 'value ' + resultClass;
        }
    }

    function incrementStat(type) {
        const element = document.getElementById(`${type}-level-count`);
        if (element) {
            const current = parseInt(element.textContent) || 0;
            element.textContent = current + 1;
        }
    }

    function formatNumber(num) {
        if (!num || isNaN(num)) return '0';
        if (num >= 100000000) return (num / 100000000).toFixed(1) + '亿';
        if (num >= 10000) return (num / 10000).toFixed(1) + '万';
        return num.toLocaleString();
    }

    function parseLikeCount(likeString) {
        if (!likeString) return 0;
        const cleaned = likeString.replace(/[,，]/g, '').trim();
        let match = cleaned.match(/^([\d.]+)/);
        if (!match) return 0;

        let num = parseFloat(match[1]);
        if (cleaned.includes('亿')) {
            num *= 100000000;
        } else if (cleaned.includes('万')) {
            num *= 10000;
        }
        return Math.floor(num);
    }

    function parseTimeAgo(timeString) {
        if (!timeString) return null;
        
        const seconds = timeString.match(/(\d+)\s*秒/)?.[1];
        if (seconds) return { value: parseInt(seconds), unit: 'second' };
        
        const minutes = timeString.match(/(\d+)\s*分钟/)?.[1];
        if (minutes) return { value: parseInt(minutes), unit: 'minute' };
        
        const hours = timeString.match(/(\d+)\s*小时/)?.[1];
        if (hours) return { value: parseInt(hours), unit: 'hour' };
        
        const days = timeString.match(/(\d+)\s*天/)?.[1];
        if (days) return { value: parseInt(days), unit: 'day' };
        
        const weeks = timeString.match(/(\d+)\s*周/)?.[1];
        if (weeks) return { value: parseInt(weeks), unit: 'week' };
        
        const months = timeString.match(/(\d+)\s*个月/)?.[1];
        if (months) return { value: parseInt(months), unit: 'month' };
        
        return null;
    }

    function getDaysAgo(timeAgo) {
        if (!timeAgo) return Infinity;
        
        const parsed = parseTimeAgo(timeAgo);
        if (!parsed) return Infinity;
        
        switch (parsed.unit) {
            case 'second': return parsed.value / 86400;
            case 'minute': return parsed.value / 1440;
            case 'hour': return parsed.value / 24;
            case 'day': return parsed.value;
            case 'week': return parsed.value * 7;
            case 'month': return parsed.value * 30;
            default: return Infinity;
        }
    }

    function getVideoElement() {
        return document.querySelector('video');
    }

    function getLikeElement() {
        const selectors = [
            '[data-e2e="like-count"]',
            '.like-count-num',
            '[class*="like-count"]',
            'span[class*="like"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent && /\d/.test(element.textContent)) {
                return element;
            }
        }

        const allSpans = document.querySelectorAll('span');
        for (const span of allSpans) {
            const text = span.textContent.trim();
            if (/^\d+(\.\d+)?[万亿]?$/.test(text) && span.offsetParent !== null) {
                const parent = span.closest('[class*="action"]');
                if (parent || span.className.includes('like')) {
                    return span;
                }
            }
        }

        return null;
    }

    function getTimeElement() {
        const selectors = [
            '[data-e2e="video-time"]',
            '.video-time',
            'time',
            '[class*="time"]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent && element.textContent.trim()) {
                const text = element.textContent.trim();
                if (text.match(/\d+\s*[秒分时天周个]/)) {
                    return element;
                }
            }
        }

        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            const text = el.textContent.trim();
            if (text.match(/^\d+\s*(秒|分钟|小时|天|周|个月)前$/) && el.offsetParent !== null) {
                const parent = el.parentElement;
                if (parent && (parent.className.includes('info') || parent.className.includes('desc'))) {
                    return el;
                }
            }
        }

        return null;
    }

    function isVideoPlaying(video) {
        return video && !video.paused && !video.ended && video.readyState > 2;
    }

    function waitForVideoEnd(video) {
        return new Promise((resolve) => {
            let resolved = false;
            
            const handleEnded = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve();
                }
            };

            const handlePause = () => {
                setTimeout(() => {
                    if (!resolved && video.ended) {
                        handleEnded();
                    }
                }, 200);
            };

            const cleanup = () => {
                video.removeEventListener('ended', handleEnded);
                video.removeEventListener('pause', handlePause);
            };

            video.addEventListener('ended', handleEnded);
            video.addEventListener('pause', handlePause);

            setTimeout(() => {
                if (!resolved) {
                    cleanup();
                    resolve();
                }
            }, 120000);
        });
    }

    async function clickLikeButton() {
        const likeButton = document.querySelector('[data-e2e="like-button"]');
        if (likeButton) {
            likeButton.click();
            console.log('[抖音自动助手] 👍 点赞成功');
            return true;
        }

        const likeIcons = document.querySelectorAll('[class*="like-icon"]');
        for (const icon of likeIcons) {
            const button = icon.closest('[class*="action"]') || icon.closest('div[tabindex]');
            if (button && button.offsetParent !== null) {
                button.click();
                console.log('[抖音自动助手] 👍 点赞成功');
                return true;
            }
        }

        return false;
    }

    async function clickCollectButton(folderName) {
        await new Promise(resolve => setTimeout(resolve, CONFIG.COLLECTION_DELAY));

        const bookmarkButton = document.querySelector('[data-e2e="bookmark-button"]');
        if (bookmarkButton) {
            bookmarkButton.click();
            console.log(`[抖音自动助手] 📌 收藏按钮已点击`);
            
            await new Promise(resolve => setTimeout(resolve, 800));
            
            const folderOption = findFolderOption(folderName);
            if (folderOption) {
                folderOption.click();
                console.log(`[抖音自动助手] ✅ 已收藏到"${folderName}"`);
                return true;
            }
        }

        const bookmarkIcons = document.querySelectorAll('[class*="bookmark"], [class*="collect"]');
        for (const icon of bookmarkIcons) {
            if (!icon.offsetParent) continue;
            
            const button = icon.closest('[class*="action"]') || icon.closest('div[tabindex]');
            if (button) {
                button.click();
                console.log(`[抖音自动助手] 📌 收藏按钮已点击`);
                
                await new Promise(resolve => setTimeout(resolve, 800));
                
                const folderOption = findFolderOption(folderName);
                if (folderOption) {
                    folderOption.click();
                    console.log(`[抖音自动助手] ✅ 已收藏到"${folderName}"`);
                    return true;
                }
                return true;
            }
        }

        console.log('[抖音自动助手] ⚠️ 未找到收藏按钮');
        return false;
    }

    function findFolderOption(folderName) {
        const options = document.querySelectorAll('[class*="option"], [class*="item"], div[role="option"]');
        for (const option of options) {
            if (option.textContent.includes(folderName)) {
                return option;
            }
        }

        const allDivs = document.querySelectorAll('div[role="menu"] div, div[class*="dropdown"] div, div[class*="popup"] div');
        for (const div of allDivs) {
            if (div.textContent.trim() === folderName) {
                return div;
            }
        }

        return null;
    }

    async function autoPlayVideo() {
        const video = getVideoElement();
        if (!video || video.src === 'null' || !video.src) return false;

        if (video.paused) {
            try {
                video.muted = false;
                await video.play();
                console.log('[抖音自动助手] ▶️ 视频开始播放');
                return true;
            } catch (error) {
                console.log('[抖音自动助手] 自动播放需要用户交互');
                return false;
            }
        }
        return true;
    }

    function getCurrentVideoData() {
        const likeElement = getLikeElement();
        const timeElement = getTimeElement();
        
        const likes = likeElement ? parseLikeCount(likeElement.textContent) : 0;
        const timeAgo = timeElement ? timeElement.textContent.trim() : '';
        const daysAgo = getDaysAgo(timeAgo);
        
        return { likes, timeAgo, daysAgo };
    }

    function classifyVideo(likes, daysAgo) {
        // S级优先：如果点赞>=100万，直接S级
        if (likes >= 1000000) {
            return 'S';
        }
        
        // S级：7天以外 + 80万以上点赞
        if (daysAgo > CONFIG.S_LEVEL_DAYS && likes >= CONFIG.S_LEVEL_MIN_LIKES) {
            return 'S';
        }
        
        // A级：7天以内 + 30万~80万点赞
        if (daysAgo <= CONFIG.A_LEVEL_DAYS && 
            likes >= CONFIG.A_LEVEL_MIN_LIKES && 
            likes < CONFIG.A_LEVEL_MAX_LIKES) {
            return 'A';
        }
        
        return 'skip';
    }

    function getClassificationResult(likes, daysAgo) {
        const classification = classifyVideo(likes, daysAgo);
        
        if (classification === 'S') {
            return { text: '🌟 S级候选', class: 'S级-value' };
        }
        if (classification === 'A') {
            return { text: '⭐ A级候选', class: 'A级-value' };
        }
        
        let reason = '';
        if (likes < 300000) {
            reason = `点赞不足30万`;
        } else if (likes >= 800000 && daysAgo <= 7) {
            reason = `7天内超80万，归S级`;
        } else if (daysAgo > 7 && likes < 800000) {
            reason = `7天外需80万+`;
        } else {
            reason = '不满足条件';
        }
        
        return { text: `跳过 (${reason})`, class: 'skip-value' };
    }

    let lastVideoSrc = '';

    async function processCurrentVideo() {
        if (isProcessing) return;
        
        const video = getVideoElement();
        if (!video || !video.src || video.src === 'null') return;

        const currentSrc = video.src;
        if (currentSrc === lastVideoSrc) return;
        lastVideoSrc = currentSrc;

        isProcessing = true;
        updateStatus('正在分析视频...');

        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await autoPlayVideo();

        const { likes, timeAgo, daysAgo } = getCurrentVideoData();
        
        console.log(`[抖音自动助手] 视频数据 - 点赞: ${formatNumber(likes)}, 发布时间: ${timeAgo || '未知'}`);
        
        updateVideoInfo(formatNumber(likes), timeAgo || '未知', '分析中...', '');

        const classification = classifyVideo(likes, daysAgo);
        const result = getClassificationResult(likes, daysAgo);
        updateVideoInfo(formatNumber(likes), timeAgo || '未知', result.text, result.class);

        if (classification === 'skip') {
            console.log(`[抖音自动助手] ⏭️ 跳过: 不满足收藏条件`);
            updateStatus('不满足条件，等待下一条...');
            isProcessing = false;
            return;
        }

        const folderName = classification === 'S' ? CONFIG.S_LEVEL_FOLDER : CONFIG.A_LEVEL_FOLDER;
        const levelName = classification === 'S' ? 'S级' : 'A级';
        
        updateStatus(`${levelName}视频，准备播放...`);

        if (!isVideoPlaying(video)) {
            await autoPlayVideo();
        }

        await waitForVideoEnd(video);
        await new Promise(resolve => setTimeout(resolve, CONFIG.VIDEO_END_DELAY));

        updateStatus(`${levelName}视频播放完成，执行收藏...`);

        const liked = await clickLikeButton();
        if (!liked) {
            console.log('[抖音自动助手] ❌ 点赞失败');
            stats.errors++;
            isProcessing = false;
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 300));

        const collected = await clickCollectButton(folderName);
        if (collected) {
            stats[classification === 'S' ? 'sLevel' : 'aLevel']++;
            incrementStat(classification === 'S' ? 's' : 'a');
            console.log(`[抖音自动助手] 🎉 ${levelName}收藏成功！已收藏到"${folderName}"`);
            updateStatus(`${levelName}收藏成功！`);
        } else {
            stats.errors++;
            updateStatus('收藏失败，请检查是否登录');
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        isProcessing = false;
    }

    function setupObserver() {
        let debounceTimer = null;

        const debouncedProcess = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processCurrentVideo();
            }, 800);
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
                            lastVideoSrc = '';
                            debouncedProcess();
                            return;
                        }
                    }
                }
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function startMonitoring() {
        console.log('[抖音自动助手] 开始监控推荐流...');

        setInterval(() => {
            if (!isProcessing) {
                const video = getVideoElement();
                if (video && video.readyState > 0 && video.src && video.src !== 'null') {
                    const { likes, timeAgo, daysAgo } = getCurrentVideoData();
                    
                    if (likes > 0) {
                        const result = getClassificationResult(likes, daysAgo);
                        updateVideoInfo(formatNumber(likes), timeAgo || '未知', result.text, result.class);
                    }
                }
            }
        }, CONFIG.CHECK_INTERVAL);

        const startProcessing = () => {
            setTimeout(processCurrentVideo, 1500);
        };

        if (document.readyState === 'complete') {
            startProcessing();
        } else {
            window.addEventListener('load', startProcessing);
        }

        document.addEventListener('click', () => {
            setTimeout(() => {
                if (!isProcessing) processCurrentVideo();
            }, 500);
        }, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
