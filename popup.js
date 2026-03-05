document.getElementById('copyBtn').addEventListener('click', async () => {
    // 現在のタブを取得
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Markdown形式の文字列を作成
    const markdownLink = `[${tab.title}](${tab.url})`;

    // クリップボードに書き込み
    try {
        await navigator.clipboard.writeText(markdownLink);

        // 成功メッセージを表示
        const status = document.getElementById('status');
        status.textContent = 'コピー完了！';

        // 1秒後にポップアップを自動で閉じる
        setTimeout(() => {
            window.close();
        }, 1000);

    } catch (err) {
        console.error('コピーに失敗しました', err);
    }
});