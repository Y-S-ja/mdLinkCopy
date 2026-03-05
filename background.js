chrome.action.onClicked.addListener((tab) => {
    // 特殊なページでは実行しない
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('https://chrome.google.com/webstore')) {
        return;
    }

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: copyMarkdownLink,
    });
});

// Webサイト側で実行される関数
async function copyMarkdownLink() {
    const title = document.title;
    const url = window.location.href;
    const markdownLink = `[${title}](${url})`;

    try {
        // モダンな Clipboard API を使用
        await navigator.clipboard.writeText(markdownLink);

        // 成功時のフィードバック表示
        showNotice("Markdown Copied!", "#2ecc71");
    } catch (err) {
        console.error('Failed to copy: ', err);
        showNotice("Copy Failed", "#e74c3c");
    }

    // 通知用メッセージを表示する補助関数
    function showNotice(message, bgColor) {
        const notice = document.createElement("div");
        notice.textContent = message;
        Object.assign(notice.style, {
            position: "fixed",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: bgColor,
            color: "white",
            padding: "10px 20px",
            borderRadius: "20px",
            zIndex: "999999",
            fontSize: "14px",
            fontWeight: "bold",
            fontFamily: "sans-serif",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            pointerEvents: "none", // クリックを邪魔しない
            transition: "opacity 0.4s, transform 0.4s"
        });

        document.body.appendChild(notice);

        // アニメーション付きで消す
        setTimeout(() => {
            notice.style.opacity = "0";
            notice.style.transform = "translateX(-50%) translateY(-10px)";
            setTimeout(() => notice.remove(), 400);
        }, 1000);
    }
}