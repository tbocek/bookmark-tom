document.addEventListener('DOMContentLoaded', async function () {
    const storageData = await browser.storage.local.get(['insertions', 'deletions', 'action']);
    const { insertions, deletions, action } = storageData;

    const insertionsDiv = document.getElementById('insertions');
    const deletionsDiv = document.getElementById('deletions');
    const directionImg = document.getElementById('direction');

    const cloudToMachineSVG = '../icons/cloud2machine.svg';
    const machineToCloudSVG = '../icons/machine2cloud.svg';

    directionImg.src = action === "Local Update" ? cloudToMachineSVG: machineToCloudSVG;


    function createListItem(bookmark) {
        const li = document.createElement('li');
        li.textContent += bookmark.title;

        if (bookmark.url) {
            const br = document.createElement('br');
            let span = document.createElement('span');
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
        pathSpan.textContent += bookmark.path.join(' > ');

        li.appendChild(brPath);
        li.appendChild(pathSpan);

        return li;
    }

    function createSection(title, items) {
        const section = document.createElement('div');

        const h2 = document.createElement('h2');
        h2.textContent = title;
        section.appendChild(h2);

        const ul = document.createElement('ul');
        items.forEach(item => ul.appendChild(createListItem(item)));
        section.appendChild(ul);

        return section;
    }

    let diffShown = false;
    if (insertions && insertions.length > 0) {
        const section = createSection(`Insert (${action}):`, insertions);
        insertionsDiv.appendChild(section);
    } else {
        insertionsDiv.remove();
    }

    if (deletions && deletions.length > 0) {
        const section = createSection(`Delete (${action}):`, deletions);
        deletionsDiv.appendChild(section);
    } else {
        deletionsDiv.remove();
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
