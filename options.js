const settingIds = ['notice-duration', 'threshold', 'base-len', 'use-readable-url', 'use-start-end-format', 'use-readable-fragment', 'bracket-to-zenkaku', 'pipe-to-zenkaku'];

// 設定を読み込む
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
        settingIds.forEach(id => {
            const el = document.getElementById(id);
            if (items[id] !== undefined) {
                if (el.type === 'checkbox') {
                    el.checked = items[id];
                } else {
                    el.value = items[id];
                }
            }
        });
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
        // 保存完了を通知 (個別のステータスを表示)
        const status = document.getElementById(`status-${id}`);
        if (status) {
            status.classList.add('show');
            setTimeout(() => {
                status.classList.remove('show');
            }, 1500);
        }
    });
}

// 初期ロード時に復元
document.addEventListener('DOMContentLoaded', restoreOptions);

// すべての入力項目にイベントリスナーを一括登録
settingIds.forEach(id => {
    const el = document.getElementById(id);
    const eventType = el.type === 'checkbox' ? 'change' : 'change'; 
    // checkboxもchangeイベントで即時反応する
    el.addEventListener(eventType, () => saveSetting(id));
});
