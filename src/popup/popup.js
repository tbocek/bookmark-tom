async function syncMessage() {
  const lastSynced = document.getElementById("last-synced");
  const storageData = await browser.storage.local.get(["message"]);
  if (storageData.message) {
    lastSynced.textContent = storageData.message;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const syncButton = document.getElementById("sync-button");
  const settingsButton = document.getElementById("settings-button");

  // Settings button opens options page
  settingsButton.addEventListener("click", () => {
    browser.runtime.openOptionsPage();
  });

  // Sync button triggers sync
  syncButton.addEventListener("click", async () => {
    await browser.runtime.sendMessage({ command: "syncAllBookmarks" });
    await syncMessage();
  });

  await syncMessage();
  setInterval(syncMessage, 1000);
});
