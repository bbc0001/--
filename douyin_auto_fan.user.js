// ==UserScript==
// @name         抖音自动刷视频收藏助手
// @namespace    douyin-autofan
// @version      1.0
// @description  自动刷抖音推荐流视频，检测百万点赞视频并自动收藏（非侵入式用户脚本）
// @author       AutoFan
// @match        https://www.douyin.com/*
// @grant        none
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        THRESHOLD: 1000000, // 百万点赞阈值
        CHECK_INTERVAL: 1000, // 检查间隔（毫秒）
        VIDEO_END_DELAY: 1000, // 视频结束后等待时间
        SAFE_MODE: true // 安全模式：防止误操作
    };

    let currentVideoLikes = 0;
    let isProcessing = false;
    let controlPanel = null;

    function init() {
        console.log('[抖音自动助手] 脚本已启动');
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
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 15px 20px;
                    border-radius: 12px;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    font-size: 14px;
                    z-index: 999999;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    min-width: 260px;
                    backdrop-filter: blur(10px);
                }
                #douyin-autofan-panel h3 {
                    margin: 0 0 10px 0;
                    font-size: 16px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                #douyin-autofan-panel .status {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin: 8px 0;
                    padding: 8px 12px;
                    background: rgba(255, 255, 255, 0.15);
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
                #douyin-autofan-panel .stats {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 8px;
                    margin-top: 10px;
                }
                #douyin-autofan-panel .stat-item {
                    background: rgba(255, 255, 255, 0.1);
                    padding: 8px 12px;
                    border-radius: 6px;
                    text-align: center;
                }
                #douyin-autofan-panel .stat-value {
                    font-size: 18px;
                    font-weight: 700;
                }
                #douyin-autofan-panel .stat-label {
                    font-size: 11px;
                    opacity: 0.8;
                    margin-top: 2px;
                }
                #douyin-autofan-panel .threshold-control {
                    margin-top: 12px;
                    padding-top: 12px;
                    border-top: 1px solid rgba(255, 255, 255, 0.2);
                }
                #douyin-autofan-panel label {
                    display: block;
                    font-size: 12px;
                    margin-bottom: 6px;
                    opacity: 0.9;
                }
                #douyin-autofan-panel input[type="range"] {
                    width: 100%;
                    margin: 8px 0;
                }
                #douyin-autofan-panel .threshold-value {
                    text-align: center;
                    font-size: 16px;
                    font-weight: 600;
                }
                #douyin-autofan-panel button {
                    width: 100%;
                    padding: 10px;
                    margin-top: 10px;
                    border: none;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s;
                }
                #douyin-autofan-panel .btn-stop {
                    background: #ef4444;
                    color: white;
                }
                #douyin-autofan-panel .btn-stop:hover {
                    background: #dc2626;
                }
            </style>
            <h3>🎬 抖音自动助手</h3>
            <div class="status">
                <div class="status-dot"></div>
                <span>监控中 - 等待视频...</span>
            </div>
            <div class="stats">
                <div class="stat-item">
                    <div class="stat-value" id="current-likes">0</div>
                    <div class="stat-label">当前点赞</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value" id="collected-count">0</div>
                    <div class="stat-label">已收藏</div>
                </div>
            </div>
            <div class="threshold-control">
                <label>点赞阈值设置（万）</label>
                <input type="range" id="threshold-slider" min="10" max="500" value="100">
                <div class="threshold-value" id="threshold-display">100万</div>
            </div>
            <button class="btn-stop" id="stop-btn">⏹ 暂停监控</button>
        `;

        document.body.appendChild(controlPanel);

        const thresholdSlider = document.getElementById('threshold-slider');
        const thresholdDisplay = document.getElementById('threshold-display');

        thresholdSlider.addEventListener('input', (e) => {
            CONFIG.THRESHOLD = parseInt(e.target.value) * 10000;
            thresholdDisplay.textContent = `${e.target.value}万`;
        });

        document.getElementById('stop-btn').addEventListener('click', () => {
            if (controlPanel) {
                controlPanel.remove();
                controlPanel = null;
            }
            console.log('[抖音自动助手] 脚本已停止');
        });
    }

    function updateStatus(text) {
        const statusElement = controlPanel?.querySelector('.status span');
        if (statusElement) {
            statusElement.textContent = text;
        }
    }

    function updateCurrentLikes(likes) {
        const element = document.getElementById('current-likes');
        if (element) {
            element.textContent = formatNumber(likes);
        }
        currentVideoLikes = likes;
    }

    function incrementCollected() {
        const element = document.getElementById('collected-count');
        if (element) {
            const current = parseInt(element.textContent) || 0;
            element.textContent = current + 1;
        }
    }

    function formatNumber(num) {
        if (num >= 100000000) {
            return (num / 100000000).toFixed(1) + '亿';
        } else if (num >= 10000) {
            return (num / 10000).toFixed(1) + '万';
        }
        return num.toString();
    }

    function parseLikeCount(likeString) {
        if (!likeString) return 0;
        let match = likeString.match(/[\d.]+/);
        if (!match) return 0;

        let num = parseFloat(match[0]);
        if (likeString.includes('亿')) {
            num *= 100000000;
        } else if (likeString.includes('万')) {
            num *= 10000;
        }
        return Math.floor(num);
    }

    function getVideoElement() {
        return document.querySelector('video');
    }

    function getLikeElement() {
        const selectors = [
            '[data-e2e="like-count"]',
            '.like-item span',
            '[class*="like"] span',
            'span[data-testid]'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.textContent) {
                return element;
            }
        }

        const allSpans = document.querySelectorAll('span');
        for (const span of allSpans) {
            const text = span.textContent.trim();
            if (text.match(/^\d+(\.\d+)?[万亿]?$/) && span.offsetParent !== null) {
                const parent = span.parentElement;
                if (parent && (parent.className.includes('like') || parent.className.includes('action'))) {
                    return span;
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
            const handleEnded = () => {
                video.removeEventListener('ended', handleEnded);
                video.removeEventListener('pause', handleEnded);
                resolve();
            };

            video.addEventListener('ended', handleEnded);
            video.addEventListener('pause', handleEnded);

            setTimeout(() => {
                video.removeEventListener('ended', handleEnded);
                video.removeEventListener('pause', handleEnded);
                resolve();
            }, 60000);
        });
    }

    async function clickLikeButton() {
        const likeButton = document.querySelector('[data-e2e="like-button"]');
        if (likeButton) {
            likeButton.click();
            console.log('[抖音自动助手] 点赞成功');
            return true;
        }

        const likeIcon = document.querySelector('[class*="like-icon"]');
        if (likeIcon) {
            const button = likeIcon.closest('[class*="action-item"]') || likeIcon.closest('div[tabindex]');
            if (button) {
                button.click();
                console.log('[抖音自动助手] 点赞成功');
                return true;
            }
        }

        return false;
    }

    async function clickCollectButton() {
        const collectButton = document.querySelector('[data-e2e="bookmark-button"]');
        if (collectButton) {
            collectButton.click();
            console.log('[抖音自动助手] 收藏成功 ✨');
            incrementCollected();
            return true;
        }

        const collectIcons = document.querySelectorAll('[class*="collect"], [class*="bookmark"]');
        for (const icon of collectIcons) {
            if (icon.offsetParent !== null) {
                const button = icon.closest('[class*="action-item"]') || icon.closest('div[tabindex]');
                if (button) {
                    button.click();
                    console.log('[抖音自动助手] 收藏成功 ✨');
                    incrementCollected();
                    return true;
                }
            }
        }

        return false;
    }

    async function autoPlayVideo() {
        const video = getVideoElement();
        if (!video) return;

        if (video.paused) {
            try {
                await video.play();
                console.log('[抖音自动助手] 视频开始播放');
            } catch (error) {
                console.log('[抖音自动助手] 自动播放被阻止，等待用户交互');
            }
        }
    }

    function getCurrentVideoLikes() {
        const likeElement = getLikeElement();
        if (likeElement) {
            return parseLikeCount(likeElement.textContent);
        }
        return 0;
    }

    let lastVideoSrc = '';

    async function processCurrentVideo() {
        if (isProcessing) return;
        isProcessing = true;

        const video = getVideoElement();
        if (!video) {
            isProcessing = false;
            return;
        }

        const currentSrc = video.src || video.currentSrc;
        if (currentSrc === lastVideoSrc && currentSrc) {
            isProcessing = false;
            return;
        }
        lastVideoSrc = currentSrc;

        updateStatus('播放视频中...');
        await autoPlayVideo();

        await new Promise(resolve => setTimeout(resolve, 2000));

        const initialLikes = getCurrentVideoLikes();
        updateCurrentLikes(initialLikes);

        console.log(`[抖音自动助手] 当前视频点赞数: ${formatNumber(initialLikes)}`);

        if (initialLikes >= CONFIG.THRESHOLD) {
            console.log(`[抖音自动助手] 🎯 检测到百万点赞视频！`);

            if (!isVideoPlaying(video)) {
                await autoPlayVideo();
            }

            updateStatus('视频播放中，等待结束...');
            await waitForVideoEnd(video);

            await new Promise(resolve => setTimeout(resolve, CONFIG.VIDEO_END_DELAY));

            const liked = await clickLikeButton();
            if (liked) {
                await new Promise(resolve => setTimeout(resolve, 500));
                await clickCollectButton();
            }

            updateStatus('百万点赞视频已收藏！准备下一条...');
            await new Promise(resolve => setTimeout(resolve, 1500));
        } else {
            const progress = (initialLikes / CONFIG.THRESHOLD * 100).toFixed(1);
            updateStatus(`跳过中 (${formatNumber(initialLikes)} / ${formatNumber(CONFIG.THRESHOLD)})`);
        }

        isProcessing = false;
    }

    function setupObserver() {
        let debounceTimer = null;

        const debouncedProcess = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processCurrentVideo();
            }, 500);
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeName === 'VIDEO' || (node.querySelector && node.querySelector('video'))) {
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
        console.log('[抖音自动助手] 开始监控...');

        setInterval(() => {
            if (!isProcessing) {
                const video = getVideoElement();
                if (video && video.readyState > 0) {
                    const likes = getCurrentVideoLikes();
                    updateCurrentLikes(likes);

                    if (likes >= CONFIG.THRESHOLD && !isVideoPlaying(video)) {
                        processCurrentVideo();
                    }
                }
            }
        }, CONFIG.CHECK_INTERVAL);

        if (document.readyState === 'complete') {
            setTimeout(processCurrentVideo, 1000);
        } else {
            window.addEventListener('load', () => {
                setTimeout(processCurrentVideo, 1000);
            });
        }

        document.addEventListener('click', () => {
            if (!isProcessing) {
                setTimeout(processCurrentVideo, 500);
            }
        }, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
