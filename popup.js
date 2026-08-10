const STORAGE_KEY = "ghaLogCopierEnabled";
const TIMESTAMP_KEY = "ghaLogCopierTimestamps";

const toggle = document.getElementById("toggle");
const toggleTimestamps = document.getElementById("toggleTimestamps");

chrome.storage.sync.get(
  { [STORAGE_KEY]: true, [TIMESTAMP_KEY]: false },
  (res) => {
    toggle.checked = res[STORAGE_KEY];
    toggleTimestamps.checked = res[TIMESTAMP_KEY];
  }
);

toggle.addEventListener("change", () => {
  chrome.storage.sync.set({ [STORAGE_KEY]: toggle.checked });
});

toggleTimestamps.addEventListener("change", () => {
  chrome.storage.sync.set({ [TIMESTAMP_KEY]: toggleTimestamps.checked });
});
