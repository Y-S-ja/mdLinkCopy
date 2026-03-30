/**
 * Quick Md Copy - Options Page Logic
 * 
 * Synchronizes UI elements with chrome.storage.sync and manages live preview 
 * generation for real-time feedback. Implements event delegation for robust
 * and maintainable event handling.
 */
const settingIds = Object.keys(INITIAL_SETTINGS);

const FALLBACK_LANG = chrome.runtime.getManifest().default_locale || 'en';

/**
 * Default localization handlers for dynamic UI text elements.
 */
const defaultTextSettings = {
    'previewBtnHide': () => chrome.i18n.getMessage("previewBtnHide") || "Hide Preview",
    'previewBtnShow': () => chrome.i18n.getMessage("previewBtnShow") || "Show Preview"
};

/**
 * Gets the appropriately typed value from a DOM element.
 * @param {HTMLElement} el - The target input or select element.
 * @returns {any} The casted value based on element type.
 */
function getElementValue(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number') return parseInt(el.value, 10) || 0;
    if (typeof el.value === 'string') return el.value.trim();
    return el.value;
}

/**
 * Sets the value of a DOM element correctly based on its interactive type.
 * @param {HTMLElement} el - The target DOM element.
 * @param {any} value - The value to apply.
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
 * Ensures data integrity via normalizeSettings before applying values to elements.
 */
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
        const normalized = normalizeSettings(items);

        settingIds.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;

            setElementValue(el, normalized[id]);

            // Track last saved state for number inputs to reduce redundant storage writes
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
 * Sanitizes 'base-len' proportional to the 'threshold' to maintain valid fragments.
 * Boundary rule: baseLen * 2 must be <= threshold to avoid overlapping source fragments.
 */
function enforceBaseLenLimit() {
    const thresholdEl = document.getElementById('threshold');
    const baseLenEl = document.getElementById('base-len');
    if (!thresholdEl || !baseLenEl) return;

    const thresholdVal = getElementValue(thresholdEl);
    if (isNaN(thresholdVal)) return;

    const maxBaseLen = Math.floor(thresholdVal / 2);
    baseLenEl.max = maxBaseLen;

    const currentBaseLen = getElementValue(baseLenEl);
    if (!isNaN(currentBaseLen) && currentBaseLen > maxBaseLen) {
        baseLenEl.value = maxBaseLen;
        chrome.storage.sync.set({ 'base-len': maxBaseLen });
    }
}

/**
 * Manages visibility of custom notification input fields.
 * Toggles disabled state and resolves localized defaults for 'default' type selections.
 */
function enforceCustomInputVisibility() {
    ['success', 'failed'].forEach(type => {
        const idOfMsg = `toast-msg-${type}`;
        const selectEl = document.getElementById(`${idOfMsg}-type`);
        const inputEl = document.getElementById(idOfMsg);

        if (selectEl && inputEl) {
            const isCustom = selectEl.value === 'custom';
            inputEl.disabled = !isCustom;

            if (isCustom) {
                chrome.storage.sync.get(idOfMsg, (res) => {
                    if (res[idOfMsg]) {
                        inputEl.value = res[idOfMsg];
                    }
                });
            } else {
                // Show localized standard message as visual placeholder
                inputEl.value = INITIAL_SETTINGS[idOfMsg]();
            }
        }
    });
}

/**
 * Persists a single setting value to chrome.storage.sync with type-based validation.
 * Triggers UI feedback (status messages) upon successful save.
 * @param {string} id - The setting key/DOM ID to save.
 */
function saveSetting(id) {
    const el = document.getElementById(id);
    if (!el) return;
    let value = getElementValue(el);

    switch (el.type) {
        case 'text':
            if (value === '') {
                el.value = getDefaultSetting(id);
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
        // Display toast-style feedback next to the modified input
        const statusId = el.dataset.statusId || `status-${id}`;
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
 * Refreshes the real-time preview panel by requesting a generated link 
 * from the background script using current UI state.
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
 * Toggles the preview panel's visibility state.
 * @param {boolean} show - Target visibility state.
 * @param {boolean} animate - Enable CSS transition effects.
 */
function togglePreviewPanel(show, animate = true) {
    const panel = document.getElementById('preview-panel');
    const btn = document.getElementById('toggle-preview');
    if (!panel || !btn) return;

    if (animate) panel.classList.add('is-animating');

    if (show) {
        panel.classList.remove('hidden');
        btn.textContent = '×';
        btn.title = defaultTextSettings['previewBtnHide']();
        btn.classList.add('active');
    } else {
        panel.classList.add('hidden');
        btn.textContent = '👀';
        btn.title = defaultTextSettings['previewBtnShow']();
        btn.classList.remove('active');
    }

    if (animate) {
        setTimeout(() => panel.classList.remove('is-animating'), 400);
    }

    chrome.storage.local.set({ 'preview-visible': show });
}

/**
 * Binds global event listeners using event delegation for efficient interaction handling.
 * Reduces the number of listeners and manages dynamic elements like reset buttons.
 */
function setupEventListeners() {
    // 1. Unified Settings Change Pipeline
    document.addEventListener('change', (e) => {
        const target = e.target;
        const id = target.id;

        if (id && settingIds.includes(id)) {
            if (id === 'threshold' || id === 'base-len') enforceBaseLenLimit();
            if (id.includes('-type')) enforceCustomInputVisibility();

            // Prevent saving on disabled standard notification templates
            if (target.tagName === 'INPUT' && target.type === 'text' && target.disabled) return;

            saveSetting(id);
            updatePreview();
        }
    });

    // 2. Specialized Number Input Validation (Blur/Enter)
    document.addEventListener('blur', (e) => {
        if (e.target.type === 'number') {
            const id = e.target.id;
            if (e.target.value !== e.target.dataset.lastSaved) {
                saveSetting(id);
                updatePreview();
            }
        }
    }, true); // Use capture to detect focus-out on inputs

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.type === 'number') {
            e.target.blur(); // Triggers the explicit blur save handler
        }
    });

    // 3. Centralized Action Button Handler
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button, .reset-btn');
        if (!btn) return;

        if (btn.id === 'toggle-preview') {
            const isHidden = document.getElementById('preview-panel').classList.contains('hidden');
            togglePreviewPanel(isHidden);
        } else if (btn.classList.contains('reset-btn')) {
            const resetId = btn.dataset.resetId;
            const el = document.getElementById(resetId);
            if (el) {
                const defaultVal = getDefaultSetting(resetId);
                setElementValue(el, defaultVal);

                // Sanitize dependent UI states after reset
                if (resetId === 'threshold' || resetId === 'base-len') enforceBaseLenLimit();
                if (resetId.includes('-type')) enforceCustomInputVisibility();

                saveSetting(resetId);
                updatePreview();
            }
        }
    });

    // 4. Live Preview Demo Controls
    document.addEventListener('input', (e) => {
        const id = e.target.id;
        if (id === 'demo-title' || id === 'demo-selection') {
            updatePreview();
        }
    });
}

/**
 * Initializes the options UI.
 * Applies localization directly to data-i18n elements and restores user settings.
 */
document.addEventListener('DOMContentLoaded', () => {
    // Apply translations to the entire page
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

    // Apply translations to accessibility titles
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
        if (msg) el.title = msg;
    });

    restoreOptions();

    // Recover previous preview panel state
    chrome.storage.local.get('preview-visible', (res) => {
        togglePreviewPanel(res['preview-visible'] !== false, false);
    });

    setupEventListeners();
});
