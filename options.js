const settingIds = ['notice-duration', 'threshold', 'base-len', 'use-readable-url', 'use-start-end-format', 'use-readable-fragment', 'bracket-to-zenkaku', 'pipe-to-zenkaku'];

// 設定を読み込む
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
        updatePreview(); // ロード直後にプレビューを更新
    });
}

// 設定を保存する汎用関数
function saveSetting(id) {
    const el = document.getElementById(id);
    let value;

    if (el.type === 'checkbox') {
        value = el.checked;
    } else {
        value = parseInt(el.value, 10);
        if (isNaN(value) || value < 0) return;
    }

    chrome.storage.sync.set({
        [id]: value
    }, () => {
        const status = document.getElementById(`status-${id}`);
        if (status) {
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 1500);
        }
    });
}

// プレビューを更新する関数
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
                document.getElementById('preview-output').textContent = response.markdownLink;
            }
        });
    });
}

// パネルの表示・非表示を切り替える
function togglePreviewPanel(show) {
    const panel = document.getElementById('preview-panel');
    const btn = document.getElementById('toggle-preview');
    
    if (show) {
        panel.classList.remove('hidden');
        btn.textContent = '×';
        btn.title = 'プレビューを隠す';
        btn.classList.add('active'); // 表示中スタイル
    } else {
        panel.classList.add('hidden');
        btn.textContent = '👀';
        btn.title = 'プレビューを表示';
        btn.classList.remove('active');
    }
    
    chrome.storage.local.set({ 'preview-visible': show });
}

// 初期ロード時に復元
document.addEventListener('DOMContentLoaded', () => {
    restoreOptions();
    
    chrome.storage.local.get('preview-visible', (res) => {
        const isVisible = res['preview-visible'] !== false;
        togglePreviewPanel(isVisible);
    });

    // すべての入力項目にイベントリスナーを一括登録
    settingIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                saveSetting(id);
                updatePreview();
            });
        }
    });

    // デモ用の入力項目にもイベントリスナーを追加
    document.getElementById('demo-title').addEventListener('input', updatePreview);
    document.getElementById('demo-selection').addEventListener('input', updatePreview);

    // プレビューの表示切替ボタン
    document.getElementById('toggle-preview').addEventListener('click', () => {
        const isHidden = document.getElementById('preview-panel').classList.contains('hidden');
        togglePreviewPanel(isHidden);
    });
});
