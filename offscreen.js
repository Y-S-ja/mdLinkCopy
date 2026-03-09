// バックグラウンドからの指示を受け取る
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target === 'offscreen-clipboard') {
        copyToClipboard(message.data).then(success => {
            sendResponse({ success });
        });
    }
    return true; // 非同期応答のために true を返す
});

async function copyToClipboard(text) {
    try {
        // 1. まず最新の Clipboard API を試行
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        // 2. 失敗した場合は、古い execCommand で再試行
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            
            textArea.select();
            const result = document.execCommand('copy');
            
            document.body.removeChild(textArea);
            return result;
        } catch (fallbackErr) {
            console.error('All offscreen copy methods failed:', fallbackErr);
            return false;
        }
    }
}
