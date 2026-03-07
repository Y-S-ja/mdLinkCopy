// インストール時にコンテキストメニューを作成
chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "copy-selection-markdown",
        title: "選択箇所へのMarkdownリンクをコピー",
        contexts: ["selection"] // テキストを選択している時だけ表示
    });
});

// コンテキストメニュー（右クリック）クリック時の処理
chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "copy-selection-markdown") {
        performSelectionCopy(info.selectionText, info.pageUrl, tab);
    }
});

// 拡張機能アイコン（action）クリック時の処理
chrome.action.onClicked.addListener((tab) => {
    copyPageLink(tab);
});

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener(async (command, tab) => {
    switch (command) {
        case "copy-page-md":
            copyPageLink(tab);
            break;

        case "copy-selection-md": {
            // ページ内から選択テキストを抽出
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.getSelection().toString()
            });
            const selection = result[0].result;
            if (selection) {
                performSelectionCopy(selection, tab.url, tab);
            } else {
                console.warn("No text selected for shortcut.");
            }
            break;
        }
    }
});

// 選択箇所のコピー共通処理
function performSelectionCopy(rawSelection, rawUrl, tab) {
    const selectionText = generateTextFragmentParam(rawSelection);
    const pageUrl = rawUrl.split('#')[0];
    const title = cleanLabel(tab.title);

    const fragment = `#:~:text=${selectionText}`;
    const markdownLink = `[${title}](${pageUrl}${fragment})`;

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: copyToClipboardWithNotice,
        args: [markdownLink]
    }).catch(err => console.error('Script injection failed:', err));
}

// ページ全体リンクのコピー共通処理
function copyPageLink(tab) {
    const restrictedPrefixes = ['chrome://', 'about:', 'https://chrome.google.com/webstore', 'edge://'];
    if (!tab.url || restrictedPrefixes.some(prefix => tab.url.startsWith(prefix))) {
        // 禁止ページではブラウザのシステム通知を表示
        chrome.notifications.create({
            type: 'basic',
            iconUrl: 'images/icon192x192.png',
            title: 'Quick Md Copy',
            message: 'このページではコピーできません',
            silent: true
        });
        return;
    }

    const pageUrl = tab.url.split('#')[0];
    const title = cleanLabel(tab.title);
    const markdownLink = `[${title}](${pageUrl})`;

    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: copyToClipboardWithNotice,
        args: [markdownLink]
    }).catch(err => console.error('Script injection failed:', err));
}

// Webサイト側で実行される共通のコピー＆通知関数
async function copyToClipboardWithNotice(text) {
    try {
        await navigator.clipboard.writeText(text);
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

// 特殊文字のみエンコード
function safeSelectiveEncode(text) {
    return text
        .replace(/%/g, '%25')   // 最初に%を置換
        .replace(/ /g, '%20')   // スペース
        .replace(/\(/g, '%28')  // 開始カッコ
        .replace(/\)/g, '%29')  // 終了カッコ
        .replace(/#/g, '%23')   // シャープ
        .replace(/,/g, '%2C')   // カンマ
        .replace(/-/g, '%2D')   // ハイフン
        .replace(/&/g, '%26')   // アンパサンド
        .replace(/\n/g, '%20'); // 改行（スペースに置換）
}

// ラベル（表示文字列）を整形
function cleanLabel(text) {
    return text
        .replace(/\r?\n/g, ' ')  // 改行をスペースに（最優先）
        .replace('[', '［').replace(']', '］')  // 全角に置換、または削除`.replace(/[\[\]]/g, '')`
        .replace(/\|/g, '｜')    // パイプを全角にしてテーブル崩れを防止
        .trim();                 // 前後の余計な空白を消す
}

/*
 * 選択テキストをテキストフラグメント用のパラメータ形式に変換する
 * 長い場合は "開始20文字,終了20文字" の形式にする
 */
function generateTextFragmentParam(text) {
    const THRESHOLD = 60;   // この文字数を超えたら中略する
    const EXTRACT_LEN = 20; // 前後から抽出する文字数

    // 前後の空白をトリミング
    const cleanText = text.trim();

    // 指定文字数より短い場合は、全文をエンコードして返す
    if (cleanText.length <= THRESHOLD) {
        return safeSelectiveEncode(cleanText);
    }

    // 開始と終了のパーツを抽出
    const startPart = cleanText.substring(0, EXTRACT_LEN);
    const endPart = cleanText.substring(cleanText.length - EXTRACT_LEN);

    // 重要：前後のパーツは個別にエンコードし、中間のカンマはそのまま繋げる
    // これによりブラウザが「開始位置,終了位置」という範囲指定だと認識できる
    return `${safeSelectiveEncode(startPart)},${safeSelectiveEncode(endPart)}`;
}