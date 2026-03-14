/**
 * Quick Md Copy - Offscreen Document Script
 * This script runs in a hidden offscreen document to provide clipboard access 
 * on restricted pages where background scripts or content scripts cannot copy directly.
 */

// Listen for clipboard copy requests from the background service worker
chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.target === 'offscreen-clipboard') {
        copyToClipboard(message.data).then(success => {
            sendResponse({ success });
        });
    }
    return true; // Keep message channel open for async response
});

/**
 * Executes the clipboard copy operation.
 * Tries the modern Clipboard API first, falling back to document.execCommand if necessary.
 * @param {string} text - The string to copy.
 * @returns {Promise<boolean>} - Success status.
 */
async function copyToClipboard(text) {
    try {
        // Modern approach
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.warn('Clipboard API failed in offscreen, trying fallback:', err);
        // Fallback for environments where Clipboard API might fail
        try {
            const textArea = document.getElementById('copy-buffer');
            if (textArea) {
                textArea.value = text;
                textArea.select();
                return document.execCommand('copy');
            }
            return false;
        } catch (fallbackErr) {
            console.error('All offscreen copy methods failed:', fallbackErr);
            return false;
        }
    }
}
