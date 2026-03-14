/**
 * Quick Md Copy - Options Page Logic
 * Manages user settings, live preview updates, and panel visibility.
 */

const settingIds = [
    'notice-duration',
    'threshold',
    'base-len',
    'use-readable-url',
    'use-start-end-format',
    'use-readable-fragment',
    'bracket-to-zenkaku',
    'pipe-to-zenkaku',
    'toast-msg-success-type',
    'toast-msg-success',
    'toast-msg-failed-type',
    'toast-msg-failed'
];

// Constants and fallback definitions
const FALLBACK_LANG = chrome.runtime.getManifest().default_locale || 'en';

// Mapping of text setting IDs to their default translated fallback strings
const defaultTextSettings = {
    'toast-msg-success': () => chrome.i18n.getMessage("toastCopySuccess") || "Markdown Copied!",
    'toast-msg-failed': () => chrome.i18n.getMessage("toastCopyFailed") || "Copy Failed"
};

// Load settings from chrome.storage.sync
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
        // Initialize default UI language for missing select type
        const defaultUiLang = chrome.i18n.getMessage("defaultToastLang") || FALLBACK_LANG;
        if (items['toast-msg-success-type'] === undefined) items['toast-msg-success-type'] = defaultUiLang;
        if (items['toast-msg-failed-type'] === undefined) items['toast-msg-failed-type'] = defaultUiLang;

        settingIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            switch (el.type) {
                case 'checkbox':
                    if (items[id] !== undefined) el.checked = items[id];
                    break;
                case 'text':
                    if (items[id] !== undefined) {
                        let textVal = items[id];
                        if (textVal.trim() === '' && defaultTextSettings[id]) {
                            textVal = defaultTextSettings[id]();
                        }
                        el.value = textVal;
                    } else if (defaultTextSettings[id]) {
                        // Inject default strings if not stored yet
                        el.value = defaultTextSettings[id]();
                    }
                    break;
                case 'select-one': // Dropdown <select>
                    if (items[id] !== undefined) {
                        el.value = items[id];
                    } else {
                        el.value = id.includes('success') ? items['toast-msg-success-type'] : items['toast-msg-failed-type'];
                    }
                    break;
                case 'number':
                default:
                    if (items[id] !== undefined) el.value = items[id];
                    break;
            }
        });
        enforceBaseLenLimit(); // Apply limits based on loaded values
        enforceCustomInputVisibility(); // Show or hide textboxes
        updatePreview(); // Initialize preview after loading settings
    });
}

// Adjust the maximum attribute for base-len dynamically and clamp it if necessary
function enforceBaseLenLimit() {
    const thresholdEl = document.getElementById('threshold');
    const baseLenEl = document.getElementById('base-len');
    if (!thresholdEl || !baseLenEl) return;

    const thresholdVal = parseInt(thresholdEl.value, 10);
    if (isNaN(thresholdVal)) return;

    const maxBaseLen = Math.floor(thresholdVal / 2);
    baseLenEl.max = maxBaseLen; // Update UI max attribute

    const currentBaseLen = parseInt(baseLenEl.value, 10);
    if (!isNaN(currentBaseLen) && currentBaseLen > maxBaseLen) {
        baseLenEl.value = maxBaseLen;
        chrome.storage.sync.set({ 'base-len': maxBaseLen }); // Persist clamped value
    }
}

// Show/hide the custom text input fields based on dropdown selection
function enforceCustomInputVisibility() {
    ['success', 'failed'].forEach(type => {
        const selectEl = document.getElementById(`toast-msg-${type}-type`);
        const groupEl = document.getElementById(`group-toast-msg-${type}`);
        if (selectEl && groupEl) {
            if (selectEl.value === 'custom') {
                groupEl.classList.add('show');
            } else {
                groupEl.classList.remove('show');
            }
        }
    });
}

// Save a specific setting to chrome.storage.sync
function saveSetting(id) {
    const el = document.getElementById(id);
    if (!el) return;
    let value;

    switch (el.type) {
        case 'checkbox':
            value = el.checked;
            break;
        case 'select-one':
            value = el.value;
            break;
        case 'text':
            value = el.value.trim();
            if (value === '' && defaultTextSettings[id]) {
                value = defaultTextSettings[id]();
                el.value = value;
            }
            break;
        case 'number':
        default:
            value = parseInt(el.value, 10);
            if (isNaN(value)) return;

            // Clamp the value to min/max if the attributes exist
            if (el.hasAttribute('min')) {
                const minVal = parseInt(el.getAttribute('min'), 10);
                if (!isNaN(minVal) && value < minVal) {
                    value = minVal;
                }
            }
            if (el.hasAttribute('max')) {
                const maxVal = parseInt(el.getAttribute('max'), 10);
                if (!isNaN(maxVal) && value > maxVal) {
                    value = maxVal;
                }
            }

            // Fallback for non-negative values if no min is specified
            if (value < 0) value = 0;

            // Update the UI input field to visually reflect the clamped value
            el.value = value;
            break;
    }

    chrome.storage.sync.set({ [id]: value }, () => {
        // Show "Saved" status message temporarily
        const status = document.getElementById(`status-${id}`);
        if (status) {
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 1500);
        }
    });
}

// Request the background script to generate a live preview
function updatePreview() {
    chrome.storage.sync.get(settingIds, (settings) => {
        const data = {
            demoTitle: document.getElementById('demo-title').value,
            demoSelection: document.getElementById('demo-selection').value,
            demoUrl: 'https://ja.wikipedia.org/wiki/%E3%83%89%E3%83%A9%E3%81%88%E3%82%82%E3%82%93',
            settings: settings
        };

        chrome.runtime.sendMessage({
            action: 'get-preview',
            data: data
        }, (response) => {
            if (response && response.markdownLink) {
                const output = document.getElementById('preview-output');
                if (output) output.textContent = response.markdownLink;
            }
        });
    });
}

/**
 * Toggle the visibility of the preview panel with animation.
 * @param {boolean} show - Whether to show the panel.
 * @param {boolean} animate - Whether to apply transition effects.
 */
function togglePreviewPanel(show, animate = true) {
    const panel = document.getElementById('preview-panel');
    const btn = document.getElementById('toggle-preview');
    if (!panel || !btn) return;

    if (animate) {
        panel.classList.add('is-animating');
    }

    if (show) {
        panel.classList.remove('hidden');
        btn.textContent = '×';
        btn.title = chrome.i18n.getMessage("previewBtnHide") || 'プレビューを隠す';
        btn.classList.add('active');
    } else {
        panel.classList.add('hidden');
        btn.textContent = '👀';
        btn.title = chrome.i18n.getMessage("previewBtnShow") || 'プレビューを表示';
        btn.classList.remove('active');
    }

    if (animate) {
        setTimeout(() => {
            panel.classList.remove('is-animating');
        }, 400);
    }

    // Persist panel visibility state locally
    chrome.storage.local.set({ 'preview-visible': show });
}

// Initialize individual setting listeners and handle page load
document.addEventListener('DOMContentLoaded', () => {
    // Apply i18n translations to elements with data-i18n attribute
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const message = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
        if (message) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.value = message;
            } else {
                el.textContent = message;
            }
        }
    });

    // Apply i18n translations to tooltips (title attribute)
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const message = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
        if (message) {
            el.title = message;
        }
    });

    restoreOptions();

    // Restore preview panel visibility
    chrome.storage.local.get('preview-visible', (res) => {
        const isVisible = res['preview-visible'] !== false;
        togglePreviewPanel(isVisible, false);
    });

    // Register change listeners for all settings
    settingIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                if (id === 'threshold' || id === 'base-len') {
                    enforceBaseLenLimit();
                }
                if (id === 'toast-msg-success-type' || id === 'toast-msg-failed-type') {
                    enforceCustomInputVisibility();
                }
                saveSetting(id);
                updatePreview();
            });
        }
    });

    // Listeners for demo inputs
    const demoTitle = document.getElementById('demo-title');
    const demoSelection = document.getElementById('demo-selection');
    if (demoTitle) demoTitle.addEventListener('input', updatePreview);
    if (demoSelection) demoSelection.addEventListener('input', updatePreview);

    // Floating toggle button
    const toggleBtn = document.getElementById('toggle-preview');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = document.getElementById('preview-panel').classList.contains('hidden');
            togglePreviewPanel(isHidden);
        });
    }
});
