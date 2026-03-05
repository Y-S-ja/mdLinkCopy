// HTMLが完全に読み込まれてから処理を開始する
document.addEventListener('DOMContentLoaded', async () => {
    const status = document.getElementById('status');

    // もし要素が見つからない場合はエラーを回避して終了
    if (!status) return;

    try {
        // 1. 現在のタブ情報を取得
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 2. 特殊なページ（chrome:// や 拡張機能ページ）のチェック
        if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('about:') || tab.url.startsWith('https://chrome.google.com/webstore')) {
            status.textContent = 'このページでは使えません';
            status.style.color = 'orange';
            return;
        }

        // 3. Markdown形式の文字列を作成
        const markdownLink = `[${tab.title}](${tab.url})`;

        // 4. クリップボードに書き込み
        // ポップアップが完全にフォーカスを得るまで少し待つ (フォーカスエラー対策)
        await new Promise(resolve => setTimeout(resolve, 100));

        // フォーカスを強制してから、クリップボードAPIを試行
        window.focus();
        try {
            await navigator.clipboard.writeText(markdownLink);
        } catch (clipErr) {
            // API が失敗した場合のフォールバック (古い手法)
            console.warn('Navigator clipboard failed, using fallback:', clipErr);
            const textArea = document.createElement("textarea");
            textArea.value = markdownLink;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand("copy");
            document.body.removeChild(textArea);
        }

        // 5. 表示を「完了」に切り替え
        status.textContent = 'Copied!';
        status.style.color = 'green';

        // 6. 少し待ってから閉じる
        setTimeout(() => {
            window.close();
        }, 800);

    } catch (err) {
        console.error('Copy failed:', err);
        status.textContent = 'エラーが発生しました';
        status.style.color = 'red';
    }
});