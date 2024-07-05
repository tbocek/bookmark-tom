async function syncMessage() {
    const lastSynced = document.getElementById('last-synced');
    const storageData = await browser.storage.local.get(['message']);
    if (storageData.message) {
        lastSynced.textContent = storageData.message;
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    const syncButton = document.getElementById('sync-button'); // Get the sync button
    const preferencesLink = document.getElementById('preferences-link'); // Add a preferences link element
    syncButton.addEventListener('click', async() => { // Add event listener for sync button
        const success = await browser.runtime.sendMessage({command: "syncAllBookmarks"});
        if(!success) {
            preferencesLink.innerHTML = '<a href="#" id="open-preferences">Open Add-on Preferences</a>';
            document.getElementById('open-preferences').addEventListener('click', (event) => {
                event.preventDefault();
                browser.runtime.openOptionsPage();
            });
        } else {
            setInterval(async () => {
                await syncMessage();
            }, 1000);
        }
    });
    await syncMessage();
});