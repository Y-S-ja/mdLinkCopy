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
 * Retrieves the default value for a given setting key.
 * Handles both literal values and dynamic functions in INITIAL_SETTINGS.
 * @param {string} key
 * @returns {*}
 */
function getDefaultSetting(key) {
    const entry = INITIAL_SETTINGS[key];
    return (typeof entry === 'function') ? entry() : entry;
}

/**
 * Ensures a settings object has all required keys by filling missing values.
 * @param {Object} items - Raw items from storage.
 * @returns {Object} Normalized settings.
 */
function normalizeSettings(items) {
    const settings = {};

    for (const key in INITIAL_SETTINGS) {
        if (items && items[key] !== undefined && items[key] !== null) {
            settings[key] = items[key];
        } else {
            settings[key] = getDefaultSetting(key);
        }
    }
    return settings;
}
