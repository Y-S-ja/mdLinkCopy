/**
 * Quick Md Copy - Background Service Worker
 * This script handles context menu creation, shortcut commands, and link generation logic.
 */

// Define initial user settings
const INITIAL_SETTINGS = {
    'notice-duration': 1000,
    'threshold': 60,
    'base-len': 20,
    'use-readable-url': true,
    'use-start-end-format': true,
    'use-readable-fragment': true,
    'bracket-to-zenkaku': true,
    'pipe-to-zenkaku': true,
    'toast-msg-success-type': '',
    'toast-msg-success': '',
    'toast-msg-failed-type': '',
    'toast-msg-failed': ''
};

// Global fallback language obtained directly from manifest file
const FALLBACK_LANG = chrome.runtime.getManifest().default_locale || 'en';

// Locale-specific static overrides for UI languages
const OVERRIDE_MESSAGES = {
    ja: {
        success: "Markdownをコピーしました！",
        failed: "コピーに失敗しました"
    },
    en: {
        success: "Markdown Copied!",
        failed: "Copy Failed"
    }
};

// Initialize extension settings and context menus on installation
chrome.runtime.onInstalled.addListener(async () => {
    // Create context menu for text selection
    chrome.contextMenus.create({
        id: "copy-selection-markdown",
        title: chrome.i18n.getMessage("contextMenuTitle") || "Copy Markdown link for selection",
        contexts: ["selection"]
    });

    // Populate default settings if not already present
    const currentSettings = await chrome.storage.sync.get(Object.keys(INITIAL_SETTINGS));
    const newSettings = {};
    let needsUpdate = false;

    for (const [key, defaultValue] of Object.entries(INITIAL_SETTINGS)) {
        if (currentSettings[key] === undefined) {
            newSettings[key] = defaultValue;
            needsUpdate = true;
        }
    }

    if (needsUpdate) {
        chrome.storage.sync.set(newSettings);
    }
});

// Message listener for live preview on options page
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === 'get-preview') {
        try {
            const { demoTitle, demoSelection, demoUrl, settings } = message.data;

            const title = cleanLabel(demoTitle, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
            const selectionText = generateTextFragmentParam(
                demoSelection,
                settings['threshold'] || 60,
                settings['base-len'] || 20,
                settings['use-start-end-format'],
                settings['use-readable-fragment']
            );

            const pageUrl = demoUrl.split('#')[0];
            const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;
            const fragment = selectionText ? `#:~:text=${selectionText}` : '';
            const markdownLink = `[${title}](${finalUrl}${fragment})`;

            sendResponse({ markdownLink });
        } catch (err) {
            console.error('Preview generation failed:', err);
            sendResponse({ markdownLink: (chrome.i18n.getMessage("errPreviewGeneration") || "Error: ") + err.message });
        }
        return true;
    }
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "copy-selection-markdown") {
        let expandedText = info.selectionText;
        try {
            // Expand selection to word boundaries by executing a script in the tab
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getExpandedSelectionTextInPage
            });
            if (result[0].result) {
                expandedText = result[0].result;
            }
        } catch (err) {
            console.warn('Failed to expand selection on page, using raw selection:', err);
        }
        performSelectionCopy(expandedText, info.pageUrl, tab);
    }
});

// Handle keyboard shortcuts defined in manifest
chrome.commands.onCommand.addListener(async (command, tab) => {
    switch (command) {
        case "copy-page-md":
            copyPageLink(tab);
            break;

        case "copy-selection-md": {
            if (isRestrictedPage(tab.url)) {
                showSystemNotification(chrome.i18n.getMessage("errShortcutRestricted"));
                return;
            }

            try {
                const result = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: getExpandedSelectionTextInPage
                });
                const selection = result[0].result;
                if (selection) {
                    performSelectionCopy(selection, tab.url, tab);
                } else {
                    showSystemNotification(chrome.i18n.getMessage("errNoTextSelected"));
                }
            } catch (err) {
                console.error('Shortcut capture failed:', err);
                showSystemNotification(chrome.i18n.getMessage("errScriptBlocked"));
            }
            break;
        }
    }
});

/**
 * Script injected into the page to expand the selection to the nearest word border.
 * Note: uses selection.modify which is a standard Chromium feature.
 */
function getExpandedSelectionTextInPage() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;

    const originalRange = range.cloneRange();

    try {
        // Find start of the word
        selection.collapseToStart();
        selection.modify('move', 'forward', 'character');
        selection.modify('move', 'backward', 'word');
        const startContainer = selection.anchorNode;
        const startOffset = selection.anchorOffset;

        // Find end of the word
        selection.removeAllRanges();
        selection.addRange(originalRange);
        selection.collapseToEnd();
        selection.modify('move', 'backward', 'character');
        selection.modify('move', 'forward', 'word');
        const endContainer = selection.focusNode;
        const endOffset = selection.focusOffset;

        const expandedRange = document.createRange();
        expandedRange.setStart(startContainer, startOffset);
        expandedRange.setEnd(endContainer, endOffset);
        const text = expandedRange.toString();

        // Restore original selection
        selection.removeAllRanges();
        selection.addRange(originalRange);

        return text;
    } catch (e) {
        selection.removeAllRanges();
        selection.addRange(originalRange);
        return originalRange.toString();
    }
}

// Check if the current page is restricted (e.g. Chrome settings, Web Store)
function isRestrictedPage(url) {
    const restrictedPrefixes = ['chrome://', 'about:', 'https://chrome.google.com/webstore', 'edge://'];
    return !url || restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

// Show a system notification when page script injection is restricted
function showSystemNotification(message) {
    const notifyMsg = message || chrome.i18n.getMessage("notifyRestrictedDefault") || "Restricted page";
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon192x192.png',
        title: 'Quick Md Copy',
        message: notifyMsg,
        silent: true
    });
}

/**
 * Unified function to handle clipboard writes either via page script injection or offscreen document.
 */
// Handle the core logic for copying a Markdown link to the clipboard
async function dispatchCopy(tabId, url, text) {
    const items = await chrome.storage.sync.get(['notice-duration', 'toast-msg-success-type', 'toast-msg-success', 'toast-msg-failed-type', 'toast-msg-failed']);
    const duration = items['notice-duration'] || INITIAL_SETTINGS['notice-duration'];
    
    // Resolve UI languages using messages.json mapping or fallback to manifest default locale
    const uiLang = chrome.i18n.getMessage("defaultToastLang") || FALLBACK_LANG;
    const typeSuccess = items['toast-msg-success-type'] || uiLang;
    const typeFailed = items['toast-msg-failed-type'] || uiLang;
    
    // Determine the success message
    let msgSuccess = '';
    if (OVERRIDE_MESSAGES[typeSuccess]) {
        msgSuccess = OVERRIDE_MESSAGES[typeSuccess].success;
    } else {
        msgSuccess = items['toast-msg-success'] || (chrome.i18n.getMessage("toastCopySuccess") || OVERRIDE_MESSAGES[FALLBACK_LANG].success);
    }
    
    // Determine the failed message
    let msgFailed = '';
    if (OVERRIDE_MESSAGES[typeFailed]) {
        msgFailed = OVERRIDE_MESSAGES[typeFailed].failed;
    } else {
        msgFailed = items['toast-msg-failed'] || (chrome.i18n.getMessage("toastCopyFailed") || OVERRIDE_MESSAGES[FALLBACK_LANG].failed);
    }

    if (isRestrictedPage(url)) {
        const success = await copyViaOffscreen(text);
        if (success) {
            showSystemNotification(chrome.i18n.getMessage("notifyCopySuccessRestricted"));
        } else {
            showSystemNotification(chrome.i18n.getMessage("notifyCopyFailedRestricted"));
        }
    } else {
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: copyToClipboardWithNotice,
            args: [text, duration, msgSuccess, msgFailed]
        }).catch(async (err) => {
            console.warn('Script injection failed, trying offscreen fallback:', err);
            const success = await copyViaOffscreen(text);
            if (!success) {
                showSystemNotification(chrome.i18n.getMessage("notifyCopyFailed"));
            } else {
                showSystemNotification(chrome.i18n.getMessage("notifyCopySuccess"));
            }
        });
    }
}

// Logic for selection-based Markdown link generation
async function performSelectionCopy(rawSelection, rawUrl, tab) {
    const settings = await chrome.storage.sync.get([
        'threshold', 'base-len', 'use-readable-url', 'use-start-end-format',
        'use-readable-fragment', 'bracket-to-zenkaku', 'pipe-to-zenkaku'
    ]);

    const selectionText = generateTextFragmentParam(
        rawSelection,
        settings['threshold'] || 60,
        settings['base-len'] || 20,
        settings['use-start-end-format'],
        settings['use-readable-fragment']
    );

    const pageUrl = rawUrl.split('#')[0];
    const title = cleanLabel(tab.title, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
    const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;
    const fragment = `#:~:text=${selectionText}`;

    dispatchCopy(tab.id, tab.url, `[${title}](${finalUrl}${fragment})`);
}

// Logic for page-based Markdown link generation
async function copyPageLink(tab) {
    const settings = await chrome.storage.sync.get(['use-readable-url', 'bracket-to-zenkaku', 'pipe-to-zenkaku']);
    const pageUrl = tab.url.split('#')[0];
    const title = cleanLabel(tab.title, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
    const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;

    dispatchCopy(tab.id, tab.url, `[${title}](${finalUrl})`);
}

chrome.action.onClicked.addListener((tab) => {
    copyPageLink(tab);
});

// Helper for copying clipboard content when page permissions are limited (e.g. New Tab page)
async function copyViaOffscreen(text) {
    try {
        if (!(await chrome.offscreen.hasDocument?.())) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['CLIPBOARD'],
                justification: 'Copying Markdown links to clipboard'
            });
        }
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen-clipboard',
            data: text
        });
        return response?.success || false;
    } catch (err) {
        console.error('copyViaOffscreen failed:', err);
        return false;
    }
}

/**
 * Script injected into the page to copy text and show a temporary UI notification.
 */
async function copyToClipboardWithNotice(text, duration, msgSuccess, msgFailed) {
    try {
        await navigator.clipboard.writeText(text);
        showNotice(msgSuccess || "Markdown Copied!", "#2ecc71", duration);
    } catch (err) {
        showNotice(msgFailed || "Copy Failed", "#e74c3c", duration);
    }

    function showNotice(message, bgColor, displayMs) {
        const notice = document.createElement("div");
        notice.textContent = message;
        Object.assign(notice.style, {
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: bgColor,
            color: "white",
            padding: "10px 20px",
            borderRadius: "20px",
            zIndex: String(2 ** 31 - 1),
            fontSize: "14px",
            fontWeight: "bold",
            fontFamily: "sans-serif",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            pointerEvents: "none",
            transition: "opacity 0.4s, transform 0.4s"
        });

        document.body.appendChild(notice);

        setTimeout(() => {
            notice.style.opacity = "0";
            notice.style.transform = "translateX(-50%) translateY(-10px)";
            setTimeout(() => notice.remove(), 400);
        }, displayMs);
    }
}

// Encode specific characters to keep URLs readable but Markdown-safe
function safeSelectiveEncode(text) {
    return text
        .replace(/%/g, '%25')
        .replace(/ /g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/#/g, '%23')
        .replace(/,/g, '%2C')
        .replace(/-/g, '%2D')
        .replace(/&/g, '%26')
        .replace(/\n/g, '%20');
}

// Sanitize title for use as a Markdown label
function cleanLabel(text, bracketToZenkaku, pipeToZenkaku) {
    if (!text) return "";
    let cleaned = text.replace(/\r?\n/g, ' ');

    if (bracketToZenkaku) {
        cleaned = cleaned.replace(/\[/g, '［').replace(/\]/g, '］');
    } else {
        cleaned = cleaned.replace(/[\[\]]/g, '');
    }

    if (pipeToZenkaku) {
        cleaned = cleaned.replace(/\s*\|\s*/g, '｜');
    }

    return cleaned.trim();
}

/**
 * Generate Text Fragment parameters based on settings.
 * Supports shortening long texts into a 'start,end' format.
 */
function generateTextFragmentParam(text, threshold, baseLen, useStartEnd, useReadableFragment) {
    const cleanText = text.trim().replace(/\s+/g, ' ');
    const encoder = useReadableFragment ? safeSelectiveEncode : encodeURIComponent;

    if (cleanText.length <= threshold || !useStartEnd) {
        return encoder(cleanText);
    }

    let segmenter;
    try {
        segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch (e) {
        segmenter = null;
    }

    // Start Part extraction (find the best word boundary near baseLen)
    let startPart = "";
    let actualStartEndIdx = baseLen;
    if (segmenter) {
        const segments = Array.from(segmenter.segment(cleanText));
        for (const segment of segments) {
            const segmentStartIdx = segment.index;
            const segmentEndIdx = segmentStartIdx + segment.segment.length;

            // Check if the current segment contains the target baseLen index
            if (segmentStartIdx <= baseLen && segmentEndIdx >= baseLen) {
                const distanceToStart = baseLen - segmentStartIdx;
                const distanceToEnd = segmentEndIdx - baseLen;

                // Choose the closer boundary, but prefer segmentEnd if at the absolute start
                const isStartBoundaryCloser = distanceToStart < distanceToEnd;
                const useSegmentStart = isStartBoundaryCloser && segmentStartIdx > 0;

                actualStartEndIdx = useSegmentStart ? segmentStartIdx : segmentEndIdx;
                startPart = cleanText.substring(0, actualStartEndIdx);
                break;
            }
        }
    } else {
        startPart = cleanText.substring(0, baseLen);
        const followingText = cleanText.substring(baseLen);
        const startExtension = followingText.match(/^[^\s,.;:!?]*/);
        if (startExtension) {
            startPart += startExtension[0];
            actualStartEndIdx = baseLen + startExtension[0].length;
        }
    }

    // End Part extraction (find the best word boundary near the end)
    let endPart = "";
    let actualEndStartIdx = cleanText.length - baseLen;
    if (segmenter) {
        const segments = Array.from(segmenter.segment(cleanText));
        const targetIdx = cleanText.length - baseLen;

        for (const segment of segments) {
            const segmentStartIdx = segment.index;
            const segmentEndIdx = segmentStartIdx + segment.segment.length;

            if (segmentStartIdx <= targetIdx && segmentEndIdx >= targetIdx) {
                const distanceToStart = targetIdx - segmentStartIdx;
                const distanceToEnd = segmentEndIdx - targetIdx;

                // Choose the closer boundary, but prefer segmentStart if at the absolute end
                const isEndBoundaryCloser = distanceToEnd < distanceToStart;
                const useSegmentEnd = isEndBoundaryCloser && segmentEndIdx < cleanText.length;

                actualEndStartIdx = useSegmentEnd ? segmentEndIdx : segmentStartIdx;
                endPart = cleanText.substring(actualEndStartIdx);
                break;
            }
        }
    } else {
        endPart = cleanText.substring(cleanText.length - baseLen);
        const leadingText = cleanText.substring(0, cleanText.length - baseLen);
        const endExtension = leadingText.match(/[^\s,.;:!?]*$/);
        if (endExtension) {
            endPart = endExtension[0] + endPart;
            actualEndStartIdx = cleanText.length - baseLen - endExtension[0].length;
        }
    }

    // Prevent overlap duplication: return full text if start and end boundaries cross
    if (actualStartEndIdx >= actualEndStartIdx) {
        return encoder(cleanText);
    }

    return `${encoder(startPart)},${encoder(endPart)}`;
}

// Decode tab.url while keeping it Markdown-safe
function getReadableUrl(rawUrl) {
    try {
        return decodeURI(rawUrl)
            .replace(/ /g, '%20')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
    } catch (e) {
        return rawUrl;
    }
}