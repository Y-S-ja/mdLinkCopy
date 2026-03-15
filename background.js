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

            const title = cleanLabel(demoTitle, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
            const selectionText = generateTextFragmentParam(
                demoSelection,
                settings['threshold'],
                settings['base-len'],
                settings['use-start-end-format'],
                settings['use-readable-fragment']
            );

            const pageUrl = demoUrl.split('#')[0];
            const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;
            const fragment = selectionText ? `#:~:text=${selectionText}` : '';
            const markdownLink = `[${title}](${finalUrl}${fragment})`;

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
 * Coordinated clipboard copy flow.
 * Attempts script injection (to show UI toast) with an offscreen document fallback 
 * for restricted pages or failure cases.
 */
async function dispatchCopy(tabId, url, text) {
    const settings = await getSettings(['notice-duration', 'toast-msg-success-type', 'toast-msg-success', 'toast-msg-failed-type', 'toast-msg-failed']);
    const duration = settings['notice-duration'];

    const uiLang = chrome.i18n.getMessage("defaultToastLang") || FALLBACK_LANG;
    const typeSuccess = settings['toast-msg-success-type'] || uiLang;
    const typeFailed = settings['toast-msg-failed-type'] || uiLang;

    let msgSuccess = '';
    if (OVERRIDE_MESSAGES[typeSuccess]) {
        msgSuccess = OVERRIDE_MESSAGES[typeSuccess].success;
    } else {
        msgSuccess = settings['toast-msg-success'] || (chrome.i18n.getMessage("toastCopySuccess") || OVERRIDE_MESSAGES[FALLBACK_LANG].success);
    }

    let msgFailed = '';
    if (OVERRIDE_MESSAGES[typeFailed]) {
        msgFailed = OVERRIDE_MESSAGES[typeFailed].failed;
    } else {
        msgFailed = settings['toast-msg-failed'] || (chrome.i18n.getMessage("toastCopyFailed") || OVERRIDE_MESSAGES[FALLBACK_LANG].failed);
    }

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

    const selectionText = generateTextFragmentParam(
        rawSelection,
        settings['threshold'],
        settings['base-len'],
        settings['use-start-end-format'],
        settings['use-readable-fragment']
    );

    const pageUrl = rawUrl.split('#')[0];
    const title = cleanLabel(tab.title, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
    const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;
    const fragment = `#:~:text=${selectionText}`;

    dispatchCopy(tab.id, tab.url, `[${title}](${finalUrl}${fragment})`);
}

/**
 * Handles basic page-link generation.
 */
async function copyPageLink(tab) {
    const settings = await getSettings(['use-readable-url', 'bracket-to-zenkaku', 'pipe-to-zenkaku']);
    const pageUrl = tab.url.split('#')[0];
    const title = cleanLabel(tab.title, settings['bracket-to-zenkaku'], settings['pipe-to-zenkaku']);
    const finalUrl = settings['use-readable-url'] ? getReadableUrl(pageUrl) : pageUrl;

    dispatchCopy(tab.id, tab.url, `[${title}](${finalUrl})`);
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