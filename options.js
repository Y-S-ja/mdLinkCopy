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

/**
 * Mapping of text setting IDs to their default translated fallback strings.
 */
const defaultTextSettings = {
    'toast-msg-success': () => chrome.i18n.getMessage("toastCopySuccess") || "Markdown Copied!",
    'toast-msg-failed': () => chrome.i18n.getMessage("toastCopyFailed") || "Copy Failed",
    'previewBtnHide': () => chrome.i18n.getMessage("previewBtnHide") || "Hide Preview",
    'previewBtnShow': () => chrome.i18n.getMessage("previewBtnShow") || "Show Preview"
};

/**
 * Gets the appropriately typed value from a DOM element.
 */
function getElementValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return parseInt(el.value, 10) || 0;
    if (typeof el.value === 'string') return el.value.trim();
    return el.value;
}

/**
 * Sets the value of a DOM element based on its type.
 */
function setElementValue(el, value) {
    if (el.type === 'checkbox') {
        el.checked = !!value;
    } else {
        el.value = value ?? '';
    }
}

/**
 * Loads current settings from chrome.storage.sync and populates the UI.
 */
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
        if (items['toast-msg-success-type'] === undefined) items['toast-msg-success-type'] = 'default';
        if (items['toast-msg-failed-type'] === undefined) items['toast-msg-failed-type'] = 'default';

        settingIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            let val = items[id];

            // Fallback logic for specialized select mapping
            if (val === undefined && el.type === 'select-one') {
                val = id.includes('success') ? items['toast-msg-success-type'] : items['toast-msg-failed-type'];
            }

            // Fallback for text elements
            if (el.type === 'text') {
                if (val === undefined || (typeof val === 'string' && val.trim() === '')) {
                    if (defaultTextSettings[id]) val = defaultTextSettings[id]();
                }
            }

            if (val !== undefined) setElementValue(el, val);

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
            const isCustom = selectEl.value === 'custom';
            inputEl.disabled = !isCustom;

            if (isCustom) {
                chrome.storage.sync.get(`toast-msg-${type}`, (res) => {
                    if (res[`toast-msg-${type}`]) {
                        inputEl.value = res[`toast-msg-${type}`];
                    }
                });
            } else {
                // If it's 'default', show the localized standard message
                inputEl.value = type === 'success' ? 
                    (chrome.i18n.getMessage("toastCopySuccess") || "Markdown Copied!") : 
                    (chrome.i18n.getMessage("toastCopyFailed") || "Copy Failed");
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
    let value = getElementValue(el);

    switch (el.type) {
        case 'text':
            if (value === '' && defaultTextSettings[id]) {
                value = defaultTextSettings[id]();
                el.value = value;
            }
            break;
        case 'number':
            if (isNaN(value)) return;
            if (el.hasAttribute('min')) {
                const minVal = parseInt(el.getAttribute('min'), 10);
                if (!isNaN(minVal) && value < minVal) value = minVal;
            }
            if (el.hasAttribute('max')) {
                const maxVal = parseInt(el.getAttribute('max'), 10);
                if (!isNaN(maxVal) && value > maxVal) value = maxVal;
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
        if (el) currentSettings[id] = getElementValue(el);
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
        btn.title = defaultTextSettings['previewBtnHide'];
        btn.classList.add('active');
    } else {
        panel.classList.add('hidden');
        btn.textContent = '👀';
        btn.title = defaultTextSettings['previewBtnShow'];
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
 * Binds event listeners to UI elements for real-time updates and persistence.
 */
function setupEventListeners() {
    settingIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;

        const performSave = () => {
            if (el.type === 'number' && el.value === el.dataset.lastSaved) return;
            if (id === 'threshold' || id === 'base-len') enforceBaseLenLimit();
            if (id.includes('-type')) enforceCustomInputVisibility();

            if (el.tagName === 'INPUT' && el.type === 'text' && el.disabled) return;

            saveSetting(id);
            updatePreview();
        };

        if (el.type === 'number') {
            el.addEventListener('change', () => {
                if (id === 'threshold' || id === 'base-len') enforceBaseLenLimit();
                updatePreview();
            });
            el.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSave(); });
            el.addEventListener('blur', performSave);
        } else {
            el.addEventListener('change', performSave);
        }
    });

    // Preview specific inputs
    ['demo-title', 'demo-selection'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePreview);
    });

    const toggleBtn = document.getElementById('toggle-preview');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isHidden = document.getElementById('preview-panel').classList.contains('hidden');
            togglePreviewPanel(isHidden);
        });
    }
}

/**
 * Entry point for the options page. 
 * Initializes translations, restores settings, and binds event listeners.
 */
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
        if (msg) {
            if (['INPUT', 'TEXTAREA'].includes(el.tagName)) {
                el.value = msg;
            } else {
                el.textContent = msg;
            }
        }
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
        if (msg) el.title = msg;
    });

    restoreOptions();

    chrome.storage.local.get('preview-visible', (res) => {
        togglePreviewPanel(res['preview-visible'] !== false, false);
    });

    setupEventListeners();
});
