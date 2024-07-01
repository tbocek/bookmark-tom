//************************** AUTH **************************
// Function to intercept and modify outgoing requests for authentication
async function addAuthHeader(details) {
    const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword']);
    const username = config.webdavUsername;
    const password = config.webdavPassword;

    const isExtensionRequest = details.requestHeaders.some(
        header => header.name.toLowerCase() === 'x-extension-request' && header.value === 'bookmark'
    );

    if (isExtensionRequest) {
        details.requestHeaders.push({name: 'Authorization', value: 'Basic ' + btoa(username + ":" + password)});
        details.requestHeaders.push({name: 'User-Agent', value: 'Mozilla/5.0 (Android) Nextcloud-android'});
        details.requestHeaders = details.requestHeaders.filter(header => header.name.toLowerCase() !== 'sec-fetch-mode');
        details.requestHeaders = details.requestHeaders.filter(header => header.name.toLowerCase() !== 'cookie');
        details.requestHeaders = details.requestHeaders.filter(header => header.name.toLowerCase() !== 'x-extension-request');
    }
    return { requestHeaders: details.requestHeaders };
}

//************************** WEBDAV **************************
async function fetchBookmarksFromWebDAV(url, username, password) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));
    headers.set('X-Extension-Request', 'bookmark');

    try {
        const response = await fetch(url, {
            headers: headers,
            credentials: 'omit',
        });
        if(response.status === 404) { //its empty on the remote site
            return null;
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching bookmarks:', error);
    }
}

// Function to update the WebDAV file
async function updateWebDAVFile(url, username, password, bookmarks) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));
    headers.set('Content-Type', 'application/json');
    headers.set('X-Extension-Request', 'bookmark');

    const response = await fetch(url, {
        method: 'PUT',
        headers: headers,
        credentials: 'omit',
        body: JSON.stringify(bookmarks)
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
}
//************************** LOCAL BOOKMARKS **************************
// Function to recursively fetch and structure bookmarks
async function fetchBookmarksLocal(bookmarks, parentPath = "") {
    let results = [];

    for (const bookmark of bookmarks) {
        const bookmarkData = {
            title: bookmark.title,
            index: bookmark.index,
            path: parentPath
        };

        if (bookmark.url) {
            bookmarkData.url = bookmark.url;
        }

        results.push(bookmarkData);

        // If the bookmark has children, fetch and structure them recursively
        if (bookmark.children) {
            const isRoot = bookmark.title === ""
            const childrenPath = isRoot ? "" : `${parentPath}/${bookmark.title}`;
            const childrenResults = await fetchBookmarksLocal(bookmark.children, childrenPath);
            results = results.concat(childrenResults);
        }
    }

    return results;
}

async function findBookmarkId(url, title, index, path) {
    let searchResults;

    // If a URL is provided, search by URL
    if (url) {
        searchResults = await browser.bookmarks.search({ url });
    } else {
        // If no URL is provided, search by title
        searchResults = await browser.bookmarks.search({ title });
    }

    for (const bookmark of searchResults) {
        // Check additional criteria to ensure it's the correct bookmark
        if (bookmark.title === title && (index === null || bookmark.index === index) && (url === null || bookmark.url === url)) {
            // Reconstruct the path
            let currentNode = bookmark;
            let currentPath =  "";
            while (currentNode.parentId) {
                const parentNode = await browser.bookmarks.get(currentNode.parentId);
                currentNode = parentNode[0];
                currentPath = currentNode.title + (currentPath ? '/' + currentPath : '');
            }
            // Compare paths
            if (currentPath === path) {
                return bookmark.id;
            }
        }
    }

    return null; // No matching bookmark found
}

async function findBookmarkPath(path) {
    const bookmarkTree = await browser.bookmarks.getTree();
    const sanitizedPath = path.replace(/^\/+/, ''); // Remove leading slashes
    const pathParts = sanitizedPath.split('/');

    function searchTree(nodes, pathParts) {
        if (pathParts.length === 0) {
            return null;
        }

        const [currentPart, ...remainingParts] = pathParts;

        for (const node of nodes) {
            console.log("search in nodes", node.title, currentPart)
            if (node.title === currentPart) {
                if (remainingParts.length === 0) {
                    console.log(node.title)
                    return node.id;
                } else if (node.children) {
                    const result = searchTree(node.children, remainingParts);
                    if (result) {
                        return result;
                    }
                }
            }
        }

        return null;
    }

    return searchTree(bookmarkTree[0].children, pathParts);
}

async function updateLocalBookmarks(delBookmarks, insBookmarks, upBookmarksUrls, upBookmarksTitles, upBookmarksIndexes) {
    try {
        // Delete bookmarks
        for (let i = delBookmarks.length - 1; i >= 0; i--) {
            const delBookmark = delBookmarks[i];
            const id = await findBookmarkId(delBookmark.url, delBookmark.title, null, delBookmark.path);
            if (id) {
                await browser.bookmarks.remove(id);
                console.log('Bookmark removed successfully.', delBookmark.title);
            }
        }
        // Insert bookmarks
        for (const insBookmark of insBookmarks) {
            console.log("search path", insBookmark.path)
            const parentId = await findBookmarkPath(insBookmark.path);
            console.log("search parentId", parentId)
            if (parentId) {
                await browser.bookmarks.create({
                    parentId,
                    title: insBookmark.title,
                    url: insBookmark.url,
                    index: insBookmark.index
                });
                console.log('Bookmark created successfully.', insBookmark.title);
            }
        }

        // Update Bookmarks
        for (const upBookmarksUrl of upBookmarksUrls) {
            const id = await findBookmarkId(upBookmarksUrl.oldUrl, upBookmarksUrl.title, null, upBookmarksUrl.path);
            if (id) {
                await browser.bookmarks.update(id, {url: upBookmarksUrl.url});
                console.log('Bookmark url updated.', upBookmarksUrl.url);
            }
        }
        for (const upBookmarksTitle of upBookmarksTitles) {
            const id = await findBookmarkId(upBookmarksTitle.url, upBookmarksTitle.oldTitle, null, upBookmarksTitle.path);
            if (id) {
                await browser.bookmarks.update(id, {title: upBookmarksTitle.title});
                console.log('Bookmark title updated.', upBookmarksTitle.title);
            }
        }
        for (const upBookmarksIndex of upBookmarksIndexes) {
            const id = await findBookmarkId(upBookmarksIndex.url, upBookmarksIndex.title, upBookmarksIndex.oldIndex, upBookmarksIndex.path);
            if (id) {
                await browser.bookmarks.move(id, {index: upBookmarksIndex.index});
                console.log('Bookmark index updated.', upBookmarksIndex.index);
            }
        }
        console.log('Bookmarks updated successfully.');
    } catch (error) {
        console.error('Error updating bookmarks:', error);
    }
}

//************************** NOTIFICATION ************************
let previousTabId;
async function openConfirmationPage(changes, action, localBookmarks) {
    const { insertions, deletions, updateUrls, updateTitles, updateIndexes } = changes;

    // Store changes and context in the browser's local storage
    browser.storage.local.set({
        insertions: insertions,
        deletions: deletions,
        updateUrls: updateUrls,
        updateTitles: updateTitles,
        updateIndexes: updateIndexes,
        action: action,
        localBookmarks: localBookmarks
    });

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
    previousTabId = currentTab.id;
    // Open a new tab with the confirmation page
    browser.tabs.create({ url: browser.extension.getURL('confirmation.html') });
}

async function closeWindow() {
    const [confirmationTab] = await browser.tabs.query({ url: browser.extension.getURL('confirmation.html') });
    if (confirmationTab) {
        await browser.tabs.remove(confirmationTab.id);
    }

    // Activate the previous tab
    if (previousTabId) {
        await browser.tabs.update(previousTabId, { active: true });
    }

    // Clear stored data
    await browser.storage.local.remove(['insertions', 'deletions', 'updateUrls', 'updateTitles', 'updateIndexes', 'action', 'localBookmarks']);
    previousTabId = null;
}

browser.runtime.onMessage.addListener(async (message) => {
    try {
        if (message.action === 'Local Update') {
            const {insertions, deletions, updateUrls, updateTitles, updateIndexes} = await browser.storage.local.get(['insertions', 'deletions', 'updateUrls', 'updateTitles', 'updateIndexes']);
            await updateLocalBookmarks(deletions, insertions, updateUrls, updateTitles, updateIndexes);
            await closeWindow();
        } else if (message.action === 'Remote Update') {
            const {localBookmarks} = await browser.storage.local.get(['localBookmarks']);
            const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword']);
            const url = config.webdavUrl;
            const username = config.webdavUsername;
            const password = config.webdavPassword;
            await updateWebDAVFile(url, username, password, localBookmarks);
            await closeWindow();
        } else if (message.action === 'cancelChanges') {
            console.log('User cancelled the changes.');
            await closeWindow();
        }
    } catch (e) {
        console.log(e);
    }
});


//************************** MAIN LOGIC **************************
// Function to get all bookmarks and store them in local storage
async function syncAllBookmarks(localMaster) {
    const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword']);
    const url = config.webdavUrl;
    const username = config.webdavUsername;
    const password = config.webdavPassword;

    if(!url) {
        throw new Error("URL not set!");
    }
    if(!username) {
        throw new Error("username not set!");
    }
    if(!password) {
        throw new Error("password not set!");
    }

    const bookmarkTreeNodes = await browser.bookmarks.getTree()
    const localBookmarks = await fetchBookmarksLocal(bookmarkTreeNodes);
    const remoteBookmarks = await fetchBookmarksFromWebDAV(url,username,password);

    if(!bookmarksChanged(remoteBookmarks, localBookmarks)) {
        console.log("not changed");
        return;
    }

    if(localMaster || !remoteBookmarks) {
        const changes = getBookmarkChanges(localBookmarks, remoteBookmarks?remoteBookmarks:[]);
        console.log("local master", changes);
        await openConfirmationPage(changes, 'Remote Update', localBookmarks);
    } else {
        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);
        console.log("remote master", changes);
        await openConfirmationPage(changes, 'Local Update', null);
    }
}

function getBookmarkChanges(mainBookmarks, oldBookmarks) {
    const oldBookmarksMap = new Map();
    const mainBookmarksMap = new Map();

    // Populate maps and check for duplicates in oldBookmarks
    const deletions = [];
    oldBookmarks.forEach(oldBookmark => {
        const key = oldBookmark.url + oldBookmark.path + oldBookmark.title + oldBookmark.index;
        if (oldBookmarksMap.has(key)) {
            // Track duplicates in oldBookmarks for deletion
            deletions.push(oldBookmark);
        } else {
            oldBookmarksMap.set(key, oldBookmark);
        }
    });

    // Populate maps and check for duplicates in mainBookmarks
    const insertions = [];
    mainBookmarks.forEach(mainBookmark => {
        const key = mainBookmark.url + mainBookmark.path + mainBookmark.title + mainBookmark.index;
        if (mainBookmarksMap.has(key)) {
            // Track duplicates in mainBookmarks for deletion
            insertions.push(mainBookmark);
        } else {
            mainBookmarksMap.set(key, mainBookmark);
        }
    });

    // Identify insertions: bookmarks in mainBookmarks not present in oldBookmarks
    mainBookmarksMap.forEach((mainBookmark, key) => {
        if (!oldBookmarksMap.has(key)) {
            insertions.push(mainBookmark);
        }
    });

    // Identify deletions: bookmarks in oldBookmarks not present in mainBookmarks
    oldBookmarksMap.forEach((oldBookmark, key) => {
        if (!mainBookmarksMap.has(key)) {
            deletions.push(oldBookmark);
        }
    });

    const updateUrls = [];
    const updateTitles = [];
    const updateIndexes = [];

    // Create a map from delBookmarks for quick lookup
    const delMapUrl = new Map();
    const delMapTitle = new Map();
    const delMapIndex = new Map();
    deletions.forEach(bookmark => {
        const keyUrl = bookmark.title + bookmark.path + bookmark.index;
        delMapUrl.set(keyUrl, bookmark);

        let keyTitle;
        if(bookmark.url) {
            keyTitle = bookmark.url + bookmark.path + bookmark.index;
        } else {
            keyTitle = bookmark.path + bookmark.title;
        }
        delMapTitle.set(keyTitle, bookmark);

        const keyIndex = bookmark.title + bookmark.path + bookmark.url;
        delMapIndex.set(keyIndex, bookmark);
    });

    // Iterate over insBookmarks to find matching entries in delBookmarks with different indexes
    for (let i = insertions.length - 1; i >= 0; i--) {
        const insBookmark = insertions[i];
        const keyUrl = insBookmark.title + insBookmark.path + insBookmark.index;
        let keyTitle;
        if(insBookmark.url) {
            keyTitle = insBookmark.url + insBookmark.path + insBookmark.index;
        } else {
            keyTitle = insBookmark.path + insBookmark.title;
        }
        const keyIndex = insBookmark.title + insBookmark.path + insBookmark.url;
        if (delMapIndex.has(keyIndex)) {
            const delBookmark = delMapIndex.get(keyIndex);
            if (delBookmark) {
                updateIndexes.push({...insBookmark, oldIndex: delBookmark.index});
                // Remove the entries from both delBookmarks and insBookmarks
                deletions.splice(deletions.indexOf(delBookmark), 1);
                insertions.splice(i, 1);
            }
        } else if (delMapTitle.has(keyTitle)) {
            const delBookmark = delMapTitle.get(keyTitle);
            if (delBookmark) {
                console.log("old", delBookmark)
                console.log("new", insBookmark)
                updateTitles.push({...insBookmark, oldTitle: delBookmark.title});
                // Remove the entries from both delBookmarks and insBookmarks
                deletions.splice(deletions.indexOf(delBookmark), 1);
                insertions.splice(i, 1);
            }
        } else if (delMapUrl.has(keyUrl)) {
            const delBookmark = delMapUrl.get(keyUrl);
            if (delBookmark) {
                console.log("old1", delBookmark)
                console.log("new1", insBookmark)
                updateUrls.push({...insBookmark, oldUrl: delBookmark.url});
                // Remove the entries from both delBookmarks and insBookmarks
                deletions.splice(deletions.indexOf(delBookmark), 1);
                insertions.splice(i, 1);
            }
        }
    }

    return { insertions, deletions, updateUrls, updateTitles, updateIndexes};
}

// Function to compare bookmarks
function bookmarksChanged(mainBookmarks, oldBookmarks) {

    if(mainBookmarks === null && oldBookmarks.length > 0) {
        return true;
    }
    console.log(mainBookmarks);
    console.log(oldBookmarks);
    if (mainBookmarks.length !== oldBookmarks.length) {
        console.log("length change")
        return true;
    }

    const localMap = new Map(oldBookmarks.map(b => [b.url + b.path + b.title + b.index, b]));

    for (const remoteBookmark of mainBookmarks) {
        const localBookmark = localMap.get(remoteBookmark.url + remoteBookmark.path + remoteBookmark.title + remoteBookmark.index);
        if (!localBookmark) {
            console.log("string change1", remoteBookmark)
            return true;
        }
        if (JSON.stringify(remoteBookmark) !== JSON.stringify(localBookmark)) {

            console.log(JSON.stringify(remoteBookmark))
            console.log(JSON.stringify(localBookmark))

            console.log("string change2")
            return true;
        }
    }

    console.log("nope change")
    return false;
}

(async () => {
    await syncAllBookmarks(false); //sync on startup
    setInterval(async () => {
        await syncAllBookmarks(false); //sync every x minutes
    }, 600000);

    const config = await browser.storage.sync.get(['webdavUrl']);
    const url = config.webdavUrl;
    if(!url) {
        throw new Error("URL not set!");
    }
    // Add listener to modify request headers
    browser.webRequest.onBeforeSendHeaders.addListener(
        addAuthHeader,
        { urls: [url] },
        ["blocking", "requestHeaders"]
    );
})();

let debounceTimer;
let isLocalDelete = false

async function debounceSync(localMaster, localDelete) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if(!isLocalDelete && localDelete) {
        isLocalDelete = true;
    }

    debounceTimer = setTimeout(async () => {
        console.log("updatingBookmarks");
        await syncAllBookmarks(localMaster);
        isLocalDelete = false;
    }, 1000);
}

// Listen for user changes to bookmarks
browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    debounceSync(true, false);
});
browser.bookmarks.onCreated.addListener(async (id, changeInfo) => {
    debounceSync(true,false);
});
browser.bookmarks.onMoved.addListener(async (id, changeInfo) => {
    debounceSync(true,true);
});
browser.bookmarks.onRemoved.addListener(async (id, changeInfo) => {
    debounceSync(true,true);
});

// Listen for messages to trigger the syncAllBookmarks function
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === "syncAllBookmarks") {
        try {
            debounceSync(false, false).then(() => {
                sendResponse({success: true});
            });
        } catch (error) {
            sendResponse({success: false, error: error});
        }
        return true;  // Keep the message channel open for sendResponse
    }
});