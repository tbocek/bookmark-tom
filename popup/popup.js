document.addEventListener('DOMContentLoaded', () => {
    const syncButton = document.getElementById('sync-button'); // Get the sync button
    const statusDiv = document.getElementById('sync-status'); // Get the sync button
    syncButton.addEventListener('click', () => { // Add event listener for sync button
        browser.runtime.sendMessage({command: "syncAllBookmarks"}).then(response => {
            if (response.success) {
                statusDiv.textContent = 'Bookmarks synced successfully.';
            } else {
                statusDiv.textContent = `Error: ${response.error}`;
                statusDiv.style.color = 'red';
            }
            setTimeout(() => statusDiv.textContent = '', 5000);
        });
    });
});