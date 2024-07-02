document.addEventListener('DOMContentLoaded', async function () {
    const storageData = await browser.storage.local.get(['insertions', 'deletions', 'updateUrls', 'updateTitles', 'updateIndexes', 'action']);
    const { insertions, deletions, updateUrls, updateTitles, updateIndexes, action } = storageData;

    const insertionsDiv = document.getElementById('insertions');
    const deletionsDiv = document.getElementById('deletions');
    const updatesDiv = document.getElementById('updates');

    const cloudToMachineSVG = '<img src="icons/cloud2machine.svg" class="icon" />';
    const machineToCloudSVG = '<img src="icons/machine2cloud.svg" class="icon" />';

    function createListItem(bookmark) {
        const urlPart = bookmark.url ? `<br><span class="url"><a href="${bookmark.url}">${bookmark.url}</a></span>` : '';
        return `<li>${bookmark.title}${urlPart}<br><span class="path">${bookmark.path.join(' > ')}</span></li>`;
    }

    function createSection(title, action, items) {
        const icon = action === 'Local Update' ? cloudToMachineSVG : machineToCloudSVG;
        return `<h2>${title} ${icon}</h2><ul>${items.map(createListItem).join('')}</ul>`;
    }

    if (insertions && insertions.length > 0) {
        insertionsDiv.innerHTML = createSection(`Bookmarks to be inserted (${action}):`, action, insertions);
    }

    if (deletions && deletions.length > 0) {
        deletionsDiv.innerHTML = createSection(`Bookmarks to be deleted (${action}):`, action, deletions);
    }

    if (updateUrls && updateUrls.length > 0) {
        updatesDiv.innerHTML = createSection(`Bookmarks to be updated / URL (${action}):`, action, updateUrls);
    }

    if (updateTitles && updateTitles.length > 0) {
        updatesDiv.innerHTML += createSection(`Bookmarks to be updated / Title (${action}):`, action, updateTitles);
    }

    if (updateIndexes && updateIndexes.length > 0) {
        updatesDiv.innerHTML += `<h2>Bookmarks to be updated / Index (${action}, ${updateIndexes.length})</h2>`;
    }

    const mergeBtn = document.getElementById('confirm-merge');

    // Enable the merge button conditionally
    if (action === 'Local Update' && deletions && deletions.length > 0) {
        mergeBtn.disabled = false;
        mergeBtn.addEventListener('click', function () {
            browser.runtime.sendMessage({ action: action + "-merge" });
        });
    } else {
        mergeBtn.disabled = true;
    }

    document.getElementById('confirm-force').addEventListener('click', function () {
        browser.runtime.sendMessage({ action: action });
    });

    document.getElementById('cancel').addEventListener('click', function () {
        browser.runtime.sendMessage({ action: 'cancelChanges' });
    });
});
