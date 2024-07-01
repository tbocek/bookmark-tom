document.addEventListener('DOMContentLoaded', async function () {
    const storageData = await browser.storage.local.get(['insertions', 'deletions', 'updateUrls', 'updateTitles', 'updateIndexes', 'action']);
    const { insertions, deletions, updateUrls, updateTitles, updateIndexes, action } = storageData;

    const insertionsDiv = document.getElementById('insertions');
    const deletionsDiv = document.getElementById('deletions');
    const updatesDiv = document.getElementById('updates');

    if (insertions && insertions.length > 0) {
        insertionsDiv.innerHTML = `<h2>Bookmarks to be inserted (${action}):</h2><ul>` +
            insertions.map(b => `<li>${b.title} (${b.url})</li>`).join('') + '</ul>';
    }

    if (deletions && deletions.length > 0) {
        deletionsDiv.innerHTML = `<h2>Bookmarks to be deleted (${action}):</h2><ul>` +
            deletions.map(b => `<li>${b.title} (${b.url})</li>`).join('') + '</ul>';
    }

    if (updateUrls && updateUrls.length > 0) {
        updatesDiv.innerHTML = `<h2>Bookmarks to be updated / url (${action}):</h2><ul>` +
            updateUrls.map(b => `<li>${b.title} (${b.url})</li>`).join('') + '</ul>';
    }

    if (updateTitles && updateTitles.length > 0) {
        updatesDiv.innerHTML += `<h2>Bookmarks to be updated / title (${action}):</h2><ul>` +
            updateTitles.map(b => `<li>${b.title} (${b.url})</li>`).join('') + '</ul>';
    }

    if (updateIndexes && updateIndexes.length > 0) {
        updatesDiv.innerHTML += `<h2>Bookmarks to be updated / fix/index (${action}, ${updateIndexes.length})</h2>`;
    }

    document.getElementById('confirm').addEventListener('click', function () {
        browser.runtime.sendMessage({ action: action });
    });

    document.getElementById('cancel').addEventListener('click', function () {
        browser.runtime.sendMessage({ action: 'cancelChanges' });
    });
});