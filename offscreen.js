// バックグラウンドからの指示を受け取る
chrome.runtime.onMessage.addListener(async (message) => {
    if (message.target === 'offscreen-clipboard') {
        copyToClipboard(message.data);
    }
});

async function copyToClipboard(text) {
    try {
        // 非推奨の execCommand ではなく、モダンな Clipboard API を使用
        // オフスクリーン・ドキュメント内ではこの API が許可されています
        await navigator.clipboard.writeText(text);
    } catch (err) {
        console.error('Offscreen copy failed:', err);
    }
}
