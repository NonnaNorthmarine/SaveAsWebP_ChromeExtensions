let ffmpeg = null;

async function initFFmpeg() {
  if (!ffmpeg) {
    ffmpeg = new FFmpegWASM.FFmpeg();
    await ffmpeg.load({
      coreURL: chrome.runtime.getURL('lib/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('lib/ffmpeg-core.wasm'),
    });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target === 'offscreen' && request.type === 'convert-gif') {
    (async () => {
      try {
        await initFFmpeg();
        
        // バックグラウンドプロセスから渡されたBase64文字列からバイナリデータを復元
        // これによりCORSエラーを完全に回避できます
        const binaryString = atob(request.srcDataB64);
        const inputData = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          inputData[i] = binaryString.charCodeAt(i);
        }
        
        // FFmpegの仮想ファイルシステムに書き込む
        await ffmpeg.writeFile('input.gif', inputData);
        
        // 画質設定を取得 (デフォルトは80)
        const qValue = request.quality !== undefined ? String(Math.floor(request.quality)) : "80";
        
        // GIF を WebP (アニメーション維持) に変換
        // -c:v libwebp : WebPコーデックを使用
        // -q:v : ポップアップで設定した圧縮品質
        // -loop 0 : 無限ループ
        await ffmpeg.exec(['-i', 'input.gif', '-c:v', 'libwebp', '-q:v', qValue, '-loop', '0', 'output.webp']);
        
        // 結果を取得（Uint8Array形式）
        const outputData = await ffmpeg.readFile('output.webp');
        
        // Service Workerとの通信(sendMessage)で巨大なArrayを直接送ると重いため、
        // Offscreen側で一度 DataURL(base64) の文字列に変換してから送り返す
        let binary = '';
        for (let i = 0; i < outputData.length; i++) {
          binary += String.fromCharCode(outputData[i]);
        }
        const dataUrl = 'data:image/webp;base64,' + btoa(binary);

        sendResponse({ success: true, dataUrl: dataUrl });
      } catch (err) {
        sendResponse({ success: false, error: err.toString() });
      }
    })();
    return true; // 非同期レスポンスを有効にする
  }
});
