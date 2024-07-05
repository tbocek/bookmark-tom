async function syncMessage() {
    const lastSynced = document.getElementById('last-synced');
    const storageData = await browser.storage.local.get(['message']);
    if (storageData.message) {
        lastSynced.textContent = storageData.message;
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    const syncButton = document.getElementById('sync-button'); // Get the sync button
    syncButton.addEventListener('click', async() => { // Add event listener for sync button
        await browser.runtime.sendMessage({command: "syncAllBookmarks"});
        await syncMessage();
        setInterval(async () => {
            await syncMessage();
        }, 1000);
    });
    await syncMessage();
});