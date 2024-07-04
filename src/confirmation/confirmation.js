document.addEventListener('DOMContentLoaded', async function () {
    const storageData = await browser.storage.local.get(['insertions', 'deletions', 'updateUrls', 'updateTitles', 'updateIndexes', 'action']);
    const { insertions, deletions, updateUrls, updateTitles, updateIndexes, action } = storageData;

    const insertionsDiv = document.getElementById('insertions');
    const deletionsDiv = document.getElementById('deletions');
    const updatesDiv = document.getElementById('updates');

    const cloudToMachineSVG = 'icons/cloud2machine.svg';
    const machineToCloudSVG = 'icons/machine2cloud.svg';

    function createListItem(bookmark) {
        const li = document.createElement('li');
        li.textContent = bookmark.title;

        if (bookmark.url) {
            const br = document.createElement('br');
            const span = document.createElement('span');
            span.classList.add('url');
            const a = document.createElement('a');
            a.href = bookmark.url;
            a.textContent = bookmark.url;
            span.appendChild(a);
            li.appendChild(br);
            li.appendChild(span);
        }

        const brPath = document.createElement('br');
        const pathSpan = document.createElement('span');
        pathSpan.classList.add('path');
        pathSpan.textContent = bookmark.path.join(' > ');

        li.appendChild(brPath);
        li.appendChild(pathSpan);

        return li;
    }

    function createSection(title, iconUrl, items) {
        const section = document.createElement('div');

        const h2 = document.createElement('h2');
        h2.textContent = title;
        const icon = document.createElement('img');
        icon.src = iconUrl;
        icon.classList.add('icon');
        h2.appendChild(icon);
        section.appendChild(h2);

        const ul = document.createElement('ul');
        items.forEach(item => ul.appendChild(createListItem(item)));
        section.appendChild(ul);

        return section;
    }

    if (insertions && insertions.length > 0) {
        const section = createSection(`Insert (${action}):`, cloudToMachineSVG, insertions);
        insertionsDiv.appendChild(section);
    }

    if (deletions && deletions.length > 0) {
        const section = createSection(`Delete (${action}):`, machineToCloudSVG, deletions);
        deletionsDiv.appendChild(section);
    }

    if (updateUrls && updateUrls.length > 0) {
        const section = createSection(`Updated URL (${action}):`, machineToCloudSVG, updateUrls);
        updatesDiv.appendChild(section);
    }

    if (updateTitles && updateTitles.length > 0) {
        const section = createSection(`Update Title (${action}):`, machineToCloudSVG, updateTitles);
        updatesDiv.appendChild(section);
    }

    if (updateIndexes && updateIndexes.length > 0) {
        const h2 = document.createElement('h2');
        h2.textContent = `Fix Index - ${updateIndexes.length} (${action})`;
        updatesDiv.appendChild(h2);
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
