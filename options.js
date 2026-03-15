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

// Global fallback language obtained directly from manifest file
const FALLBACK_LANG = chrome.runtime.getManifest().default_locale || 'en';

// Locale-specific static messages used for defaults and previews
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

/**
 * Mapping of text setting IDs to their default translated fallback strings.
 */
const defaultTextSettings = {
    'toast-msg-success': () => chrome.i18n.getMessage("toastCopySuccess") || OVERRIDE_MESSAGES[FALLBACK_LANG].success,
    'toast-msg-failed': () => chrome.i18n.getMessage("toastCopyFailed") || OVERRIDE_MESSAGES[FALLBACK_LANG].failed
};

/**
 * Loads current settings from chrome.storage.sync and populates the UI.
 */
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
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
                        el.value = defaultTextSettings[id]();
                    }
                    break;
                case 'select-one':
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
            // Track the initial value for number inputs to optimize save operations
            if (el.type === 'number') {
                el.dataset.lastSaved = el.value;
            }
        });
        enforceBaseLenLimit();
        enforceCustomInputVisibility();
        updatePreview();
    });
}

/**
 * Validates 'base-len' against the current 'threshold' to prevent invalid fragments.
 * Clamps 'base-len' to half of the 'threshold'.
 */
function enforceBaseLenLimit() {
    const thresholdEl = document.getElementById('threshold');
    const baseLenEl = document.getElementById('base-len');
    if (!thresholdEl || !baseLenEl) return;

    const thresholdVal = parseInt(thresholdEl.value, 10);
    if (isNaN(thresholdVal)) return;

    const maxBaseLen = Math.floor(thresholdVal / 2);
    baseLenEl.max = maxBaseLen;

    const currentBaseLen = parseInt(baseLenEl.value, 10);
    if (!isNaN(currentBaseLen) && currentBaseLen > maxBaseLen) {
        baseLenEl.value = maxBaseLen;
        chrome.storage.sync.set({ 'base-len': maxBaseLen });
    }
}

/**
 * Handles the visibility and interactivity of custom message input fields based 
 * on the selected preview language/type.
 */
function enforceCustomInputVisibility() {
    ['success', 'failed'].forEach(type => {
        const selectEl = document.getElementById(`toast-msg-${type}-type`);
        const inputEl = document.getElementById(`toast-msg-${type}`);

        if (selectEl && inputEl) {
            const val = selectEl.value;
            if (val === 'custom') {
                inputEl.disabled = false;
                chrome.storage.sync.get(`toast-msg-${type}`, (res) => {
                    if (res[`toast-msg-${type}`]) {
                        inputEl.value = res[`toast-msg-${type}`];
                    }
                });
            } else {
                inputEl.disabled = true;
                if (OVERRIDE_MESSAGES[val]) {
                    inputEl.value = type === 'success' ? OVERRIDE_MESSAGES[val].success : OVERRIDE_MESSAGES[val].failed;
                }
            }
        }
    });
}

/**
 * Persists a single setting to chrome.storage.sync with validation.
 * @param {string} id - The DOM ID of the setting element.
 */
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

            if (value < 0) value = 0;
            el.value = value;
            break;
    }

    chrome.storage.sync.set({ [id]: value }, () => {
        let statusId;
        switch (id) {
            case 'toast-msg-success-type':
                statusId = 'status-toast-msg-success';
                break;
            case 'toast-msg-failed-type':
                statusId = 'status-toast-msg-failed';
                break;
            default:
                statusId = `status-${id}`;
        }

        const status = document.getElementById(statusId);
        if (status) {
            status.classList.add('show');
            clearTimeout(status.timeoutId);
            status.timeoutId = setTimeout(() => {
                status.classList.remove('show');
            }, 1500);
        }
        
        if (el && el.type === 'number') {
            el.dataset.lastSaved = el.value;
        }
    });
}

/**
 * Updates the preview panel by sending current UI states to the background script.
 */
function updatePreview() {
    const currentSettings = {};
    settingIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        switch (el.type) {
            case 'checkbox':
                currentSettings[id] = el.checked;
                break;
            case 'select-one':
                currentSettings[id] = el.value;
                break;
            case 'number':
                currentSettings[id] = parseInt(el.value, 10) || 0;
                break;
            default:
                currentSettings[id] = el.value;
        }
    });

    const data = {
        demoTitle: document.getElementById('demo-title').value,
        demoSelection: document.getElementById('demo-selection').value,
        demoUrl: 'https://ja.wikipedia.org/wiki/%E3%83%89%E3%83%A9%E3%81%88%E3%82%82%E3%82%93',
        settings: currentSettings
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

/**
 * Entry point for the options page. 
 * Initializes translations, restores settings, and binds event listeners.
 */
document.addEventListener('DOMContentLoaded', () => {
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

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const message = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
        if (message) {
            el.title = message;
        }
    });

    restoreOptions();

    chrome.storage.local.get('preview-visible', (res) => {
        const isVisible = res['preview-visible'] !== false;
        togglePreviewPanel(isVisible, false);
    });

    settingIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        const performSave = () => {
            if (el.type === 'number' && el.value === el.dataset.lastSaved) return;

            if (id === 'threshold' || id === 'base-len') {
                enforceBaseLenLimit();
            }
            if (id === 'toast-msg-success-type' || id === 'toast-msg-failed-type') {
                enforceCustomInputVisibility();
            }

            if (el.tagName === 'INPUT' && el.type === 'text' && el.disabled) {
                return;
            }

            saveSetting(id);
            updatePreview();
        };

        if (el.tagName === 'INPUT' && el.type === 'number') {
            // Live preview updates without storage persistence for performance
            el.addEventListener('change', () => {
                if (id === 'threshold' || id === 'base-len') enforceBaseLenLimit();
                updatePreview();
            });

            // Persist numeric settings only on explicit confirmation or focus loss
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') performSave();
            });

            el.addEventListener('blur', performSave);
        } else {
            el.addEventListener('change', performSave);
        }
    });

    const demoTitle = document.getElementById('demo-title');
    const demoSelection = document.getElementById('demo-selection');
    if (demoTitle) demoTitle.addEventListener('input', updatePreview);
    if (demoSelection) demoSelection.addEventListener('input', updatePreview);

    const toggleBtn = document.getElementById('toggle-preview');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = document.getElementById('preview-panel').classList.contains('hidden');
            togglePreviewPanel(isHidden);
        });
    }
});
