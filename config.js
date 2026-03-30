/**
 * Quick Md Copy - Shared Configuration & Schema
 * 
 * Defines the application's single source of truth for settings, default values, 
 * and data normalization logic. This file is shared between the background 
 * service worker and the options page.
 */

// Schema definition and default factory values
const INITIAL_SETTINGS = {
    'notice-duration': 1000,    // Duration (ms) for in-page "Copied" toast
    'threshold': 60,            // Length beyond which text fragments use start/end format
    'base-len': 20,             // Number of characters to take from start/end when shortening
    'use-readable-url': true,   // Human-readable (decoded) URLs in markdown
    'use-start-end-format': true, // Enable 'start,end' shortening for scroll-to-text
    'use-readable-fragment': true, // Use selective encoding for text fragments
    'bracket-style': 'escape',  // Mode for handling [ ] in page titles
    'pipe-style': 'escape',     // Mode for handling | in page titles
    'toast-msg-success-type': 'default', // 'default' or 'custom'
    'toast-msg-success': () => chrome.i18n.getMessage("toastCopySuccess") || "Markdown Copied!",
    'toast-msg-failed-type': 'default',  // 'default' or 'custom'
    'toast-msg-failed': () => chrome.i18n.getMessage("toastCopyFailed") || "Copy Failed"
};

/**
 * Resolves the default value for a specific setting key.
 * Dynamically evaluates functions (for i18n support) or returns literals.
 * @param {string} key - The setting key defined in INITIAL_SETTINGS.
 * @returns {any} The resolved default value.
 */
function getDefaultSetting(key) {
    const entry = INITIAL_SETTINGS[key];
    return (typeof entry === 'function') ? entry() : entry;
}

/**
 * Normalizes a raw settings object by ensuring all keys are present.
 * Missing or null values are fallback to defaults.
 * @param {Object} items - Raw settings object from chrome.storage.
 * @returns {Object} A sanitized settings object matching the schema.
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
