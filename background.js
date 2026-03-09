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

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener(async (command, tab) => {
    switch (command) {
        case "copy-page-md":
            copyPageLink(tab);
            break;

        case "copy-selection-md": {
            // スクリプト注入が禁止されているページでは選択範囲の取得ができない
            if (isRestrictedPage(tab.url)) {
                showRestrictedNotification();
                return;
            }

            try {
                const result = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => window.getSelection().toString()
                });
                const selection = result[0].result;
                if (selection) {
                    performSelectionCopy(selection, tab.url, tab);
                }
            } catch (err) {
                console.error('Wait... shortcut capture failed:', err);
            }
            break;
        }
    }
});

// 禁止ページ判定
function isRestrictedPage(url) {
    const restrictedPrefixes = ['chrome://', 'about:', 'https://chrome.google.com/webstore', 'edge://'];
    return !url || restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

// 禁止ページ用の通知を表示
function showRestrictedNotification(message = 'このページでは一部の機能が制限されます') {
    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'images/icon192x192.png',
        title: 'Quick Md Copy',
        message: message,
        silent: true
    });
}

// クリップボードコピーの総括処理（ページ内 or オフスクリーン）
async function dispatchCopy(tabId, url, text) {
    if (isRestrictedPage(url)) {
        // 禁止ページならオフスクリーン経由でコピー
        const success = await copyViaOffscreen(text);
        if (success) {
            console.log(success);
            showRestrictedNotification('Markdownをコピーしました（※制限ページのためシステム通知）');
        } else {
            console.log(success);
            showRestrictedNotification('コピーに失敗しました（※制限ページのためシステム通知）');
        }
    } else {
        // 通常ページならページ内にスクリプトを注入して通知を出す
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: copyToClipboardWithNotice,
            args: [text]
        }).catch(async (err) => {
            console.error('Injection failed, falling back to offscreen:', err);
            const success = await copyViaOffscreen(text);
            if (!success) {
                showRestrictedNotification('コピーに失敗しました');
            } else {
                showRestrictedNotification('Markdownをコピーしました（※システム通知）');
            }
        });
    }
}

// 選択箇所のコピー共通処理
function performSelectionCopy(rawSelection, rawUrl, tab) {
    const selectionText = generateTextFragmentParam(rawSelection);
    const pageUrl = rawUrl.split('#')[0];
    const title = cleanLabel(tab.title);

    const fragment = `#:~:text=${selectionText}`;
    const markdownLink = `[${title}](${getReadableUrl(pageUrl)}${fragment})`;

    dispatchCopy(tab.id, tab.url, markdownLink);
}

// ページ全体リンクのコピー共通処理
function copyPageLink(tab) {
    const pageUrl = tab.url.split('#')[0];
    const title = cleanLabel(tab.title);
    const markdownLink = `[${title}](${getReadableUrl(pageUrl)})`;

    dispatchCopy(tab.id, tab.url, markdownLink);
}

// 拡張機能アイコン（action）クリック時の処理
chrome.action.onClicked.addListener((tab) => {
    copyPageLink(tab);
});

// オフスクリーンドキュメントを使用してコピーする
async function copyViaOffscreen(text) {
    try {
        // すでに存在するか確認し、なければ作成
        if (!(await chrome.offscreen.hasDocument?.())) {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['CLIPBOARD'],
                justification: 'Copying Markdown links to clipboard'
            });
        }
        // メッセージを送ってコピーさせ、結果を待つ
        const response = await chrome.runtime.sendMessage({
            target: 'offscreen-clipboard',
            data: text
        });
        console.log(response);
        return response?.success || false;
    } catch (err) {
        console.error('Copy via offscreen failed:', err);
        return false;
    }
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
    const BASE_LEN = 20;    // 抽出基準の文字数

    // 前後の空白をトリミングし、内部の連続した空白を1つにする（マッチング率向上）
    const cleanText = text.trim().replace(/\s+/g, ' ');

    // 指定文字数より短い場合は、全文をエンコードして返す
    if (cleanText.length <= THRESHOLD) {
        return safeSelectiveEncode(cleanText);
    }

    // --- 開始部分の抽出（単語の途中で切れないように後ろに広げる） ---
    let startPart = cleanText.substring(0, BASE_LEN);
    const followingText = cleanText.substring(BASE_LEN);
    // 次の区切り文字（スペースや記号）までの文字列を抽出
    const startExtension = followingText.match(/^[^\s,.;:!?]*/);
    if (startExtension) {
        startPart += startExtension[0];
    }

    // --- 終了部分の抽出（単語の途中で切れないように前に広げる） ---
    let endPart = cleanText.substring(cleanText.length - BASE_LEN);
    const leadingText = cleanText.substring(0, cleanText.length - BASE_LEN);
    // 前の区切り文字（スペースや記号）までの文字列を逆向きに抽出
    const endExtension = leadingText.match(/[^\s,.;:!?]*$/);
    if (endExtension) {
        endPart = endExtension[0] + endPart;
    }

    // エンコードしてカンマで繋ぐ
    return `${safeSelectiveEncode(startPart)},${safeSelectiveEncode(endPart)}`;
}

// tab.url をデコードして扱いやすくする関数
function getReadableUrl(rawUrl) {
    try {
        // 1. まず全体を日本語に戻す
        let decodedUrl = decodeURI(rawUrl);

        // 2. Markdownの構文 [タイトル](URL) を壊さないための最小限の処理
        return decodedUrl
            .replace(/ /g, '%20')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29');
    } catch (e) {
        // 万が一デコードに失敗した（不正なURLなど）場合は、元のURLを返す
        console.error('URLデコードエラー:', e);
        return rawUrl;
    }
}