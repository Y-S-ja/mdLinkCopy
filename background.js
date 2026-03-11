// インストール時にコンテキストメニュー作成と初期設定の保存
chrome.runtime.onInstalled.addListener(async () => {
    // コンテキストメニュー作成
    chrome.contextMenus.create({
        id: "copy-selection-markdown",
        title: "選択箇所へのMarkdownリンクをコピー",
        contexts: ["selection"] // テキストを選択している時だけ表示
    });

    // 初期設定がない場合に保存
    const items = await chrome.storage.sync.get('notice-duration');
    if (items['notice-duration'] === undefined) {
        chrome.storage.sync.set({ 'notice-duration': 1000 });
    }
});

// コンテキストメニュー（右クリック）クリック時の処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "copy-selection-markdown") {
        let expandedText = info.selectionText;
        try {
            // 右クリックで渡される info.selectionText は既に切り取られた後のため、
            // ページ内で再度「広げた選択範囲」を取得し直す
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: getExpandedSelectionTextInPage
            });
            if (result[0].result) {
                expandedText = result[0].result;
            }
        } catch (err) {
            console.warn('Failed to expand selection on page, using raw selection:', err);
        }
        performSelectionCopy(expandedText, info.pageUrl, tab);
    }
});

// ショートカットキーのリスナー
chrome.commands.onCommand.addListener(async (command, tab) => {
    switch (command) {
        case "copy-page-md":
            copyPageLink(tab);
            break;

        case "copy-selection-md": {
            if (isRestrictedPage(tab.url)) {
                showRestrictedNotification();
                return;
            }

            try {
                console.log("shortcut capture");
                const result = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: getExpandedSelectionTextInPage
                });
                const selection = result[0].result;
                if (selection) {
                    console.log("shortcut capture success: ", selection);
                    performSelectionCopy(selection, tab.url, tab);
                }
            } catch (err) {
                console.error('Shortcut capture failed:', err);
            }
            break;
        }
    }
});

// ページ内で実行される「選択範囲を単語境界まで広げる」関数
function getExpandedSelectionTextInPage() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;

    const originalRange = range.cloneRange();

    try {
        // --- 始点の調整 ---
        // 既に単語の先頭にいる場合に前の単語へ戻ってしまうのを防ぐため、
        // 1文字右に移動してから、改めて単語の先頭を探す
        selection.collapseToStart();
        selection.modify('move', 'forward', 'character');
        selection.modify('move', 'backward', 'word');
        const startContainer = selection.anchorNode;
        const startOffset = selection.anchorOffset;

        // --- 終点の調整 ---
        // 既に単語の末尾にいる場合に次の単語へ進んでしまうのを防ぐため、
        // 一旦元の範囲に戻してから、1文字左に移動し、改めて単語の末尾を探す
        selection.removeAllRanges();
        selection.addRange(originalRange);
        selection.collapseToEnd();
        selection.modify('move', 'backward', 'character');
        selection.modify('move', 'forward', 'word');
        const endContainer = selection.focusNode;
        const endOffset = selection.focusOffset;

        // 新しい範囲を作成してテキスト取得
        const expandedRange = document.createRange();
        expandedRange.setStart(startContainer, startOffset);
        expandedRange.setEnd(endContainer, endOffset);
        const text = expandedRange.toString();

        // ユーザーの選択範囲を元に戻す
        selection.removeAllRanges();
        selection.addRange(originalRange);

        return text;
    } catch (e) {
        console.error('Failed to expand selection:', e);
        selection.removeAllRanges();
        selection.addRange(originalRange);
        return originalRange.toString();
    }
}

// 禁止ページ判定
function isRestrictedPage(url) {
    const restrictedPrefixes = ['chrome://', 'about:', 'https://chrome.google.com/webstore', 'edge://'];
    return !url || restrictedPrefixes.some(prefix => url.startsWith(prefix));
}

// 禁止ページ用の通知を表示
function showRestrictedNotification(message = 'このページでは一部の機能が制限されます。\n右クリックメニューを使用してください。') {
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
    // ストレージから最新の通知時間を取得（初期設定を前提とする）
    const items = await chrome.storage.sync.get('notice-duration');
    const duration = items['notice-duration'] || 1000;

    if (isRestrictedPage(url)) {
        // 禁止ページならオフスクリーン経由でコピー
        const success = await copyViaOffscreen(text);
        if (success) {
            showRestrictedNotification('Markdownをコピーしました（※制限ページのためシステム通知）');
        } else {
            showRestrictedNotification('コピーに失敗しました（※制限ページのためシステム通知）');
        }
    } else {
        // 通常ページならページ内にスクリプトを注入して通知を出す
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: copyToClipboardWithNotice,
            args: [text, duration]
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
async function performSelectionCopy(rawSelection, rawUrl, tab) {
    const selectionText = generateTextFragmentParam(rawSelection);
    const pageUrl = rawUrl.split('#')[0];
    const title = cleanLabel(tab.title);

    const fragment = `#:~:text=${selectionText}`;
    const markdownLink = `[${title}](${getReadableUrl(pageUrl)}${fragment})`;

    dispatchCopy(tab.id, tab.url, markdownLink);
}

// ページ全体リンクのコピー共通処理
async function copyPageLink(tab) {
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
        return response?.success || false;
    } catch (err) {
        console.error('Copy via offscreen failed:', err);
        return false;
    }
}

// Webサイト側で実行される共通のコピー＆通知関数
async function copyToClipboardWithNotice(text, duration) {
    try {
        await navigator.clipboard.writeText(text);
        showNotice("Markdown Copied!", "#2ecc71", duration);
    } catch (err) {
        console.error('Failed to copy: ', err);
        showNotice("Copy Failed", "#e74c3c", duration);
    }

    // 通知用メッセージを表示する補助関数
    function showNotice(message, bgColor, displayMs) {
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
        }, displayMs);
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

    // 前後の空白をトリミングし、内部の連続した空白を1つにする
    const cleanText = text.trim().replace(/\s+/g, ' ');

    if (cleanText.length <= THRESHOLD) {
        return safeSelectiveEncode(cleanText);
    }

    // 単語境界を判定するセグメンター（ブラウザ標準機能）
    let segmenter;
    try {
        // 実行環境の言語設定に合わせるが、日本語は常に考慮
        segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    } catch (e) {
        segmenter = null;
    }

    // --- 開始部分を抽出 ---
    let startPart = "";
    if (segmenter) {
        const segments = Array.from(segmenter.segment(cleanText));
        for (const segment of segments) {
            const startIdx = segment.index;
            const endIdx = startIdx + segment.segment.length;

            // 基準点（BASE_LEN）が含まれるセグメントを探す
            if (startIdx <= BASE_LEN && endIdx >= BASE_LEN) {
                // 基準点に近い方の境界を選択（ただし、開始部分が空にならないよう配慮）
                const distToStart = BASE_LEN - startIdx;
                const distToEnd = endIdx - BASE_LEN;

                // 始点が0（文字列の先頭）の場合は、単語の終わりまで取る
                const finalLen = (distToStart < distToEnd && startIdx > 0) ? startIdx : endIdx;
                startPart = cleanText.substring(0, finalLen);
                break;
            }
        }
    } else {
        // Fallback: Segmenterが使えない場合
        startPart = cleanText.substring(0, BASE_LEN);
        const followingText = cleanText.substring(BASE_LEN);
        const startExtension = followingText.match(/^[^\s,.;:!?]*/);
        if (startExtension) {
            startPart += startExtension[0];
        }
    }

    // --- 終了部分を抽出 ---
    let endPart = "";
    if (segmenter) {
        const segments = Array.from(segmenter.segment(cleanText));
        const targetIdx = cleanText.length - BASE_LEN;

        for (const segment of segments) {
            const startIdx = segment.index;
            const endIdx = startIdx + segment.segment.length;

            // 基準点（後ろから20文字の位置）が含まれるセグメントを探す
            if (startIdx <= targetIdx && endIdx >= targetIdx) {
                // 基準点に近い方の境界を選択
                const distToStart = targetIdx - startIdx;
                const distToEnd = endIdx - targetIdx;

                // 終点が文字列の最後の場合は、単語の始まりまで取る
                const finalStartIdx = (distToEnd < distToStart && endIdx < cleanText.length) ? endIdx : startIdx;
                endPart = cleanText.substring(finalStartIdx);
                break;
            }
        }
    } else {
        // Fallback
        endPart = cleanText.substring(cleanText.length - BASE_LEN);
        const leadingText = cleanText.substring(0, cleanText.length - BASE_LEN);
        const endExtension = leadingText.match(/[^\s,.;:!?]*$/);
        if (endExtension) {
            endPart = endExtension[0] + endPart;
        }
    }

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