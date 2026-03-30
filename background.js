/**
 * Quick Md Copy - Background Service Worker
 * 
 * Orchestrates the extension lifecycle, manages context menus and global keyboard shortcuts.
 * Implements resilient link generation logic, including Text Fragments (Scroll to Text) 
 * and URL sanitization. Employs a robust fallback mechanism using Offscreen Documents 
 * to handle clipboard operations on restricted pages.
 */

importScripts('config.js');

/**
 * Extension Lifecycle: Initialize context menus and initialize default sync settings.
 */
chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.create({
        id: "copy-selection-markdown",
        title: chrome.i18n.getMessage("contextMenuTitle") || "Copy Markdown link for selection",
        contexts: ["selection"]
    });

    // Populate missing settings with defaults from config.js
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
        await chrome.storage.sync.set(newSettings);
    }
});

/**
 * Retrieves and normalizes settings from storage.
 * @param {string[]|null} keys - Specific setting keys to fetch, or null for all.
 * @returns {Promise<Object>} A normalized settings object.
 */
async function getSettings(keys = null) {
    const items = await chrome.storage.sync.get(keys || Object.keys(INITIAL_SETTINGS));
    return normalizeSettings(items);
}

/**
 * Message Hub: Listens for preview requests from the Options page.
 */
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.action === 'get-preview') {
        try {
            const { demoTitle, demoSelection, demoUrl, settings: rawSettings } = message.data;
            const settings = normalizeSettings(rawSettings);

            const markdownLink = createMarkdownLink(demoTitle, demoUrl, demoSelection, settings);
            sendResponse({ markdownLink });
        } catch (err) {
            sendResponse({ markdownLink: (chrome.i18n.getMessage("errPreviewGeneration") || "Error: ") + err.message });
        }
        return true;
    }
});

/**
 * Context Menu Handler: Triggers markdown link generation for selected text.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "copy-selection-markdown") {
        handleSelectionCopyFlow(tab, info.selectionText);
    }
});

/**
 * Action Button Handler: Triggers basic page-wide markdown link generation.
 */
chrome.action.onClicked.addListener((tab) => {
    copyPageLink(tab);
});

/**
 * Keyboard Command Handler: Maps global shortcuts to respective copy flows.
 */
chrome.commands.onCommand.addListener(async (command, tab) => {
    switch (command) {
        case "copy-page-md":
            copyPageLink(tab);
            break;
        case "copy-selection-md":
            handleSelectionCopyFlow(tab, null);
            break;
    }
});

/**
 * In-page Selection Expander: Logic to expand selection to nearest word boundaries.
 * Injected into the target tab. Uses the standard selection.modify API.
 * @returns {string|null} The expanded text or null if no selection exists.
 */
function getExpandedSelectionTextInPage() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;

    const originalRange = range.cloneRange();

    try {
        // Expand start to word boundary
        selection.collapseToStart();
        selection.modify('move', 'forward', 'character');
        selection.modify('move', 'backward', 'word');
        const startContainer = selection.anchorNode;
        const startOffset = selection.anchorOffset;

        // Expand end to word boundary
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

        // Cleanup: Restore original user selection
        selection.removeAllRanges();
        selection.addRange(originalRange);

        return text;
    } catch (e) {
        selection.removeAllRanges();
        selection.addRange(originalRange);
        return originalRange.toString();
    }
}

/**
 * Protocol Validator: Ensures a URL uses standard HTTP/HTTPS schemes.
 * @param {string} urlStr
 * @returns {boolean}
 */
function isStandardWebProtocol(urlStr) {
    try {
        const url = new URL(urlStr);
        return ['http:', 'https:'].includes(url.protocol);
    } catch (e) {
        return false;
    }
}

/**
 * Fallback UI: Displays a browser-level notification when in-page injection is blocked.
 * @param {string} message - The localized message to display.
 * @param {string|null} url - The page URL for determining restricted status context.
 */
function showSystemNotification(message, url = null) {
    const defaultMsg = url && !isStandardWebProtocol(url)
        ? chrome.i18n.getMessage("notifyRestrictedDefault")
        : "Restricted page";
    const notifyMsg = message || defaultMsg;
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon192x192.png',
        title: 'Quick Md Copy',
        message: notifyMsg,
        silent: true
    });
}

/**
 * Message Resolver: Determines the display text for success/failure notifications.
 * Prioritizes user custom configurations over defaults.
 * @param {Object} settings - Current localized/normalized settings.
 * @param {string} id - The ID prefix for the target message (success/failed).
 * @returns {string} The resolved message.
 */
function resolveToastMessage(settings, id) {
    const type = settings[`${id}-type`];
    const customValue = settings[id];

    if (type === 'custom' && customValue?.trim()) {
        return customValue.trim();
    }

    return getDefaultSetting(id);
}

/**
 * Resilient Dispatcher: Executes the clipboard operation.
 * 1. Attempts script injection for best-in-class UX (in-page toast).
 * 2. If injection fails (e.g., CSP restriction, New Tab page), falls back to 
 *    Offscreen Document + System Notification.
 * 
 * @param {number} tabId
 * @param {string} url
 * @param {string} text - The generated markdown link to copy.
 */
async function dispatchCopy(tabId, url, text) {
    const settings = await getSettings(['notice-duration', 'toast-msg-success-type', 'toast-msg-success', 'toast-msg-failed-type', 'toast-msg-failed']);
    const duration = settings['notice-duration'];

    const msgSuccess = resolveToastMessage(settings, 'toast-msg-success');
    const msgFailed = resolveToastMessage(settings, 'toast-msg-failed');

    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: copyToClipboardWithNotice,
        args: [text, duration, msgSuccess, msgFailed]
    }).catch(async () => {
        // Fallback for restricted pages (Chrome Settings, Extension store, etc.)
        const success = await copyViaOffscreen(text);

        let statusKey;
        if (success) {
            statusKey = isStandardWebProtocol(url) ? "notifyCopySuccess" : "notifyCopySuccessRestricted";
        } else {
            statusKey = isStandardWebProtocol(url) ? "notifyCopyFailed" : "notifyCopyFailedRestricted";
        }
        showSystemNotification(chrome.i18n.getMessage(statusKey));
    });
}

/**
 * Implementation for Selection Copy: Integrates Text Fragment logic.
 * @param {string} rawSelection - Text to expand into deep link.
 * @param {string} rawUrl - Target URL.
 * @param {chrome.tabs.Tab} tab - Target tab metadata for title extraction.
 */
async function performSelectionCopy(rawSelection, rawUrl, tab) {
    const settings = await getSettings([
        'threshold', 'base-len', 'use-readable-url', 'use-start-end-format',
        'use-readable-fragment', 'bracket-style', 'pipe-style'
    ]);

    const markdownLink = createMarkdownLink(tab.title, rawUrl, rawSelection, settings);
    dispatchCopy(tab.id, tab.url, markdownLink);
}

/**
 * Implementation for Page-wide Copy: Basic markdown generation.
 * @param {chrome.tabs.Tab} tab
 */
async function copyPageLink(tab) {
    const settings = await getSettings(['use-readable-url', 'bracket-style', 'pipe-style']);
    const markdownLink = createMarkdownLink(tab.title, tab.url, null, settings);
    dispatchCopy(tab.id, tab.url, markdownLink);
}

/**
 * Offscreen Clipboard Controller: Accesses Clipboard API from a background context.
 * Required because Service Workers lack direct document/clipboard access.
 * @param {string} text - Content to copy.
 * @returns {Promise<boolean>} Success status.
 */
async function copyViaOffscreen(text) {
    try {
        if (!(await chrome.offscreen.hasDocument?.())) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['CLIPBOARD'],
                justification: 'Service worker needs offscreen document to access the Clipboard API'
            });
        }
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen-clipboard',
            data: text
        });
        return response?.success || false;
    } catch (err) {
        return false;
    }
}

/**
 * Content Script Injection: Copies text to clipboard and displays a fleeting UI notice.
 * Designed for injected execution. Avoids 스타일(style) collisions via high z-index.
 * @param {string} text
 * @param {number} duration - Display time in ms.
 * @param {string} msgSuccess
 * @param {string} msgFailed
 */
async function copyToClipboardWithNotice(text, duration, msgSuccess, msgFailed) {
    try {
        await navigator.clipboard.writeText(text);
        showNotice(msgSuccess, "#2ecc71", duration);
    } catch (err) {
        showNotice(msgFailed, "#e74c3c", duration);
    }

    function showNotice(message, bgColor, displayMs) {
        const notice = document.createElement("div");
        notice.textContent = message;
        // Aesthetic styling for in-page notification
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

/**
 * Selection Link Flow Coordinator: Master controller for deep link creation.
 * Resolves selection text via script expansion or fallback context data.
 * Handles restriction-based error scenarios.
 * 
 * @param {chrome.tabs.Tab} tab
 * @param {string|null} fallbackText - Selection text provided by context menu API.
 */
async function handleSelectionCopyFlow(tab, fallbackText = null) {
    let finalSelection = fallbackText;
    let scriptFailed = false;

    try {
        // Attempt expansion to word boundary for cleaner Text Fragments
        const result = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: getExpandedSelectionTextInPage
        });
        if (result[0]?.result) {
            finalSelection = result[0].result;
        }
    } catch (err) {
        scriptFailed = true;
    }

    if (finalSelection) {
        performSelectionCopy(finalSelection, tab.url, tab);
    } else {
        const msgKey = scriptFailed ? "errShortcutRestricted" : "errNoTextSelected";
        showSystemNotification(chrome.i18n.getMessage(msgKey), tab.url);
    }
}

/**
 * Core Link Assembler: Primary utility for markdown construction.
 * Pure function integrating title cleaning, URL formatting, and Fragment calculation.
 * 
 * @param {string} title
 * @param {string} url
 * @param {string|null} selectionText
 * @param {Object} settings
 * @returns {string} Fully constructed Markdown link.
 */
function createMarkdownLink(title, url, selectionText, settings) {
    const cleanedTitle = cleanLabel(title, settings['bracket-style'], settings['pipe-style']);
    const pageUrl = url.split('#')[0];
    const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;

    let fragment = '';
    if (selectionText) {
        const param = generateTextFragmentParam(
            selectionText,
            settings['threshold'],
            settings['base-len'],
            settings['use-start-end-format'],
            settings['use-readable-fragment']
        );
        if (param) fragment = `#:~:text=${param}`;
    }

    return `[${cleanedTitle}](${finalUrl}${fragment})`;
}

/**
 * Markdown-Specific Encoder: Retains readability for Scroll to Text fragments while 
 * escaping characters that break Markdown link syntax (parentheses and spaces).
 * @param {string} text
 * @returns {string} URL-encoded string safe for Markdown.
 */
function safeSelectiveEncode(text) {
    // Escapes # & ( ) [ ] , - ? = and spaces. 
    // Optimization: Regex callback used to minimize repeated string allocations.
    return text.replace(/[%#&()\[\] ,\-?=\n]/g, (char) => {
        if (char === '\n') return '%20';
        if (char === '-') return '%2D';
        if (char === '(') return '%28';
        if (char === ')') return '%29';
        return encodeURIComponent(char);
    });
}

/**
 * Label Sanitizer: Cleans page titles for use as Markdown link descriptions.
 * Handles bracket/pipe conflicts based on user preferences.
 * 
 * @param {string} text
 * @param {string} bracketStyle - 'escape'|'zenkaku'|'remove'|'none'
 * @param {string} pipeStyle - 'escape'|'zenkaku'|'remove'|'none'
 * @returns {string} Sanitized single-line string.
 */
function cleanLabel(text, bracketStyle, pipeStyle) {
    if (!text) return "";
    let cleaned = text.replace(/\r?\n/g, ' ');

    // Handle brackets based on selected mode
    switch (bracketStyle) {
        case 'escape':
            cleaned = cleaned.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
            break;
        case 'zenkaku':
            cleaned = cleaned.replace(/\[/g, '［').replace(/\]/g, '］');
            break;
        case 'remove':
            cleaned = cleaned.replace(/[\[\]]/g, '');
            break;
        case 'none':
        default:
            // Keep as is
            break;
    }

    // Handle pipes based on selected mode
    switch (pipeStyle) {
        case 'escape':
            cleaned = cleaned.replace(/\|/g, '\\|');
            break;
        case 'zenkaku':
            cleaned = cleaned.replace(/\s*\|\s*/g, '｜');
            break;
        case 'remove':
            cleaned = cleaned.replace(/\|/g, '');
            break;
        case 'none':
        default:
            // Keep as is
            break;
    }

    return cleaned.trim();
}

/**
 * Fragment Parameter Generator: Calculates deep-linking anchor text.
 * Implements Google's 'Scroll to Text' specification with optional shortening.
 * Employes Intl.Segmenter for language-aware word boundary detection.
 */
function generateTextFragmentParam(text, threshold, baseLen, useStartEnd, useReadableFragment) {
    const cleanText = text.trim().replace(/\s+/g, ' ');
    const encoder = useReadableFragment ? safeSelectiveEncode : encodeURIComponent;

    // Use full text if within threshold or feature is disabled
    if (cleanText.length <= threshold || !useStartEnd) {
        return encoder(cleanText);
    }

    let segmenter;
    try {
        // Use Intl.Segmenter for robust word-level boundary detection across different languages.
        segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch (e) {
        segmenter = null;
    }

    /**
     * Inner helper to resolve the logical word boundary nearest to the target index.
     * @param {string} textStr
     * @param {number} targetIdx
     * @returns {number} The optimized boundary index.
     */
    function findBestBoundary(textStr, targetIdx) {
        if (!segmenter) return targetIdx;
        const segments = segmenter.segment(textStr);
        let lastBoundary = 0;

        for (const segment of segments) {
            const start = segment.index;
            const end = start + segment.segment.length;

            if (start <= targetIdx && end >= targetIdx) {
                const distToStart = targetIdx - start;
                const distToEnd = end - targetIdx;
                return (distToStart < distToEnd && start > 0) ? start : end;
            }
            lastBoundary = end;
            if (start > targetIdx) break;
        }
        return lastBoundary;
    }

    // Optimization: Calculate 'start' and 'end' parts separately based on scan ranges.
    const startScanRange = Math.min(cleanText.length, baseLen * 2);
    const actualStartEndIdx = findBestBoundary(cleanText.substring(0, startScanRange), baseLen);
    const startPart = cleanText.substring(0, actualStartEndIdx);

    const endScanOffset = Math.max(0, cleanText.length - baseLen * 2);
    const endScanText = cleanText.substring(endScanOffset);
    const targetIdxInSuffix = cleanText.length - baseLen - endScanOffset;
    const boundaryInSuffix = findBestBoundary(endScanText, targetIdxInSuffix);
    const actualEndStartIdx = endScanOffset + boundaryInSuffix;
    const endPart = cleanText.substring(actualEndStartIdx);

    // Fallback: If truncation overlap occurs unexpectedly, return full encoded text.
    if (actualStartEndIdx >= actualEndStartIdx) {
        return encoder(cleanText);
    }

    return `${encoder(startPart)},${encoder(endPart)}`;
}

/**
 * URL Beautifier: Converts encoded URLs to a readable format.
 * Re-escapes Markdown conflict characters (parentheses/spaces) without full Percent-encoding.
 * @param {string} rawUrl
 * @returns {string} Human-readable but valid Markdown URL.
 */
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