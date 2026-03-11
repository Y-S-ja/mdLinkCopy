// 設定を読み込む
function restoreOptions() {
    chrome.storage.sync.get('notice-duration', (items) => {
        if (items['notice-duration'] !== undefined) {
            document.getElementById('notice-duration').value = items['notice-duration'];
        }
    });
}

// 設定を保存する
function saveOptions() {
    const noticeDuration = parseInt(document.getElementById('notice-duration').value, 10);

    if (isNaN(noticeDuration) || noticeDuration < 0) return;

    chrome.storage.sync.set({
        'notice-duration': noticeDuration
    }, () => {
        // 保存完了を通知 (個別のステータスを表示)
        const status = document.getElementById('status-notice-duration');
        status.classList.add('show');
        setTimeout(() => {
            status.classList.remove('show');
        }, 1500);
    });
}

// 初期ロード時に復元
document.addEventListener('DOMContentLoaded', restoreOptions);

// 値が確定したタイミング（フォーカスが外れた、Enterなど）で保存
document.getElementById('notice-duration').addEventListener('change', saveOptions);
