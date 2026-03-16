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

chrome.runtime.onInstalled.addListener(async () => {
    chrome.contextMenus.create({
        id: "copy-selection-markdown",
        title: chrome.i18n.getMessage("contextMenuTitle") || "Copy Markdown link for selection",
        contexts: ["selection"]
    });

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

/**
 * Ensures a settings object has all required keys by filling missing values
 * from INITIAL_SETTINGS.
 * @param {Object} items - The raw settings items from storage or message.
 * @returns {Object} A complete settings object.
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
 * Fetches settings from chrome.storage.sync and returns a normalized object.
 * @param {string[]|null} keys - Keys to fetch, or null for all.
 * @returns {Promise<Object>}
 */
async function getSettings(keys = null) {
    const items = await chrome.storage.sync.get(keys || Object.keys(INITIAL_SETTINGS));
    return normalizeSettings(items);
}

/**
 * Listen for preview generation requests from the options page.
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
 * Handle context menu clicks to initiate selection-based copy.
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "copy-selection-markdown") {
        let expandedText = info.selectionText;
        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getExpandedSelectionTextInPage
            });
            if (result[0].result) {
                expandedText = result[0].result;
            }
        } catch (err) {
            // Fallback to raw selection if script injection is blocked (e.g., on restricted pages)
        }
        performSelectionCopy(expandedText, info.pageUrl, tab);
    }
});

/**
 * Handle global keyboard shortcuts for page and selection copy.
 */
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

/**
 * Checks if a URL is a restricted browser internal page where script injection is prohibited.
 * @param {string} url
 * @returns {boolean}
 */
function isRestrictedPage(url) {
    const restrictedPrefixes = ['chrome://', 'about:', 'https://chrome.google.com/webstore', 'edge://'];
    return !url || restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

/**
 * Shows a system notification as a fallback when UI toast injection is not possible.
 * @param {string} message
 */
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
 * Resolves the appropriate display message based on priority:
 * 1. Preset override (if UI matches browser lang, it uses i18n, else JS static string)
 * 2. User custom input (for 'custom' mode)
 * 3. System i18n fallback
 * 4. Hardcoded fallback string
 */
function resolveToastMessage(type, customValue, messageKey, statusKey) {
    const browserLang = (chrome.i18n.getUILanguage() || 'en').split('-')[0];

    // Handle language presets (ja, en, etc.)
    if (OVERRIDE_MESSAGES[type]) {
        // If the selected preset matches actual browser lang, try to get the most updated i18n string
        if (type === browserLang) {
            const i18nMsg = chrome.i18n.getMessage(messageKey);
            if (i18nMsg) return i18nMsg;
        }
        // Otherwise use the JS-defined backup for that language
        return OVERRIDE_MESSAGES[type][statusKey];
    }

    // Handle 'custom' mode: User input > Browser i18n > Default hardcoded string
    return (customValue && customValue.trim()) ||
        chrome.i18n.getMessage(messageKey) ||
        OVERRIDE_MESSAGES[FALLBACK_LANG][statusKey];
}

/**
 * Coordinated clipboard copy flow.
 * Attempts script injection (to show UI toast) with an offscreen document fallback 
 * for restricted pages or failure cases.
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

    if (isRestrictedPage(url)) {
        // Use offscreen fallback for restricted pages (Chrome internal pages, etc.)
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
        }).catch(async () => {
            // Service worker uses offscreen document when direct clipboard write in tab fails
            const success = await copyViaOffscreen(text);
            if (!success) {
                showSystemNotification(chrome.i18n.getMessage("notifyCopyFailed"));
            } else {
                showSystemNotification(chrome.i18n.getMessage("notifyCopySuccess"));
            }
        });
    }
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

chrome.action.onClicked.addListener((tab) => {
    copyPageLink(tab);
});

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

/**
 * Sanitizes page titles for use as Markdown link labels.
 */
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