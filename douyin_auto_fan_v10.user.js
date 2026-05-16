// ==UserScript==
// @name         抖音自动刷视频收藏助手
// @namespace    douyin-autofan
// @version      10.0
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
        RUN_DURATION: 2 * 60 * 60 * 1000,
        REST_MIN: 2 * 60 * 60 * 1000,
        REST_MAX: 3 * 60 * 60 * 1000,
        
        // 滑动设置
        SCROLL_DELAY_MIN: 3000,
        SCROLL_DELAY_MAX: 5000,
        SCROLL_WAIT_AFTER_COLLECT: 5000,
        VIDEO_LOAD_WAIT_TIME: 2000,
        LIVE_SKIP_DELAY: 1500,
        
        // 性能优化设置
        CHECK_INTERVAL: 2000,
        VIDEO_END_DELAY: 1500,
        COLLECTION_DELAY: 500,
        
        // 点赞数字稳定检测设置
        LIKES_STABILIZATION_COUNT: 2,
        LIKES_STABILIZATION_DELAY: 300
    };

    let isProcessing = false;
    let isResting = false;
    let restEndTime = 0;
    let controlPanel = null;
    let currentTargetProgress = 0;
    let mainLoopInterval = null;
    let stats = {
        skipped: 0,
        aLevel: 0,
        sLevel: 0,
        errors: 0,
        liveSkipped: 0
    };
    
    let cachedElements = {
        video: null,
        likesElement: null,
        timeElement: null
    };
    
    let likesStabilityBuffer = [];
    let lastStableLikes = 0;
    let lastVideoSrc = '';
    let runStartTime = Date.now();
    let consecutiveNoVideoCount = 0; // 连续没有视频的计数

    function init() {
        console.log('[抖音自动助手 v10.0] 脚本已启动');
        console.log('📌 请确保在推荐页使用本脚本');
        console.log('📌 收藏规则：A级/S级分类收藏');
        console.log('📌 间歇运行：运行2小时后休息2-3小时');
        
        createControlPanel();
        setupDragFunctionality();
        startRunTimer();
        startMainLoop();
        
        updateStatus('等待进入推荐页...');
        console.log('[抖音自动助手] 初始化完成，等待推荐页...');
    }
    
    // 检查是否在推荐页
    function isOnRecommendPage() {
        const video = getVideoElement();
        if (!video || !video.src || video.src === 'null' || video.src === '') {
            return false;
        }
        
        // 检查是否有视频在播放
        if (video.readyState > 0 && video.duration > 0) {
            return true;
        }
        
        // 检查URL是否包含推荐相关的关键词
        const url = window.location.href;
        if (url.includes('recommend') || url.includes('following') || url.includes('home')) {
            return true;
        }
        
        return false;
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
    
    function getStableLikes() {
        const likeElement = getLikeElement();
        if (!likeElement) return 0;
        
        const currentLikes = parseLikeCount(likeElement.textContent);
        
        likesStabilityBuffer.push(currentLikes);
        if (likesStabilityBuffer.length > CONFIG.LIKES_STABILIZATION_COUNT) {
            likesStabilityBuffer.shift();
        }
        
        if (likesStabilityBuffer.length >= CONFIG.LIKES_STABILIZATION_COUNT) {
            const allSame = likesStabilityBuffer.every(val => val === likesStabilityBuffer[0]);
            if (allSame) {
                lastStableLikes = likesStabilityBuffer[0];
                return lastStableLikes;
            }
        }
        
        return lastStableLikes;
    }
    
    function resetLikesStability() {
        likesStabilityBuffer = [];
        lastStableLikes = 0;
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
    
    // 检测是否是直播页面 - 更严格的判断
    function isLivePage() {
        const video = getVideoElement();
        if (!video) return false;
        
        // 检查是否有正在播放的视频
        if (!video.src || video.src === 'null' || video.src === '') {
            return false;
        }
        
        // 检查是否有点赞数显示（直播通常没有点赞数）
        const likeElement = getLikeElement();
        const hasLikes = likeElement && parseLikeCount(likeElement.textContent) > 0;
        
        // 检查是否有时间显示（视频发布时间的格式 vs 直播时长）
        const timeElement = getTimeElement();
        const hasTimeAgo = timeElement && timeElement.textContent.match(/\d+\s*(秒|分钟|分钟前|小时|小时前|天|天前|周|个月)/);
        
        // 如果没有点赞数且没有发布时间，可能是直播
        if (!hasLikes && !hasTimeAgo) {
            console.log('[抖音自动助手] 可能为直播（无点赞数和时间）');
            return true;
        }
        
        // 检查明显的直播标识
        const liveTextElements = document.querySelectorAll('*');
        for (const el of liveTextElements) {
            if (el.textContent && el.textContent.includes('直播中') && el.offsetParent !== null) {
                console.log('[抖音自动助手] 发现"直播中"标识');
                return true;
            }
        }
        
        return false;
    }

    function getVideoElement() {
        if (cachedElements.video && cachedElements.video.isConnected) {
            return cachedElements.video;
        }
        cachedElements.video = document.querySelector('video');
        return cachedElements.video;
    }

    function getLikeElement() {
        if (cachedElements.likesElement && cachedElements.likesElement.isConnected) {
            return cachedElements.likesElement;
        }
        
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
                cachedElements.likesElement = element;
                return element;
            }
        }

        const allSpans = document.querySelectorAll('span');
        for (const span of allSpans) {
            const text = span.textContent.trim();
            if (/^\d+(\.\d+)?[万亿]?$/.test(text) && span.offsetParent !== null) {
                const parent = span.closest('[class*="action"]');
                if (parent || span.className.includes('like')) {
                    cachedElements.likesElement = span;
                    return span;
                }
            }
        }

        return null;
    }

    function getTimeElement() {
        if (cachedElements.timeElement && cachedElements.timeElement.isConnected) {
            return cachedElements.timeElement;
        }
        
        const selectors = [
            '[data-e2e="video-time"]',
            '.video-time',
            'time',
            '[class*="time"]',
            '[class*="author-info"] span',
            '[class*="user-info"] span',
            '[class*="nickname"] + span',
            '[class*="desc"] span',
            '[class*="title"] span',
            '[class*="content"] span'
        ];

        for (const selector of selectors) {
            try {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    if (element && element.textContent && element.textContent.trim()) {
                        const text = element.textContent.trim();
                        if (text.match(/\d+\s*(秒|分钟|分钟前|小时|小时前|天|天前|周|周前|个月|个月前)/) && element.offsetParent !== null) {
                            cachedElements.timeElement = element;
                            return element;
                        }
                    }
                }
            } catch (e) {
                continue;
            }
        }

        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            if (!el.textContent || !el.textContent.trim()) continue;
            if (el.children.length > 5) continue;
            
            const text = el.textContent.trim();
            if (text.match(/^\d+\s*(秒|分钟|分钟前|小时|小时前|天|天前|周|周前|个月|个月前)$/) && el.offsetParent !== null) {
                const parent = el.parentElement;
                if (parent && (parent.className.includes('author') || parent.className.includes('info') || parent.className.includes('desc') || parent.className.includes('name'))) {
                    cachedElements.timeElement = el;
                    return el;
                }
            }
        }

        return null;
    }
    
    function clearElementCache() {
        cachedElements = {
            video: null,
            likesElement: null,
            timeElement: null
        };
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
            let checkInterval = null;
            
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
                video.removeEventListener('ended', handleEnded);
                video.removeEventListener('pause', handlePause);
                if (checkInterval) {
                    clearInterval(checkInterval);
                }
            };
            
            checkInterval = setInterval(checkProgress, 1000);
            
            video.addEventListener('ended', handleEnded);
            video.addEventListener('pause', handlePause);
            
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
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
        if (!video || !video.src || video.src === 'null' || video.src === '') return false;

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
        
        const likes = getStableLikes();
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
        }, 2000);
    }

    function scrollToNextVideo() {
        if (isResting) return;
        
        console.log('[抖音自动助手] ⬇️ 滑动到下一个视频...');
        
        try {
            window.scrollBy({
                top: window.innerHeight * 0.9,
                behavior: 'smooth'
            });
            
            const touchEvent = new TouchEvent('touchstart', {
                touches: [new Touch({ identifier: 0, target: document.body, clientY: window.innerHeight * 0.8 })],
                bubbles: true
            });
            document.dispatchEvent(touchEvent);
            
            console.log('[抖音自动助手] ✅ 滑动操作已执行');
            
        } catch (error) {
            console.error('[抖音自动助手] 滑动失败:', error);
        }
    }
    
    // 主循环
    function startMainLoop() {
        if (mainLoopInterval) {
            clearInterval(mainLoopInterval);
        }
        
        mainLoopInterval = setInterval(async () => {
            if (isResting || isProcessing) return;
            
            try {
                await processCurrentPage();
            } catch (error) {
                console.error('[抖音自动助手] 主循环出错:', error);
                isProcessing = false;
            }
        }, 2500);
        
        console.log('[抖音自动助手] 主循环已启动');
    }
    
    // 处理当前页面
    async function processCurrentPage() {
        // 先检查是否在推荐页
        if (!isOnRecommendPage()) {
            consecutiveNoVideoCount++;
            
            if (consecutiveNoVideoCount % 10 === 0) {
                updateStatus('请进入推荐页...');
                console.log('[抖音自动助手] 等待进入推荐页...');
            }
            
            // 如果在主页等待太久，尝试自动滑动
            if (consecutiveNoVideoCount > 20) {
                console.log('[抖音自动助手] 尝试自动滑动到推荐区域...');
                scrollToNextVideo();
                consecutiveNoVideoCount = 0;
            }
            
            return;
        }
        
        // 重置计数器
        consecutiveNoVideoCount = 0;
        
        // 检查是否是直播
        if (isLivePage()) {
            console.log('[抖音自动助手] 📺 检测到直播，正在跳过...');
            updateStatus('📺 检测到直播，正在跳过...');
            stats.liveSkipped++;
            
            await new Promise(resolve => setTimeout(resolve, CONFIG.LIVE_SKIP_DELAY));
            
            lastVideoSrc = '';
            clearElementCache();
            resetLikesStability();
            
            scrollToNextVideo();
            return;
        }
        
        const video = getVideoElement();
        if (!video || !video.src || video.src === 'null' || video.src === '') {
            console.log('[抖音自动助手] 未找到视频，等待加载...');
            updateStatus('等待视频加载...');
            
            consecutiveNoVideoCount++;
            if (consecutiveNoVideoCount > 10) {
                scrollToNextVideo();
                consecutiveNoVideoCount = 0;
            }
            return;
        }
        
        const currentSrc = video.src;
        if (currentSrc === lastVideoSrc) {
            const { likes, timeAgo, daysAgo, progress, duration } = getCurrentVideoData();
            if (likes > 0) {
                const result = getClassificationResult(likes, daysAgo);
                updateVideoInfo(formatNumber(likes), timeAgo || '未知', result.text, result.class);
            }
            updateProgress(progress, duration);
            return;
        }
        
        lastVideoSrc = currentSrc;
        isProcessing = true;
        currentTargetProgress = 0;
        resetLikesStability();
        clearElementCache();
        
        console.log('[抖音自动助手] 🎬 发现新视频');
        
        await new Promise(resolve => setTimeout(resolve, CONFIG.VIDEO_LOAD_WAIT_TIME));
        updateStatus('正在分析视频...');
        
        await autoPlayVideo();
        await new Promise(resolve => setTimeout(resolve, 800));

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
            
            await new Promise(resolve => setTimeout(resolve, 1500));
            isProcessing = false;
            scrollToNextVideo();
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

    function setupDragFunctionality() {
        const header = controlPanel.querySelector('h3');
        let isDragging = false;
        let startX, startY, initialX, initialY;

        header.style.cursor = 'move';
        header.style.userSelect = 'none';
        header.title = '拖动我到任意位置';

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = controlPanel.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            
            header.style.cursor = 'grabbing';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;
            
            let newX = initialX + deltaX;
            let newY = initialY + deltaY;
            
            const maxX = window.innerWidth - controlPanel.offsetWidth;
            const maxY = window.innerHeight - controlPanel.offsetHeight;
            
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));
            
            controlPanel.style.left = newX + 'px';
            controlPanel.style.top = newY + 'px';
            controlPanel.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                header.style.cursor = 'move';
            }
        });
    }

    function updateStatus(text) {
        const element = document.getElementById('status-text');
        if (element) element.textContent = text;
    }

    function setRestingStatus(resting) {
        const dot = document.getElementById('status-dot');
        const fill = document.getElementById('timer-bar-fill');
        
        if (dot) {
            if (resting) {
                dot.classList.add('resting');
            } else {
                dot.classList.remove('resting');
            }
        }
        
        if (fill) {
            if (resting) {
                fill.classList.add('resting');
            } else {
                fill.classList.remove('resting');
            }
        }
        
        isResting = resting;
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
                    padding: 4px;
                    margin: -4px -4px 8px -4px;
                    border-radius: 8px;
                    transition: background 0.2s;
                }
                #douyin-autofan-panel h3:hover {
                    background: rgba(255, 255, 255, 0.1);
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
            <h3>🎬 抖音自动收藏助手 v10.0</h3>
            
            <div class="rule-box">
                <div class="rule-title">📌 使用说明</div>
                <div>请先进入<strong>推荐页</strong>后再使用</div>
            </div>
            
            <div class="rule-box">
                <div class="rule-title"><span class="A级">⭐ A级</span> 7天内 · 30万~80万点赞</div>
                <div>收藏到: "A级待分类"</div>
            </div>
            <div class="rule-box">
                <div class="rule-title"><span class="S级">🌟 S级</span> 7天外+80万 或 100万以上</div>
                <div>收藏到: "S级待分类"</div>
            </div>
            
            <div class="status">
                <div class="status-dot" id="status-dot"></div>
                <span id="status-text">等待进入推荐页...</span>
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
            if (mainLoopInterval) {
                clearInterval(mainLoopInterval);
                mainLoopInterval = null;
            }
            if (controlPanel) {
                controlPanel.remove();
                controlPanel = null;
            }
            console.log('[抖音自动助手] 脚本已停止');
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1500);
    }
})();