async function copyLink() {
    const status = document.getElementById('status');

    try {
        // 1. 現在のタブ情報を取得
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 2. Markdown形式の文字列を作成
        const markdownLink = `[${tab.title}](${tab.url})`;

        // 3. クリップボードに書き込み
        await navigator.clipboard.writeText(markdownLink);

        // 4. 表示を「完了」に切り替え
        status.textContent = 'Copied!';
        status.style.color = 'green';

        // 5. 0.7秒後にポップアップを自動で閉じる
        setTimeout(() => {
            window.close();
        }, 700);

    } catch (err) {
        console.error(err);
        status.textContent = 'Error!';
        status.style.color = 'red';
    }
}

// ポップアップが開いたらすぐに実行
copyLink();