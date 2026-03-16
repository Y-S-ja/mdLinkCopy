/**
 * Quick Md Copy - Offscreen Document Script
 * 
 * Provides background access to the Clipboard API. Necessary because 
 * Service Workers cannot interact with the system clipboard directly.
 */

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
    if (message.target === 'offscreen-clipboard') {
        copyToClipboard(message.data).then(success => {
            sendResponse({ success });
        });
    }
    return true;
});

/**
 * Executes the clipboard copy operation.
 * Tries the modern Clipboard API first, falling back to document.execCommand if necessary.
 * @param {string} text - The string to copy.
 * @returns {Promise<boolean>} - Success status.
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        try {
            const textArea = document.getElementById('copy-buffer');
            if (textArea) {
                textArea.value = text;
                textArea.select();
                return document.execCommand('copy');
            }
            return false;
        } catch (fallbackErr) {
            return false;
        }
    }
}
