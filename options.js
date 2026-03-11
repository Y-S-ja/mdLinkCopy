const settingIds = ['notice-duration', 'threshold', 'base-len'];

// 設定を読み込む
function restoreOptions() {
    chrome.storage.sync.get(settingIds, (items) => {
        settingIds.forEach(id => {
            if (items[id] !== undefined) {
                document.getElementById(id).value = items[id];
            }
        });
    });
}

// 設定を保存する汎用関数
function saveSetting(id) {
    const value = parseInt(document.getElementById(id).value, 10);

    if (isNaN(value) || value < 0) return;

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
    document.getElementById(id).addEventListener('change', () => saveSetting(id));
});
