/**
 * Shared settings configuration for Quick Md Copy
 */

const INITIAL_SETTINGS = {
    'notice-duration': 1000,
    'threshold': 60,
    'base-len': 20,
    'use-readable-url': true,
    'use-start-end-format': true,
    'use-readable-fragment': true,
    'bracket-style': 'escape',
    'pipe-style': 'escape',
    'toast-msg-success-type': 'default',
    'toast-msg-success': () => chrome.i18n.getMessage("toastCopySuccess") || "Markdown Copied!",
    'toast-msg-failed-type': 'default',
    'toast-msg-failed': () => chrome.i18n.getMessage("toastCopyFailed") || "Copy Failed"
};

/**
 * Ensures a settings object has all required keys by filling missing values.
 * @param {Object} items - Raw items from storage.
 * @returns {Object} Normalized settings.
 */
function normalizeSettings(items) {
    const settings = {};

    for (const key in INITIAL_SETTINGS) {
        const entry = INITIAL_SETTINGS[key];
        const defaultValue = (typeof entry === 'function') ? entry() : entry;

        if (items && items[key] !== undefined && items[key] !== null) {
            settings[key] = items[key];
        } else {
            settings[key] = defaultValue;
        }
    }
    return settings;
}
