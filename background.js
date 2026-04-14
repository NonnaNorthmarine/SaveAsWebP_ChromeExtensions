function createContextMenu() {
  chrome.contextMenus.create({
    id: "save-img-as-webp",
    title: "WebPとして保存",
    contexts: ["image"]
  }, () => {
    if (chrome.runtime.lastError) {}
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

createContextMenu();

// ポップアップ（Toast）表示・非表示の関数
async function showToast(tabId, message) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (msg) => {
        let div = document.getElementById("webp-converting-popup");
        if (!div) {
          div = document.createElement("div");
          div.id = "webp-converting-popup";
          div.style.position = "fixed";
          div.style.top = "20px";
          div.style.right = "20px";
          div.style.padding = "15px 25px";
          div.style.backgroundColor = "rgba(0, 0, 0, 0.85)";
          div.style.color = "white";
          div.style.borderRadius = "8px";
          div.style.zIndex = "2147483647";
          div.style.fontFamily = "sans-serif";
          div.style.fontSize = "15px";
          div.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
          div.style.pointerEvents = "none";
          document.body.appendChild(div);
        }
        div.textContent = msg;
      },
      args: [message]
    });
  } catch (e) {
    console.log("Could not inject toast script", e);
  }
}

async function removeToast(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const div = document.getElementById("webp-converting-popup");
        if (div) div.remove();
      }
    });
  } catch (e) {}
}

// Offscreen ドキュメントのセットアップ
let creating; // 同時実行を防ぐためのフラグ
async function setupOffscreenDocument(path) {
  const offscreenUrl = chrome.runtime.getURL(path);
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  if (existingContexts.length > 0) return;

  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['WORKERS'],
      justification: 'FFmpeg processing for GIF to WebP conversion',
    });
    await creating;
    creating = null;
  }
}

// 保存された画質(品質)を取得するヘルパー関数
const getQuality = () => new Promise(resolve => {
  chrome.storage.local.get(['webpQuality'], (result) => {
    resolve(result.webpQuality !== undefined ? result.webpQuality : 80);
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "save-img-as-webp") {
    try {
      const srcUrl = info.srcUrl;
      let baseFilename = "image";
      let originalExt = "";
      
      try {
        const urlObj = new URL(srcUrl);
        let pathname = urlObj.pathname;
        let lastSegment = pathname.substring(pathname.lastIndexOf('/') + 1);
        if (lastSegment) {
          const lastDotIndex = lastSegment.lastIndexOf('.');
          if (lastDotIndex !== -1) {
            originalExt = lastSegment.substring(lastDotIndex + 1).toLowerCase();
            lastSegment = lastSegment.substring(0, lastDotIndex);
          }
          baseFilename = lastSegment;
        }
      } catch (e) {
        baseFilename = "downloaded_image";
      }

      // 品質設定の取得
      const quality = await getQuality();

      // 1. fetch で対象の画像を取得
      const response = await fetch(srcUrl);
      const blob = await response.blob();

      // ★ すでにWebPの場合
      if (blob.type === 'image/webp' || blob.type === 'image/x-webp' || originalExt === 'webp') {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const dataUrl = 'data:image/webp;base64,' + btoa(binary);

        chrome.downloads.download({ url: dataUrl, filename: baseFilename + ".webp", saveAs: false });
        return;
      }

      // ★ GIFアニメーションの場合のみ、FFmpeg (Offscreen) を使って丁寧な処理を行う
      if (blob.type === 'image/gif' || originalExt === 'gif') {
        await showToast(tab.id, "GIFアニメをWebPに変換中... しばらくお待ちください");
        
        try {
          await setupOffscreenDocument('offscreen.html');
          
          // Offscreen側でFetchCORSエラーが起きないよう、Background側でBase64として準備する
          const buffer = await blob.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
          const srcDataB64 = btoa(binary);
          
          const conversionResponse = await new Promise((resolve, reject) => {
             chrome.runtime.sendMessage({
                target: 'offscreen',
                type: 'convert-gif',
                srcDataB64: srcDataB64,
                quality: quality
             }, (resp) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else resolve(resp);
             });
          });

          if (conversionResponse && conversionResponse.success) {
            chrome.downloads.download({
              url: conversionResponse.dataUrl,
              filename: baseFilename + ".webp",
              saveAs: false
            });
            await removeToast(tab.id);
          } else {
            console.error(conversionResponse.error);
            await showToast(tab.id, "GIFの変換に失敗しました");
            setTimeout(() => removeToast(tab.id), 3000);
          }
        } catch (err) {
          console.error(err);
          await showToast(tab.id, "GIFの変換処理でエラーが発生しました");
          setTimeout(() => removeToast(tab.id), 3000);
        }
        return; // GIF用の処理はここまで
      }
      
      // ★ JPG / PNG の場合: 高速な OffscreenCanvas を使用
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, 0, 0);

      // 品質設定を小数点に変換して適用
      const qualityDecimal = quality / 100;
      const webpBlob = await canvas.convertToBlob({ type: 'image/webp', quality: qualityDecimal });

      const buffer = await webpBlob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
      const dataUrl = 'data:image/webp;base64,' + btoa(binary);

      chrome.downloads.download({
        url: dataUrl,
        filename: baseFilename + ".webp",
        saveAs: false
      });

    } catch (e) {
      console.error("画像の変換またはダウンロードに失敗しました:", e);
      if (tab) {
         await showToast(tab.id, "エラー: 画像を取得・変換できませんでした");
         setTimeout(() => removeToast(tab.id), 3000);
      }
    }
  }
});
