// ==UserScript==
// @name         youtrascript
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  帮助中文用户一键复制YouTube视频字幕到剪贴板
// @author       yhelo
// @match        *://www.youtube.com/watch*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    let fullscreenChangeHandler = null; // 用于存储全屏事件处理函数

    /**
     * 创建并添加复制字幕按钮到页面
     */
    function createCopyButton() {
        // 检查按钮是否已存在，避免重复创建
        if (document.getElementById('copy-transcript-btn')) {
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'copy-transcript-btn';
        btn.textContent = '📋'; // 剪贴板图标
        btn.title = '复制视频字幕 (Ctrl+Shift+C)'; // 鼠标悬停提示
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '30px',
            right: '30px',
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            border: 'none',
            background: '#007bff', // 蓝色背景
            color: 'white',
            fontSize: '16px',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
            zIndex: '10000',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: '0.9',
            padding: '0',
            lineHeight: '1',
        });

        // 鼠标悬停效果
        btn.addEventListener('mouseover', () => {
            btn.style.background = '#0056b3'; // 深蓝色
            btn.style.transform = 'scale(1.1) rotate(5deg)';
            btn.style.opacity = '1';
        });
        btn.addEventListener('mouseout', () => {
            btn.style.background = '#007bff';
            btn.style.transform = 'scale(1) rotate(0deg)';
            btn.style.opacity = '0.9';
        });

        // 点击事件
        btn.addEventListener('click', handleCopyTranscriptClick);

        // 根据初始全屏状态设置按钮可见性
        if (document.fullscreenElement) {
            btn.style.display = 'none';
        }


        document.body.appendChild(btn);

        // 创建提示框
        const toast = document.createElement('div');
        toast.id = 'transcript-toast';
        Object.assign(toast.style, {
            position: 'fixed',
            bottom: '80px',
            right: '30px',
            maxWidth: '300px',
            padding: '10px 15px',
            borderRadius: '5px',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            fontSize: '14px',
            zIndex: '10001',
            display: 'none',
            boxShadow: '0 2px 10px rgba(0, 0, 0.3)',
            transition: 'opacity 0.3s ease'
        });
        document.body.appendChild(toast);

        // 添加键盘快捷键 Ctrl+Shift+C
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
                e.preventDefault(); // 阻止浏览器默认行为
                handleCopyTranscriptClick();
            }
        });

        // 添加加载动画的CSS
        const style = document.createElement('style');
        style.id = 'youtrascript-style'; // 给样式一个ID，方便后续清理
        style.textContent = `
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        `;
        document.head.appendChild(style);

        // 定义并添加全屏状态改变监听器
        fullscreenChangeHandler = () => {
            const button = document.getElementById('copy-transcript-btn');
            if (button) {
                if (document.fullscreenElement) {
                    button.style.display = 'none'; // 全屏时隐藏
                } else {
                    button.style.display = 'flex'; // 退出全屏时显示
                }
            }
        };
        document.addEventListener('fullscreenchange', fullscreenChangeHandler);

    }

    /**
     * 显示提示框
     * @param {string} message - 要显示的消息
     * @param {number} duration - 显示时长（毫秒）
     */
    function showToast(message, duration = 3000) {
        const toast = document.getElementById('transcript-toast');
        if (toast) {
            toast.textContent = message;
            toast.style.display = 'block';
            toast.style.opacity = '1';
            setTimeout(() => {
                toast.style.opacity = '0';
                setTimeout(() => {
                    toast.style.display = 'none';
                }, 300);
            }, duration);
        }
    }

    /**
     * 获取YouTube视频的字幕文本
     * @returns {Promise<string>} 视频字幕文本
     * @throws {Error} 如果无法找到字幕按钮或字幕面板
     */
    async function getYouTubeTranscript(attempt = 1) {
        console.log(`尝试获取字幕 (第 ${attempt} 次)...`);
        let transcriptOpened = false;

        try {
            // 查找"更多操作"按钮 - 增强选择器
            const moreActionsButton = document.querySelector('tp-yt-paper-button#expand');
            if (moreActionsButton) {
                moreActionsButton.click();
                await new Promise(r => setTimeout(r, 900)); // 等待菜单展开

                // 在展开的菜单中查找"显示字幕"选项，尝试多种语言
                const transcriptMenuItem = Array.from(document.querySelectorAll('button[aria-label]')).find(btn => 
                    btn.getAttribute('aria-label').toLowerCase().includes('transcript') || 
                    btn.getAttribute('aria-label').includes('字幕')
                );
                if (transcriptMenuItem) {
                    transcriptMenuItem.click();
                    transcriptOpened = true;
                    console.log("通过菜单成功点击了字幕按钮.");
                } else {
                    // 如果未找到字幕菜单项，则关闭菜单
                    moreActionsButton.click();
                }
            }
        } catch (e) {
            console.warn("尝试打开字幕菜单时发生错误:", e);
        }

        if (!transcriptOpened) {
            throw new Error('未能找到"显示字幕"按钮。此视频可能没有字幕。');
        }

        const transcriptPanelSelector = 'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
        const transcriptSegmentSelector = 'yt-formatted-string.ytd-transcript-segment-renderer';

        // 使用 MutationObserver 等待字幕面板加载
        const transcriptPanel = await waitForElement(transcriptPanelSelector, 20000);
        if (!transcriptPanel) {
            throw new Error('字幕面板未能加载，可能是网络问题或页面结构变化。');
        }
        if (!transcriptPanel.querySelector(transcriptSegmentSelector)) {
            throw new Error('字幕面板已加载，但没有找到字幕内容，可能是视频没有字幕或字幕未加载完成。');
        }

        // 提取字幕文本，使用`\n`分隔每个字幕段
        console.log("字幕面板已加载，开始提取字幕文本...");
        const segments = transcriptPanel.querySelectorAll(transcriptSegmentSelector);
        const transcriptText = Array.from(segments).map(s => s.textContent.trim()).join('\n');

        // 提取完后关闭字幕面板，尝试多种语言
        const closeButton = Array.from(document.querySelectorAll(`${transcriptPanelSelector} button[aria-label]`)).find(btn => 
            btn.getAttribute('aria-label').toLowerCase().includes('close') || 
            btn.getAttribute('aria-label').includes('关闭')
        );
        if (closeButton) {
            closeButton.click();
            console.log("字幕面板已关闭.");
        }

        if (!transcriptText) {
            throw new Error('字幕内容为空。');
        }
        console.log("字幕获取成功.");
        return transcriptText;
    }

    /**
     * 等待元素出现在 DOM 中
     * @param {string} selector - 元素选择器
     * @param {number} timeout - 超时时间（毫秒）
     * @returns {Promise<Element|null>} 找到的元素或 null
     */
    function waitForElement(selector, timeout) {
        return new Promise((resolve) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

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
     * 处理复制字幕按钮的点击事件
     */
    async function handleCopyTranscriptClick() {
        const btn = document.getElementById('copy-transcript-btn');
        if (btn.classList.contains('loading')) {
            return; // 避免重复点击
        }

        const videoId = new URLSearchParams(window.location.search).get('v');
        if (!videoId) {
            showToast('这不是一个有效的YouTube视频页面。');
            return;
        }

        btn.textContent = '⏳'; // 显示加载图标
        btn.style.animation = 'spin 1s linear infinite'; // 启动旋转动画
        btn.classList.add('loading');

        try {
            let transcript;
            try {
                transcript = await getYouTubeTranscript(1);
            } catch (err) {
                console.warn('第一次尝试获取字幕失败，准备重试:', err);
                showToast('第一次尝试失败，正在重试...');
                transcript = await getYouTubeTranscript(2);
            }
            GM_setClipboard(transcript); // 复制到剪贴板
            showToast('字幕已成功复制到剪贴板！');
            btn.textContent = '✓'; // 显示成功图标

            setTimeout(() => {
                btn.textContent = '📋'; // 3秒后恢复图标
            }, 3000);
        } catch (err) {
            console.error('复制字幕时发生错误:', err);
            showToast(`复制字幕失败: ${err.message}`);
        } finally {
            btn.style.animation = ''; // 停止动画
            btn.classList.remove('loading');
        }
    }

    /**
     * 初始化函数，在页面加载和YouTube导航完成后调用
     */
    function initialize() {
        // 只有在视频观看页面才创建按钮
        if (window.location.href.includes('/watch')) {
            createCopyButton();
        } else {
            // 如果不在视频页面，确保按钮和样式被移除
            const existingBtn = document.getElementById('copy-transcript-btn');
            if (existingBtn) {
                existingBtn.remove();
            }
            const existingStyle = document.getElementById('youtrascript-style');
            if (existingStyle) {
                existingStyle.remove();
            }
            // 移除全屏事件监听器
            if (fullscreenChangeHandler) {
                document.removeEventListener('fullscreenchange', fullscreenChangeHandler);
                fullscreenChangeHandler = null;
            }
        }
    }

    // 监听YouTube的导航完成事件，因为YouTube是单页应用，页面跳转不会刷新
    window.addEventListener('yt-navigate-finish', () => {
        // 延迟执行，确保DOM完全加载
        setTimeout(initialize, 500);
    });

    // 首次加载页面时执行初始化
    initialize();

})();
