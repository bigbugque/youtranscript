// ==UserScript==
// @name         YouTube 一键提取字幕 (优化修复版)
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  帮助中文用户一键复制YouTube视频字幕到剪贴板，采用内置API提取，极速静默，不干扰观看。
// @author       yhelo (Optimized)
// @match        *://www.youtube.com/*
// @noframes
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    let buttonHidden = false;
    let toastTimeout = null;

    /**
     * 安全地解码 HTML 实体 (绕过 Trusted Types 限制，不使用 innerHTML)
     */
    function decodeEntities(text) {
        return text.replace(/&amp;/g, '&')
                   .replace(/&lt;/g, '<')
                   .replace(/&gt;/g, '>')
                   .replace(/&quot;/g, '"')
                   .replace(/&#39;/g, "'")
                   .replace(/&apos;/g, "'");
    }

    /**
     * 显示提示框
     */
    function showToast(message, duration = 3000) {
        let toast = document.getElementById('transcript-toast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.add('show');

        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, duration);
    }

    /**
     * 更新按钮的可见性
     */
    function updateButtonVisibility() {
        const container = document.getElementById('youtranscript-container');
        if (!container) return;

        // 使用 href.includes 替代 pathname，兼容性更好
        const isWatchPage = window.location.href.includes('/watch');
        if (!isWatchPage || buttonHidden || document.fullscreenElement) {
            container.style.display = 'none';
        } else {
            container.style.display = 'flex';
        }
    }

    /**
     * 等待元素加载 (供 DOM 回退方案使用)
     */
    function waitForElement(selector, timeout) {
        return new Promise((resolve) => {
            const el = document.querySelector(selector);
            if (el) return resolve(el);

            const observer = new MutationObserver(() => {
                const element = document.querySelector(selector);
                if (element) {
                    observer.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    /**
     * 方案 A: 通过 YouTube 内部 API 后台静默获取
     */
    async function getYouTubeTranscriptAPI() {
        const player = document.getElementById('movie_player');
        if (!player || typeof player.getPlayerResponse !== 'function') {
            throw new Error('未找到播放器实例');
        }

        const response = player.getPlayerResponse();
        const captionTracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

        if (!captionTracks || !captionTracks.length) {
            throw new Error('该视频没有提供任何字幕');
        }

        const track = captionTracks.find(t => t.languageCode === 'zh-CN') ||
                      captionTracks.find(t => t.languageCode === 'zh-Hans') ||
                      captionTracks.find(t => t.languageCode === 'zh-TW') ||
                      captionTracks.find(t => t.languageCode.startsWith('zh')) ||
                      captionTracks.find(t => t.languageCode.startsWith('en')) ||
                      captionTracks[0];

        const res = await fetch(track.baseUrl);
        if (!res.ok) throw new Error(`字幕请求失败: ${res.status}`);

        const xmlText = await res.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
        const textNodes = xmlDoc.getElementsByTagName('text');

        const transcript = Array.from(textNodes)
            .map(node => decodeEntities(node.textContent || '').trim())
            .filter(Boolean)
            .join('\n');

        if (!transcript) throw new Error('提取到的字幕内容为空');
        return transcript;
    }

    /**
     * 方案 B: 原有的 DOM 模拟点击提取方案 (做 fallback 备用)
     */
    async function getYouTubeTranscriptDOM() {
        const expandBtn = document.querySelector('tp-yt-paper-button#expand');
        if (expandBtn && expandBtn.offsetParent !== null) {
            expandBtn.click();
            await new Promise(r => setTimeout(r, 600));
        }

        const transcriptBtn = Array.from(document.querySelectorAll('button[aria-label]'))
            .find(btn => {
                const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                return label.includes('transcript') || label.includes('字幕');
            }) || document.querySelector('ytd-video-description-transcript-section-renderer button');

        if (transcriptBtn) transcriptBtn.click();

        const selector = 'transcript-segment-view-model .yt-core-attributed-string, yt-formatted-string.ytd-transcript-segment-renderer';
        const firstSegment = await waitForElement(selector, 5000);

        if (!firstSegment) throw new Error('DOM提取失败: 未能在页面中找到字幕面板，视频可能没有字幕');

        const panel = firstSegment.closest('ytd-engagement-panel-section-list-renderer') || document;
        const segments = panel.querySelectorAll(selector);
        const text = Array.from(segments).map(s => s.textContent.trim()).filter(Boolean).join('\n');

        const closeBtn = Array.from(panel.querySelectorAll('button[aria-label]'))
            .find(btn => {
                const label = (btn.getAttribute('aria-label') || '').toLowerCase();
                return label.includes('close') || label.includes('关闭');
            });
        if (closeBtn) closeBtn.click();

        return text;
    }

    /**
     * 综合调度字幕提取
     */
    async function getYouTubeTranscript() {
        try {
            console.log('[YouTranscript] 尝试使用高速 API 获取字幕...');
            return await getYouTubeTranscriptAPI();
        } catch (apiError) {
            console.warn('[YouTranscript] API 获取失败，尝试使用 DOM 模拟点击回退方案:', apiError);
            return await getYouTubeTranscriptDOM();
        }
    }

    /**
     * 复制文本到剪贴板
     */
    async function copyToClipboard(text) {
        if (typeof GM_setClipboard !== 'undefined') {
            GM_setClipboard(text);
        } else {
            await navigator.clipboard.writeText(text);
        }
    }

    /**
     * 处理点击复制事件
     */
    async function handleCopyTranscriptClick() {
        if (!window.location.href.includes('/watch')) {
            showToast('请在视频播放页面使用此功能。');
            return;
        }

        const btn = document.getElementById('copy-transcript-btn');
        if (!btn || btn.classList.contains('loading')) return;

        btn.classList.add('loading');
        btn.textContent = '⏳';

        try {
            const transcript = await getYouTubeTranscript();
            await copyToClipboard(transcript);
            showToast('字幕已成功提取并复制到剪贴板！');
            btn.textContent = '✓';
        } catch (err) {
            console.error('获取字幕时发生错误:', err);
            showToast(`复制失败: ${err.message}`);
            btn.textContent = '❌';
        } finally {
            btn.classList.remove('loading');
            setTimeout(() => {
                if (btn.textContent === '✓' || btn.textContent === '❌') {
                    btn.textContent = '📋';
                }
            }, 3000);
        }
    }

    /**
     * 创建 UI 组件 (将 CSS 打包进 Container，防止被 YouTube 动态清理)
     */
    function createUI() {
        if (document.getElementById('youtranscript-container')) return;

        const container = document.createElement('div');
        container.id = 'youtranscript-container';

        // 核心 CSS 直接注入容器内，避免头部注入失败
        const style = document.createElement('style');
        style.textContent = `
            #youtranscript-container {
                position: fixed;
                bottom: 30px;
                right: 30px;
                z-index: 10000;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            #copy-transcript-btn {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                border: none;
                background: #007bff;
                color: white;
                font-size: 20px;
                cursor: pointer;
                box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                transition: transform 0.2s ease, background 0.2s ease, opacity 0.2s ease;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.9;
            }
            #copy-transcript-btn:hover {
                background: #0056b3;
                transform: scale(1.1);
                opacity: 1;
            }
            #copy-transcript-btn.loading {
                animation: youtranscript-spin 1s linear infinite;
            }
            @keyframes youtranscript-spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            #close-transcript-btn {
                position: absolute;
                top: -5px;
                right: -5px;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                background: #ff4757;
                color: white;
                font-size: 14px;
                cursor: pointer;
                display: none;
                align-items: center;
                justify-content: center;
                line-height: 1;
                border: 2px solid #fff;
                box-sizing: border-box;
            }
            #youtranscript-container:hover #close-transcript-btn {
                display: flex;
            }
            #transcript-toast {
                position: fixed;
                bottom: 80px;
                right: 30px;
                max-width: 300px;
                padding: 10px 15px;
                border-radius: 8px;
                background: rgba(0, 0, 0, 0.85);
                color: white;
                font-size: 14px;
                z-index: 10001;
                opacity: 0;
                pointer-events: none;
                transform: translateY(10px);
                transition: opacity 0.3s ease, transform 0.3s ease;
                box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                word-break: break-all;
            }
            #transcript-toast.show {
                opacity: 1;
                transform: translateY(0);
            }
        `;
        container.appendChild(style);

        // 复制按钮
        const btn = document.createElement('button');
        btn.id = 'copy-transcript-btn';
        btn.textContent = '📋';
        btn.title = '一键提取视频字幕 (Ctrl+Shift+C)';
        btn.addEventListener('click', handleCopyTranscriptClick);

        // 关闭隐藏按钮
        const closeBtn = document.createElement('div');
        closeBtn.id = 'close-transcript-btn';
        closeBtn.textContent = '×';
        closeBtn.title = '隐藏该按钮 (按 Ctrl+Shift+C 可恢复)';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            buttonHidden = true;
            updateButtonVisibility();
            showToast('按钮已隐藏。您可以按快捷键 Ctrl+Shift+C 恢复显示。');
        });

        container.appendChild(btn);
        container.appendChild(closeBtn);

        // Toast 容器
        let toast = document.getElementById('transcript-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'transcript-toast';
            document.body.appendChild(toast);
        }

        document.body.appendChild(container);
    }

    /**
     * 初始化全局事件监听
     */
    function initGlobalListeners() {
        if (window.__youtranscript_initialized) return;
        window.__youtranscript_initialized = true;

        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
                event.preventDefault();
                if (buttonHidden && !document.fullscreenElement) {
                    buttonHidden = false;
                    updateButtonVisibility();
                    showToast('提取按钮已恢复显示');
                } else {
                    handleCopyTranscriptClick();
                }
            }
        });

        document.addEventListener('fullscreenchange', updateButtonVisibility);

        // 监听 YouTube 的单页应用导航事件，延迟 500ms 避免被 YouTube 自身的 DOM 刷新覆盖
        window.addEventListener('yt-navigate-finish', () => {
            setTimeout(() => {
                createUI();
                updateButtonVisibility();
            }, 500);
        });
    }

    /**
     * 入口点：严格等待文档加载就绪
     */
    function boot() {
        if (!document.body) {
            setTimeout(boot, 100);
            return;
        }
        createUI();
        initGlobalListeners();
        updateButtonVisibility();
    }

    // 启动脚本
    boot();

})();