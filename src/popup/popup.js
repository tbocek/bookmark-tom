async function syncMessage() {
    const lastSynced = document.getElementById('last-synced');
    const storageData = await browser.storage.local.get(['message']);
    if (storageData.message) {
        lastSynced.textContent = storageData.message;
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    const lastSynced = document.getElementById('last-synced');
    const syncButton = document.getElementById('sync-button'); // Get the sync button
    const preferencesLink = document.getElementById('preferences-link'); // Add a preferences link element
    syncButton.addEventListener('click', async() => { // Add event listener for sync button
        await browser.runtime.sendMessage({command: "syncAllBookmarks"});
        await syncMessage();
        if(lastSynced.textContent.indexOf("Last sync: ") != 0) {
            preferencesLink.innerHTML = '<a href="#" id="open-preferences">Open Add-on Preferences</a>';
            document.getElementById('open-preferences').addEventListener('click', (event) => {
                event.preventDefault();
                browser.runtime.openOptionsPage();
            });
        }
    });
    await syncMessage();
    setInterval(async () => {
        await syncMessage();
    }, 1000);
});