/**
 * Quick Md Copy - Background Service Worker
 * 
 * Handles core extension lifecycle events, context menus, global shortcuts, 
 * and complex link generation logic (including Text Fragments and URL sanitization).
 */

// Initial default settings
const INITIAL_SETTINGS = {
    'notice-duration': 1000,
    'threshold': 60,
    'base-len': 20,
    'use-readable-url': true,
    'use-start-end-format': true,
    'use-readable-fragment': true,
    'bracket-to-zenkaku': true,
    'pipe-to-zenkaku': true,
    'toast-msg-success-type': 'default',
    'toast-msg-success': '',
    'toast-msg-failed-type': 'default',
    'toast-msg-failed': ''
};

const FALLBACK_LANG = chrome.runtime.getManifest().default_locale || 'en';

// Final fallback strings used if i18n resources are missing.
const OVERRIDE_MESSAGES = {
    success: "Markdown Copied!",
    failed: "Copy Failed"
};

/**
 * Extension entry point: Initialize context menus and default settings.
 */
chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.create({
        id: "copy-selection-markdown",
        title: chrome.i18n.getMessage("contextMenuTitle") || "Copy Markdown link for selection",
        contexts: ["selection"]
    });

    const currentSettings = await chrome.storage.sync.get(Object.keys(INITIAL_SETTINGS));
    const newSettings = {};
    let needsUpdate = false;

    // Set defaults for any missing settings
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

/**
 * Ensures a settings object has all required keys by filling missing values.
 * @param {Object} items - Raw items from storage.
 * @returns {Object} Normalized settings.
 */
function normalizeSettings(items) {
    const settings = { ...INITIAL_SETTINGS };
    if (!items) return settings;

    for (const key in INITIAL_SETTINGS) {
        if (items[key] !== undefined && items[key] !== null) {
            settings[key] = items[key];
        }
    }
    return settings;
}

/**
 * Fetches and normalizes settings from sync storage.
 * @param {string[]|null} keys - Specific keys to fetch.
 * @returns {Promise<Object>}
 */
async function getSettings(keys = null) {
    const items = await chrome.storage.sync.get(keys || Object.keys(INITIAL_SETTINGS));
    return normalizeSettings(items);
}

/**
 * Listens for preview requests from the options page.
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
 * Listens for context menu clicks.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "copy-selection-markdown") {
        handleSelectionCopyFlow(tab, info.selectionText);
    }
});

/**
 * Listens for action button clicks (page-wide copy).
 */
chrome.action.onClicked.addListener((tab) => {
    copyPageLink(tab);
});

/**
 * Handles global keyboard shortcuts for page and selection copy.
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

/**
 * Checks if a URL uses a standard web protocol (http or https).
 * Links to other protocols (chrome://, file://, etc.) generally cannot be opened directly.
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
 * Shows a system notification as a fallback when UI toast injection is not possible.
 * @param {string} message
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
 * Resolves the appropriate display message based on priority:
 * 1. User custom input (if 'custom' mode)
 * 2. System i18n fallback
 * 3. Hardcoded English fallback string
 */
function resolveToastMessage(type, customValue, messageKey, statusKey) {
    if (type === 'custom' && customValue?.trim()) {
        return customValue.trim();
    }
    return chrome.i18n.getMessage(messageKey) || OVERRIDE_MESSAGES[statusKey];
}

/**
 * Coordinated clipboard copy flow.
 * Attempts script injection to show UI toast first. 
 * Falls back to system notifications via offscreen document for restricted/failed cases.
 * 
 * @param {number} tabId
 * @param {string} url
 * @param {string} text - Link content to copy.
 */
async function dispatchCopy(tabId, url, text) {
    const settings = await getSettings(['notice-duration', 'toast-msg-success-type', 'toast-msg-success', 'toast-msg-failed-type', 'toast-msg-failed']);
    const duration = settings['notice-duration'];

    const uiLang = chrome.i18n.getMessage("defaultToastLang") || FALLBACK_LANG;

    const msgSuccess = resolveToastMessage(
        settings['toast-msg-success-type'] || uiLang,
        settings['toast-msg-success'],
        "toastCopySuccess",
        "success"
    );

    const msgFailed = resolveToastMessage(
        settings['toast-msg-failed-type'] || uiLang,
        settings['toast-msg-failed'],
        "toastCopyFailed",
        "failed"
    );

    // Attempt injection. This provides the best UX (in-page toast).
    chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: copyToClipboardWithNotice,
        args: [text, duration, msgSuccess, msgFailed]
    }).catch(async () => {
        // Fallback: offscreen document handles clipboard access when scripts are blocked or tab is dead.
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
 * Handles link generation For text selection.
 * Generates an 'Scroll to Text' fragment.
 */
async function performSelectionCopy(rawSelection, rawUrl, tab) {
    const settings = await getSettings([
        'threshold', 'base-len', 'use-readable-url', 'use-start-end-format',
        'use-readable-fragment', 'bracket-to-zenkaku', 'pipe-to-zenkaku'
    ]);

    const markdownLink = createMarkdownLink(tab.title, rawUrl, rawSelection, settings);
    dispatchCopy(tab.id, tab.url, markdownLink);
}

/**
 * Handles basic page-link generation.
 */
async function copyPageLink(tab) {
    const settings = await getSettings(['use-readable-url', 'bracket-to-zenkaku', 'pipe-to-zenkaku']);
    const markdownLink = createMarkdownLink(tab.title, tab.url, null, settings);
    dispatchCopy(tab.id, tab.url, markdownLink);
}

/**
 * Helper for copying content when page permissions are limited (e.g. New Tab page).
 * Necessary because service workers do not have direct clipboard access.
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
 * Script injected into the page to copy text and show a temporary UI notification.
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
 * Coordinated selection copy flow from different entry points.
 * Tries to expand selection via script, but falls back to provided text if injection fails.
 * @param {chrome.tabs.Tab} tab
 * @param {string|null} fallbackText
 */
async function handleSelectionCopyFlow(tab, fallbackText = null) {
    let finalSelection = fallbackText;
    let scriptFailed = false;

    try {
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
        // If script failed and we have no fallback, it's a restricted page shortcut attempt
        const msgKey = scriptFailed ? "errShortcutRestricted" : "errNoTextSelected";
        showSystemNotification(chrome.i18n.getMessage(msgKey), tab.url);
    }
}

/**
 * Core utility to assemble a Markdown link.
 * Integrates title cleaning, URL formatting, and text fragment generation.
 * @param {string} title - Raw page or demo title.
 * @param {string} url - Raw URL.
 * @param {string|null} selectionText - Optional selected text for fragments.
 * @param {Object} settings - Normalized settings object.
 * @returns {string} The formatted Markdown link.
 */
function createMarkdownLink(title, url, selectionText, settings) {
    const cleanedTitle = cleanLabel(title, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
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
 * Encodes specific characters to keep 'Scroll to Text' fragments readable 
 * while ensuring they are Markdown-safe (escaping parentheses and spaces).
 * @param {string} text
 * @returns {string}
 */
function safeSelectiveEncode(text) {
    // Replace characters that could break Markdown links ([])() or Text Fragment syntax (#&,=-).
    // Using a single regex pass with a capture group and a map for better performance.
    return text.replace(/[%#&()\[\] ,\-?=\n]/g, (char) => {
        if (char === '\n') return '%20';
        return encodeURIComponent(char);
    });
}

/**
 * Sanitizes page titles for use as Markdown link labels.
 * @param {string} text
 * @param {boolean} bracketToZenkaku
 * @param {boolean} pipeToZenkaku
 * @returns {string}
 */
function cleanLabel(text, bracketToZenkaku, pipeToZenkaku) {
    if (!text) return "";
    let cleaned = text.replace(/\r?\n/g, ' ');

    // Convert/remove Markdown-breaking characters in labels
    if (bracketToZenkaku) {
        cleaned = cleaned.replace(/\[/g, '［').replace(/\]/g, '］');
    } else {
        cleaned = cleaned.replace(/[\[\]]/g, '');
    }

    // Convert pipe characters to prevent table layout breaks
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

    /**
     * Helper to find a word boundary near a specific index.
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
                // Return start or end based on proximity, preferring end at the very start
                return (distToStart < distToEnd && start > 0) ? start : end;
            }
            lastBoundary = end;
            if (start > targetIdx) break; // Optimization: stop scanning once we pass target
        }
        return lastBoundary;
    }

    // Optimization: Only scan relevant parts of the text for boundaries
    // For startPart: scan double the baseLen at the beginning
    const startScanRange = Math.min(cleanText.length, baseLen * 2);
    const actualStartEndIdx = findBestBoundary(cleanText.substring(0, startScanRange), baseLen);
    const startPart = cleanText.substring(0, actualStartEndIdx);

    // For endPart: scan double the baseLen at the end
    const endScanOffset = Math.max(0, cleanText.length - baseLen * 2);
    const endScanText = cleanText.substring(endScanOffset);
    const targetIdxInSuffix = cleanText.length - baseLen - endScanOffset;
    const boundaryInSuffix = findBestBoundary(endScanText, targetIdxInSuffix);
    const actualEndStartIdx = endScanOffset + boundaryInSuffix;
    const endPart = cleanText.substring(actualEndStartIdx);

    if (actualStartEndIdx >= actualEndStartIdx) {
        return encoder(cleanText);
    }

    return `${encoder(startPart)},${encoder(endPart)}`;
}

/**
 * Decodes URL to make it readable in Markdown, while re-encoding 
 * characters that break Markdown syntax.
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