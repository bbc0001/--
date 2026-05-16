// ==UserScript==
// @name         抖音自动刷视频收藏助手
// @namespace    douyin-autofan
// @version      6.0
// @description  自动下滑抖音推荐页，按点赞数和发布时间分类收藏到指定收藏夹
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
        
        // 短视频（2分钟以下）播放进度要求（随机70%~99%）
        SHORT_VIDEO_MIN_PROGRESS: 0.7,
        SHORT_VIDEO_MAX_PROGRESS: 0.99,
        
        // 长视频（2分钟以上）播放进度要求（随机40%~60%）
        LONG_VIDEO_MIN_PROGRESS: 0.4,
        LONG_VIDEO_MAX_PROGRESS: 0.6,
        
        // 短视频与长视频的分界点（2分钟）
        SHORT_VIDEO_THRESHOLD_SECONDS: 120,
        
        // 间歇运行设置
        RUN_DURATION: 2 * 60 * 60 * 1000, // 运行2小时
        REST_MIN: 2 * 60 * 60 * 1000, // 休息最少2小时
        REST_MAX: 3 * 60 * 60 * 1000, // 休息最多3小时
        
        // 滑动设置
        SCROLL_DELAY_MIN: 3000, // 最小滑动延迟（毫秒）
        SCROLL_DELAY_MAX: 5000, // 最大滑动延迟（毫秒）
        SCROLL_WAIT_AFTER_COLLECT: 5000, // 收藏后等待时间
        
        CHECK_INTERVAL: 1000,
        VIDEO_END_DELAY: 1500,
        COLLECTION_DELAY: 500
    };

    let isProcessing = false;
    let isResting = false;
    let restEndTime = 0;
    let controlPanel = null;
    let currentTargetProgress = 0;
    let scrollTimeoutId = null;
    let stats = {
        skipped: 0,
        aLevel: 0,
        sLevel: 0,
        errors: 0
    };

    function init() {
        console.log('[抖音自动助手 v6.0] 脚本已启动');
        console.log('📌 A级分类：7天内发布 + 30万~80万点赞 → 收藏到"A级待分类"');
        console.log('📌 S级分类：7天以上发布 + 80万以上点赞 或 100万点赞以上 → 收藏到"S级待分类"');
        console.log('📌 播放进度要求：');
        console.log('   - 短视频（<2分钟）：随机70%~99%');
        console.log('   - 长视频（≥2分钟）：随机40%~60%');
        console.log('📌 间歇运行：运行2小时后随机休息2-3小时');
        console.log('📌 注意：仅根据点赞数判断，不主动点赞');
        
        createControlPanel();
        setupObserver();
        startRunTimer();
        startMonitoring();
    }

    function getRandomProgress(durationSeconds) {
        const isShortVideo = durationSeconds < CONFIG.SHORT_VIDEO_THRESHOLD_SECONDS;
        
        if (isShortVideo) {
            const min = CONFIG.SHORT_VIDEO_MIN_PROGRESS;
            const max = CONFIG.SHORT_VIDEO_MAX_PROGRESS;
            return min + Math.random() * (max - min);
        } else {
            const min = CONFIG.LONG_VIDEO_MIN_PROGRESS;
            const max = CONFIG.LONG_VIDEO_MAX_PROGRESS;
            return min + Math.random() * (max - min);
        }
    }

    function isVideoTypeText(durationSeconds) {
        const isShortVideo = durationSeconds < CONFIG.SHORT_VIDEO_THRESHOLD_SECONDS;
        return isShortVideo ? '短视频' : '长视频';
    }

    function formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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
            'span[class*="like"]',
            'div[class*="like"] span',
            '[class*="action-item"] span'
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
        // 尝试多种选择器来找到发布时间
        const selectors = [
            // 直接的时间相关选择器
            '[data-e2e="video-time"]',
            '.video-time',
            'time',
            '[class*="time"]',
            
            // 作者信息区域的时间
            '[class*="author-info"] span',
            '[class*="user-info"] span',
            '[class*="nickname"] + span',
            
            // 视频描述区域
            '[class*="desc"] span',
            '[class*="title"] span',
            '[class*="content"] span',
            
            // 通用文本选择器
            'div[class*="container"] span',
            'div[class*="wrapper"] span',
            'div[class*="main"] span'
        ];

        for (const selector of selectors) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (element && element.textContent && element.textContent.trim()) {
                        const text = element.textContent.trim();
                        // 匹配各种时间格式
                        if (text.match(/\d+\s*(秒|分钟|分钟前|小时|小时前|天|天前|周|周前|个月|个月前)/) && element.offsetParent !== null) {
                            console.log('[抖音自动助手] 找到时间元素:', text);
                            return element;
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }

        // 更广泛地搜索包含时间的元素
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            if (!el.textContent || !el.textContent.trim()) continue;
            if (el.children.length > 5) continue; // 跳过容器元素
            
            const text = el.textContent.trim();
            if (text.match(/^\d+\s*(秒|分钟|分钟前|小时|小时前|天|天前|周|周前|个月|个月前)$/) && el.offsetParent !== null) {
                const parent = el.parentElement;
                if (parent && (parent.className.includes('author') || parent.className.includes('info') || parent.className.includes('desc') || parent.className.includes('name'))) {
                    console.log('[抖音自动助手] 找到时间元素:', text);
                    return el;
                }
            }
        }

        console.log('[抖音自动助手] 未找到时间元素');
        return null;
    }

    function isVideoPlaying(video) {
        return video && !video.paused && !video.ended && video.readyState > 2;
    }

    function getVideoProgress(video) {
        if (!video || !video.duration || isNaN(video.duration) || video.duration === 0) {
            return 0;
        }
        return video.currentTime / video.duration;
    }

    async function waitForProgress(video, minProgress) {
        return new Promise((resolve) => {
            if (getVideoProgress(video) >= minProgress) {
                resolve();
                return;
            }
            
            let resolved = false;
            
            const checkProgress = () => {
                if (resolved) return;
                
                const progress = getVideoProgress(video);
                if (progress >= minProgress || video.ended) {
                    resolved = true;
                    cleanup();
                    resolve();
                }
            };
            
            const handleEnded = () => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve();
                }
            };
            
            const handlePause = () => {
                if (!resolved) {
                    setTimeout(checkProgress, 200);
                }
            };
            
            const cleanup = () => {
                video.removeEventListener('timeupdate', checkProgress);
                video.removeEventListener('ended', handleEnded);
                video.removeEventListener('pause', handlePause);
            };
            
            const intervalId = setInterval(checkProgress, 500);
            
            video.addEventListener('timeupdate', checkProgress);
            video.addEventListener('ended', handleEnded);
            video.addEventListener('pause', handlePause);
            
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    clearInterval(intervalId);
                    resolve();
                }
            }, 300000);
        });
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
        if (!video || !video.src || video.src === 'null') return false;

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
        const video = getVideoElement();
        
        const likes = likeElement ? parseLikeCount(likeElement.textContent) : 0;
        const timeAgo = timeElement ? timeElement.textContent.trim() : '';
        const daysAgo = getDaysAgo(timeAgo);
        const progress = video ? getVideoProgress(video) : 0;
        const duration = video ? video.duration : 0;
        
        return { likes, timeAgo, daysAgo, progress, duration };
    }

    function classifyVideo(likes, daysAgo) {
        if (likes >= 1000000) {
            return 'S';
        }
        
        if (daysAgo > CONFIG.S_LEVEL_DAYS && likes >= CONFIG.S_LEVEL_MIN_LIKES) {
            return 'S';
        }
        
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
    let runStartTime = Date.now();

    function startRunTimer() {
        setInterval(() => {
            updateTimerDisplay();
            
            if (isResting) {
                if (Date.now() >= restEndTime) {
                    console.log('[抖音自动助手] ⏰ 休息结束，开始下一轮运行');
                    isResting = false;
                    runStartTime = Date.now();
                    setRestingStatus(false);
                }
            } else {
                if (Date.now() - runStartTime >= CONFIG.RUN_DURATION) {
                    const restDuration = CONFIG.REST_MIN + Math.random() * (CONFIG.REST_MAX - CONFIG.REST_MIN);
                    restEndTime = Date.now() + restDuration;
                    isResting = true;
                    setRestingStatus(true);
                    
                    const restHours = Math.round(restDuration / 3600000 * 10) / 10;
                    console.log(`[抖音自动助手] 😴 运行2小时结束，开始休息 ${restHours.toFixed(1)} 小时`);
                }
            }
        }, 1000);
    }

    function scheduleNextScroll() {
        if (isProcessing || isResting) return;
        
        if (scrollTimeoutId) {
            clearTimeout(scrollTimeoutId);
        }
        
        const delay = CONFIG.SCROLL_DELAY_MIN + Math.random() * (CONFIG.SCROLL_DELAY_MAX - CONFIG.SCROLL_DELAY_MIN);
        
        scrollTimeoutId = setTimeout(() => {
            if (!isProcessing && !isResting) {
                scrollToNextVideo();
            }
        }, delay);
    }

    function scrollToNextVideo() {
        if (isResting || isProcessing) return;
        
        console.log('[抖音自动助手] ⬇️ 正在滑动到下一个视频...');
        
        // 使用多种方式尝试滑动
        try {
            // 方法1：使用scrollBy
            window.scrollBy({
                top: window.innerHeight * 0.9,
                behavior: 'smooth'
            });
            
            // 方法2：模拟触摸滑动（移动端）
            const touchEvent = new TouchEvent('touchstart', {
                touches: [new Touch({ identifier: 0, target: document.body, clientY: window.innerHeight * 0.8 })],
                bubbles: true
            });
            document.dispatchEvent(touchEvent);
            
            console.log('[抖音自动助手] ✅ 滑动操作已执行');
            
            // 等待新视频加载
            setTimeout(() => {
                scheduleNextScroll();
            }, 2000);
            
        } catch (error) {
            console.error('[抖音自动助手] 滑动失败:', error);
            scheduleNextScroll();
        }
    }

    async function processCurrentVideo() {
        if (isProcessing || isResting) return;
        
        const video = getVideoElement();
        if (!video || !video.src || video.src === 'null') {
            scheduleNextScroll();
            return;
        }

        const currentSrc = video.src;
        if (currentSrc === lastVideoSrc) return;
        lastVideoSrc = currentSrc;

        isProcessing = true;
        currentTargetProgress = 0;
        updateStatus('正在分析视频...');

        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await autoPlayVideo();

        const { likes, timeAgo, daysAgo, progress, duration } = getCurrentVideoData();
        
        console.log(`[抖音自动助手] 视频数据 - 点赞: ${formatNumber(likes)}, 发布时间: ${timeAgo || '未知'}, 时长: ${formatTime(duration)}`);
        
        updateVideoInfo(formatNumber(likes), timeAgo || '未知', '分析中...', '');
        updateProgress(progress, duration);

        const classification = classifyVideo(likes, daysAgo);
        const result = getClassificationResult(likes, daysAgo);
        updateVideoInfo(formatNumber(likes), timeAgo || '未知', result.text, result.class);

        if (classification === 'skip') {
            console.log(`[抖音自动助手] ⏭️ 跳过: 不满足收藏条件`);
            updateStatus('不满足条件，等待下一条...');
            isProcessing = false;
            
            // 随机延迟后滑动
            setTimeout(() => {
                scrollToNextVideo();
            }, 2000);
            return;
        }

        currentTargetProgress = getRandomProgress(duration);
        const videoType = isVideoTypeText(duration);
        const targetPercent = Math.round(currentTargetProgress * 100);
        
        const folderName = classification === 'S' ? CONFIG.S_LEVEL_FOLDER : CONFIG.A_LEVEL_FOLDER;
        const levelName = classification === 'S' ? 'S级' : 'A级';
        
        console.log(`[抖音自动助手] 📊 ${videoType}，目标进度: ${targetPercent}%`);
        updateStatus(`${levelName}${videoType}，播放至${targetPercent}%...`);

        if (!isVideoPlaying(video)) {
            await autoPlayVideo();
        }

        await waitForProgress(video, currentTargetProgress);
        
        updateProgress(getVideoProgress(video), duration);

        if (video.ended) {
            console.log('[抖音自动助手] 📊 视频已播放完毕');
        } else {
            console.log(`[抖音自动助手] 📊 播放进度已达标: ${Math.round(getVideoProgress(video) * 100)}%`);
        }

        updateStatus(`${levelName}播放进度达标，执行收藏...`);

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

        await new Promise(resolve => setTimeout(resolve, CONFIG.SCROLL_WAIT_AFTER_COLLECT));
        isProcessing = false;
        scrollToNextVideo();
    }

    function setupObserver() {
        let debounceTimer = null;

        const debouncedProcess = () => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                processCurrentVideo();
            }, 1500);
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
            if (!isProcessing && !isResting) {
                const video = getVideoElement();
                if (video && video.readyState > 0 && video.src && video.src !== 'null') {
                    const { likes, timeAgo, daysAgo, progress, duration } = getCurrentVideoData();
                    
                    if (likes > 0) {
                        const result = getClassificationResult(likes, daysAgo);
                        updateVideoInfo(formatNumber(likes), timeAgo || '未知', result.text, result.class);
                    }
                    
                    updateProgress(progress, duration);
                }
            }
        }, CONFIG.CHECK_INTERVAL);

        const startProcessing = () => {
            setTimeout(processCurrentVideo, 2000);
            // 启动自动滑动
            setTimeout(() => {
                scheduleNextScroll();
            }, 3000);
        };

        if (document.readyState === 'complete') {
            startProcessing();
        } else {
            window.addEventListener('load', startProcessing);
        }

        document.addEventListener('click', () => {
            setTimeout(() => {
                if (!isProcessing && !isResting) processCurrentVideo();
            }, 500);
        }, { once: true });
    }

    function updateStatus(text) {
        const element = document.getElementById('status-text');
        if (element) element.textContent = text;
    }

    function setRestingStatus(resting, timeRemaining = '') {
        const dot = document.getElementById('status-dot');
        const fill = document.getElementById('timer-bar-fill');
        
        if (dot) {
            if (resting) {
                dot.classList.add('resting');
            } else {
                dot.classList.remove('resting');
            }
        }
        
        if (fill && resting) {
            fill.classList.add('resting');
        } else if (fill) {
            fill.classList.remove('resting');
        }
        
        isResting = resting;
        
        // 休息时停止滑动
        if (resting && scrollTimeoutId) {
            clearTimeout(scrollTimeoutId);
        }
    }

    function updateTimerDisplay() {
        const timerText = document.getElementById('timer-text');
        const timerFill = document.getElementById('timer-bar-fill');
        
        if (!timerText || !timerFill) return;
        
        if (isResting) {
            const now = Date.now();
            const remaining = Math.max(0, restEndTime - now);
            const restDuration = CONFIG.REST_MAX - (CONFIG.REST_MIN + Math.random() * (CONFIG.REST_MAX - CONFIG.REST_MIN));
            const elapsed = restDuration - remaining;
            const percentage = Math.min(100, (elapsed / restDuration) * 100);
            
            const hours = Math.floor(remaining / 3600000);
            const minutes = Math.floor((remaining % 3600000) / 60000);
            const seconds = Math.floor((remaining % 60000) / 1000);
            
            timerText.textContent = `休息中: ${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            timerFill.style.width = percentage + '%';
        } else {
            const now = Date.now();
            const elapsed = now - runStartTime;
            const remaining = Math.max(0, CONFIG.RUN_DURATION - elapsed);
            const percentage = Math.min(100, (elapsed / CONFIG.RUN_DURATION) * 100);
            
            const elapsedHours = Math.floor(elapsed / 3600000);
            const elapsedMinutes = Math.floor((elapsed % 3600000) / 60000);
            const totalHours = CONFIG.RUN_DURATION / 3600000;
            
            timerText.textContent = `运行中: ${elapsedHours}:${elapsedMinutes.toString().padStart(2, '0')} / ${totalHours.toFixed(0)}:00`;
            timerFill.style.width = percentage + '%';
        }
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

    function updateProgress(progress, videoDuration) {
        const progressText = document.getElementById('progress-text');
        const progressFill = document.getElementById('progress-bar-fill');
        
        if (progressText) {
            const percentage = Math.round(progress * 100);
            const currentTime = formatTime(videoDuration * progress);
            const totalTime = formatTime(videoDuration);
            const targetInfo = currentTargetProgress > 0 ? ` (目标${Math.round(currentTargetProgress * 100)}%)` : '';
            progressText.textContent = `${currentTime} / ${totalTime} (${percentage}%${targetInfo}`;
        }
        
        if (progressFill) {
            progressFill.style.width = (progress * 100) + '%';
        }
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
                #douyin-autofan-panel .status-dot.resting {
                    background: #facc15;
                    animation: none;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.5; transform: scale(1.2); }
                }
                #douyin-autofan-panel .timer-bar {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 6px;
                    height: 8px;
                    margin: 10px 0;
                    overflow: hidden;
                }
                #douyin-autofan-panel .timer-bar-fill {
                    height: 100%;
                    background: linear-gradient(90deg, #4ade80, #22c55e);
                    transition: width 1s linear;
                    border-radius: 6px;
                }
                #douyin-autofan-panel .timer-bar-fill.resting {
                    background: linear-gradient(90deg, #fbbf24, #f59e0b);
                }
                #douyin-autofan-panel .timer-text {
                    font-size: 11px;
                    color: #94a3b8;
                    text-align: center;
                    margin-bottom: 10px;
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
                #douyin-autofan-panel .progress-bar {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 4px;
                    height: 6px;
                    margin-top: 6px;
                    overflow: hidden;
                }
                #douyin-autofan-panel .progress-bar-fill {
                    height: 100%;
                    background: #60a5fa;
                    transition: width 0.3s;
                }
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
                    margin-top: 8px;
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
            <h3>🎬 抖音自动收藏助手 v6.0</h3>
            
            <div class="rule-box">
                <div class="rule-title"><span class="A级">⭐ A级</span> 7天内 · 30万~80万点赞</div>
                <div>收藏到: "A级待分类"</div>
            </div>
            <div class="rule-box">
                <div class="rule-title"><span class="S级">🌟 S级</span> 7天外+80万 或 100万以上</div>
                <div>收藏到: "S级待分类"</div>
            </div>
            
            <div class="rule-box">
                <div class="rule-title">⏱️ 进度规则</div>
                <div>短视频(<strong>&lt;2分钟</strong>): 70%~99%随机</div>
                <div><strong>≥2分钟</strong>: 40%~60%随机</div>
            </div>
            
            <div class="rule-box">
                <div class="rule-title">📱 自动滑动</div>
                <div>推荐页自动下滑浏览</div>
                <div>仅根据点赞数判断，不主动点赞</div>
            </div>
            
            <div class="status">
                <div class="status-dot" id="status-dot"></div>
                <span id="status-text">正在启动...</span>
            </div>
            
            <div class="timer-text" id="timer-text">运行中: 0:00 / 2:00:00</div>
            <div class="timer-bar">
                <div class="timer-bar-fill" id="timer-bar-fill"></div>
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
                <div class="row">
                    <span class="label">播放进度</span>
                    <span class="value" id="progress-text">--</span>
                </div>
                <div class="progress-bar">
                    <div class="progress-bar-fill" id="progress-bar-fill" style="width: 0%"></div>
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
            if (scrollTimeoutId) {
                clearTimeout(scrollTimeoutId);
            }
            console.log('[抖音自动助手] 脚本已停止');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();