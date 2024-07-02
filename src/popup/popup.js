document.addEventListener('DOMContentLoaded', async () => {
    const syncButton = document.getElementById('sync-button'); // Get the sync button
    const lastSynced = document.getElementById('last-synced');
    syncButton.addEventListener('click', async() => { // Add event listener for sync button
        const success = await browser.runtime.sendMessage({ command: "syncAllBookmarks" });
        //TODO: check success -> this is for some reason undefinde?
        const storageData = await browser.storage.local.get(['message']);
        lastSynced.textContent = storageData.message;
    });

    const storageData = await browser.storage.local.get(['message']);
    if (storageData.message) {
        lastSynced.textContent = storageData.message;
    }
});