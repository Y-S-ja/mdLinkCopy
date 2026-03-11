const defaultSettings = {
    'notice-duration': 1000
};

// 設定を読み込む
function restoreOptions() {
    chrome.storage.sync.get(defaultSettings, (items) => {
        document.getElementById('notice-duration').value = items['notice-duration'];
    });
}

// 設定を保存する
function saveOptions() {
    const noticeDuration = document.getElementById('notice-duration').value;

    chrome.storage.sync.set({
        'notice-duration': noticeDuration
    }, () => {
        const status = document.getElementById('status');
        status.classList.add('show');
        setTimeout(() => {
            status.classList.remove('show');
        }, 2000);
    });
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('save').addEventListener('click', saveOptions);
