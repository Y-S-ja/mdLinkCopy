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
    'pipe-to-zenkaku'
];

// Load settings from chrome.storage.sync
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
        settingIds.forEach(id => {
            const el = document.getElementById(id);
            if (el && items[id] !== undefined) {
                if (el.type === 'checkbox') {
                    el.checked = items[id];
                } else {
                    el.value = items[id];
                }
            }
        });
        enforceBaseLenLimit(); // Apply limits based on loaded values
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

// Save a specific setting to chrome.storage.sync
function saveSetting(id) {
    const el = document.getElementById(id);
    let value;

    if (el.type === 'checkbox') {
        value = el.checked;
    } else {
        value = parseInt(el.value, 10);
        if (isNaN(value) || value < 0) return;
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
