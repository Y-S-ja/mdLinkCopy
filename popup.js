async function copyLink() {
    const status = document.getElementById('status');

    try {
        // 1. 現在のタブ情報を取得
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 2. 特殊なページ（chrome:// や 拡張機能ページ）では動作しないためチェック
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('https://chrome.google.com/webstore')) {
            status.textContent = 'このページでは使えません';
            status.style.color = 'orange';
            return;
        }

        // 3. Markdown形式の文字列を作成
        const markdownLink = `[${tab.title}](${tab.url})`;

        // 4. クリップボードに書き込み（フォーカスを確認してから実行）
        window.focus();
        await navigator.clipboard.writeText(markdownLink);

        // 5. 表示を「完了」に切り替え
        status.textContent = 'Copied!';
        status.style.color = 'green';

        // 6. 少し待ってから閉じる（早すぎるとコピーが完了しない場合があるため）
        setTimeout(() => {
            window.close();
        }, 800);

    } catch (err) {
        console.error('Copy failed:', err);
        status.textContent = 'エラーが発生しました';
        status.style.color = 'red';
    }
}

// 実行
copyLink();