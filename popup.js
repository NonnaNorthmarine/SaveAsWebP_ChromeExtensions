document.addEventListener('DOMContentLoaded', () => {
  const slider = document.getElementById('qualitySlider');
  const display = document.getElementById('qualityValue');

  // 前回保存した設定値があれば読み込む
  chrome.storage.local.get(['webpQuality'], (result) => {
    const savedQuality = result.webpQuality !== undefined ? result.webpQuality : 80;
    slider.value = savedQuality;
    display.textContent = savedQuality + "%";
  });

  // スライダーを動かす度にローカルストレージへ保存する
  slider.addEventListener('input', (e) => {
    const value = e.target.value;
    display.textContent = value + "%";
    chrome.storage.local.set({ webpQuality: parseInt(value, 10) });
  });
});
