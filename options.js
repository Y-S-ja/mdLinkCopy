// 設定を読み込む
function restoreOptions() {
    // インストール時に初期化されているため、単純に取得するだけでOK
    chrome.storage.sync.get('notice-duration', (items) => {
        if (items['notice-duration'] !== undefined) {
            document.getElementById('notice-duration').value = items['notice-duration'];
        }
    });
}

// 設定を自動保存する
function saveOptions() {
    const noticeDuration = parseInt(document.getElementById('notice-duration').value, 10);

    // バリデーション（数値以外や極端な値を防ぐ）
    if (isNaN(noticeDuration) || noticeDuration < 0) return;

    chrome.storage.sync.set({
        'notice-duration': noticeDuration
    }, () => {
        // 保存完了をふわっと出す
        const status = document.getElementById('status');
        status.classList.add('show');
        setTimeout(() => {
            status.classList.remove('show');
        }, 1500);
    });
}

// 初期ロード時に復元
document.addEventListener('DOMContentLoaded', restoreOptions);

// 入力があるたびにオートセーブ
document.getElementById('notice-duration').addEventListener('input', saveOptions);
