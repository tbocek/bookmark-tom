//************************** HELPER **************************
function arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) {
        return false;
    }
    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) {
            return false;
        }
    }
    return true;
}

//************************** WEBDAV **************************
async function fetchWebDAVBookmarks(url, username, password) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));
    headers.set('X-Extension-Request', 'bookmark');

    // Append a cache-busting parameter to the URL
    const cacheBuster = `cb=${new Date().getTime()}`;
    const urlWithCacheBuster = url.includes('?') ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;


    const response = await fetch(urlWithCacheBuster, {
        headers: headers,
        credentials: 'omit',
    });
    if (response.status === 404) { //its empty on the remote site
        return null;
    }

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    //handle if the file is empty or not an array
    try {
        const data = await response.json();
        if (Array.isArray(data)) {
            return data;
        }
        return null;
    } catch (error) {
        return null;
    }
}

// Function to update the WebDAV file
async function updateWebDAVBookmarks(url, username, password, bookmarks) {
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
    if (response.status === 404) { //its empty on the remote site
        return null;
    }

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
}
//************************** LOCAL BOOKMARKS **************************
// Function to recursively fetch and structure bookmarks
async function retrieveLocalBookmarks(bookmarks, parentPathArray = []) {
    let results = [];

    for (const bookmark of bookmarks) {
        const bookmarkData = {
            title: bookmark.title,
            index: bookmark.index,
            path: parentPathArray
        };

        if (bookmark.url) {
            bookmarkData.url = bookmark.url;
        }

        results.push(bookmarkData);

        // If the bookmark has children, fetch and structure them recursively
        if (bookmark.children) {
            const isRoot = bookmark.title === ""
            const childrenPathArray = isRoot ? [] : [...parentPathArray, bookmark.title];
            const childrenResults = await retrieveLocalBookmarks(bookmark.children, childrenPathArray);
            results = results.concat(childrenResults);
        }
    }

    return results;
}

async function locateBookmarkId(url, title, index, pathArray) {
    let searchResults;

    // If a URL is provided, search by URL
    if (url) {
        try {
            // First try exact URL search
            searchResults = await browser.bookmarks.search({ url: url });

            if (searchResults.length === 0) {
                // If no results, try query search with the URL
                searchResults = await browser.bookmarks.search({ query: url });
            }

            if (searchResults.length === 0) {
                // Try searching with decoded URL
                const decodedUrl = decodeURIComponent(url);
                searchResults = await browser.bookmarks.search({ query: decodedUrl });
            }
        } catch (error) {
            console.error('Error searching by URL:', error);
            // Fallback to title search if URL search fails
            if (title) {
                searchResults = await browser.bookmarks.search({ title });
            } else {
                return null;
            }
        }
    } else if (title) {
        // If no URL is provided, search by title
        searchResults = await browser.bookmarks.search({title});
    } else {
        throw new Error(`No bookmark found for ${url}/${title}`);
    }

    for (const bookmark of searchResults) {
        // Check additional criteria to ensure it's the correct bookmark
        if (bookmark.title === title && (index === null || bookmark.index === index) && (url === null || bookmark.url === url)) {
            // Reconstruct the path
            let currentNode = bookmark;
            let currentPath = [];
            while (currentNode.parentId) {
                const parentNode = await browser.bookmarks.get(currentNode.parentId);
                currentNode = parentNode[0];
                if (currentNode.title) {
                    currentPath.unshift(currentNode.title);
                }
            }
            // Compare paths
            if (arraysEqual(currentPath, pathArray)) {
                return bookmark.id;
            }
        }
    }

    return null; // No matching bookmark found
}

async function modifyLocalBookmarks(delBookmarks, insBookmarks) {
    try {
        // Sort deletions to handle contents before folders
        const sortedDeletions = [...delBookmarks].sort((a, b) => {
            const aIsFolder = !a.url;
            const bIsFolder = !b.url;
            // Put non-folders (contents) before folders
            if (aIsFolder !== bIsFolder) {
                return aIsFolder ? 1 : -1;  // Non-folders come first
            }
            // For items of same type, sort by path length descending
            return b.path.length - a.path.length;
        });

        // Delete bookmarks
        for (const delBookmark of sortedDeletions) {
            const id = await locateBookmarkId(delBookmark.url, delBookmark.title, null, delBookmark.path);
            try {
                if (id) {
                    await browser.bookmarks.remove(id);
                } else {
                    console.warn("bookmark not found", delBookmark)
                }
            }
            catch (error) {
                console.error('Error deleting bookmark:', delBookmark, error);
            }
        }

        // Insert bookmarks
        for (const insBookmark of insBookmarks) {
            const id = await locateBookmarkId(insBookmark.url, insBookmark.title, null, insBookmark.path);
            if (id) {
                continue;
            }
            const parentId = await locateParentId(insBookmark.path);
            if (parentId) {
                if (insBookmark.index === -1) {
                    insBookmark.index = insBookmark.oldIndex;
                }
                await browser.bookmarks.create({
                    parentId,
                    title: insBookmark.title,
                    url: insBookmark.url,
                    index: insBookmark.index
                });
            }
        }
    } catch (error) {
        console.error('Error updating bookmarks:', error);
    }
}

async function applyLocalBookmarkUpdates(upBookmarksIndexes) {
    try {
        // Sort updates by path length to handle parent folders first
        const sortedUpdates = [...upBookmarksIndexes].sort(
            (a, b) => a.path.length - b.path.length
        );

        for (const bookmark of sortedUpdates) {
            const id = await locateBookmarkId(
                bookmark.url,
                bookmark.title,
                bookmark.oldIndex,
                bookmark.path
            );

            if (id) {
                const index = bookmark.index === -1 ?
                    bookmark.oldIndex :
                    bookmark.index;

                await browser.bookmarks.move(id, {index});
            }
        }
    } catch (error) {
        console.error('Error updating bookmark indexes:', error);
        throw error;
    }
}

// Helper function to improve error handling in locateParentId
async function locateParentId(pathArray) {
    if (!pathArray || pathArray.length === 0) {
        const bookmarkTree = await browser.bookmarks.getTree();
        return bookmarkTree[0].id; // Return root folder ID
    }

    const bookmarkTree = await browser.bookmarks.getTree();

    function searchTree(nodes, pathParts) {
        if (pathParts.length === 0) {
            return nodes[0].id; // Return current node's ID
        }

        const [currentPart, ...remainingParts] = pathParts;

        for (const node of nodes) {
            if (node.title === currentPart) {
                if (remainingParts.length === 0) {
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

    return searchTree(bookmarkTree[0].children, pathArray);
}

//************************** NOTIFICATION ************************
let previousTabId;
let confirmationTabId = null;

async function displayConfirmationPage(changes, action, localBookmarks, remoteBookmarks) {
    const {insertions, deletions, updateIndexes} = changes;

    // Store changes and context in the browser's local storage
    browser.storage.local.set({
        insertions: insertions,
        deletions: deletions,
        updateIndexes: updateIndexes,
        action: action,
        localBookmarks: localBookmarks,
        remoteBookmarks: remoteBookmarks
    });

    const confirmationPageUrl = browser.runtime.getURL('confirmation/confirmation.html');

    // Check if the confirmation page is already open
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
        if (tab.url === confirmationPageUrl) {
            // If confirmation page is found, focus on it and update confirmationTabId
            await browser.tabs.update(tab.id, {active: true});
            await browser.tabs.reload(tab.id); // Refresh the tab
            confirmationTabId = tab.id;
            return;
        }
    }

    const [currentTab] = await browser.tabs.query({active: true, currentWindow: true});
    previousTabId = currentTab.id;
    // Open a new tab with the confirmation page
    const newTab = await browser.tabs.create({url: browser.runtime.getURL('confirmation/confirmation.html')});
    confirmationTabId = newTab.id;
}

async function closeConfirmationWindow() {
    const [confirmationTab] = await browser.tabs.query({url: browser.runtime.getURL('confirmation/confirmation.html')});
    if (confirmationTab) {
        await browser.tabs.remove(confirmationTab.id);
    }

    // Activate the previous tab
    if (previousTabId) {
        await browser.tabs.update(previousTabId, {active: true});
    }

    // Clear stored data
    await browser.storage.local.remove(['insertions', 'deletions', 'updateIndexes', 'action', 'localBookmarks', 'remoteBookmarks']);
    previousTabId = null;
}

//************************** MAIN LOGIC **************************
// Function to get all bookmarks and store them in local storage
async function syncAllBookmarks(url, username, password, localMaster, fromBackgroundTimer) {
    const bookmarkTreeNodes = await browser.bookmarks.getTree()
    const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
    let remoteBookmarks;
    try {
        remoteBookmarks = await fetchWebDAVBookmarks(url, username, password);
    } catch (error) {
        console.error(error);
        await browser.storage.local.set({message: `Error fetching bookmarks: ${error}`});
        return;
    }

    if (remoteBookmarks === null) {
        await browser.storage.local.set({message: `Remote file not found: ${url}. Change URL or create an empty file.`});
    }

    // Store when last synced
    const options = {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric'
    };
    const currentTime = new Date().toLocaleDateString('de-DE', options)
    await browser.storage.local.set({message: `Last sync: ${currentTime}`});

    const changes = calcBookmarkChanges(localBookmarks, remoteBookmarks ? remoteBookmarks : []);
    if ((changes.insertions && changes.insertions.length === 0) &&
        (changes.deletions && changes.deletions.length === 0) &&
        (changes.updateIndexes && changes.updateIndexes.length === 0)) {
        return;
    }

    if (fromBackgroundTimer) {
        browser.notifications.create({
            "type": "basic",
            "iconUrl": browser.runtime.getURL("icons/logo.svg"),
            "title": "Incoming Bookmark Changes",
            "message": "Open Sync Tab?",
            "priority": 2
        });

        browser.notifications.onClicked.addListener(async (notificationId) => {
            // OK button clicked
            try {
                if (localMaster || !remoteBookmarks) {
                    console.log("remote (local master, notify):", remoteBookmarks);
                    console.log("local (local master, notify):", localBookmarks);
                    const changes = calcBookmarkChanges(localBookmarks, remoteBookmarks ? remoteBookmarks : []);
                    console.log("changes (local master, notify):", changes);
                    await displayConfirmationPage(changes, 'Remote Update', localBookmarks, remoteBookmarks ? remoteBookmarks : []);
                } else {
                    console.log("remote (remote master, notify):", remoteBookmarks);
                    console.log("local (remote master, notify):", localBookmarks);
                    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);
                    console.log("changes (remote master, notify):", changes);
                    await displayConfirmationPage(changes, 'Local Update', localBookmarks, remoteBookmarks);
                }
                browser.notifications.clear(notificationId);
            } catch (e) {
                console.error(e);
            }
        });
    } else if (localMaster || !remoteBookmarks) {
        console.log("remote (local master, silent):", remoteBookmarks);
        console.log("local (local master, silent):", localBookmarks);
        const changes = calcBookmarkChanges(localBookmarks, remoteBookmarks ? remoteBookmarks : []);
        console.log("changes (local master, silent):", changes);
        await displayConfirmationPage(changes, 'Remote Update', localBookmarks, remoteBookmarks ? remoteBookmarks : []);
    } else {
        console.log("remote (remote master, silent):", remoteBookmarks);
        console.log("local (remote master, silent):", localBookmarks);
        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);
        console.log("changes (remote master, silent):", changes);
        await displayConfirmationPage(changes, 'Local Update', localBookmarks, remoteBookmarks);
    }
}

function calcBookmarkChanges(otherBookmarks, myBookmarks) {
    const myBookmarksMap = new Map();
    const otherBookmarksMap = new Map();

    // Populate maps and check for duplicates in myBookmarks
    const deletions = [];
    myBookmarks.forEach(myBookmark => {
        const key = myBookmark.title + '#' + myBookmark.index + '#' + myBookmark.path.join('/') + '#' + myBookmark.url;
        if (myBookmarksMap.has(key)) {
            // Track duplicates in myBookmarks for deletion
            deletions.push(myBookmark);
        } else {
            myBookmarksMap.set(key, myBookmark);
        }
    });

    // Populate maps and check for duplicates in otherBookmarks
    const insertions = [];
    otherBookmarks.forEach(otherBookmark => {
        const key = otherBookmark.title + '#' + otherBookmark.index + '#' + otherBookmark.path.join('/') + '#' + otherBookmark.url;
        if (otherBookmarksMap.has(key)) {
            // Track duplicates in otherBookmarks for deletion
            insertions.push(otherBookmark);
        } else {
            otherBookmarksMap.set(key, otherBookmark);
        }
    });

    // Identify insertions: bookmarks in otherBookmarks not present in myBookmarks
    otherBookmarksMap.forEach((otherBookmark, key) => {
        if (!myBookmarksMap.has(key)) {
            insertions.push(otherBookmark);
        }
    });

    // Identify deletions: bookmarks in myBookmarks not present in otherBookmarks
    myBookmarksMap.forEach((myBookmark, key) => {
        if (!otherBookmarksMap.has(key)) {
            deletions.push(myBookmark);
        }
    });

    const updateIndexes = [];
    const mapIndex = new Map();
    const mapIndexFolder = new Map();

    deletions.forEach(bookmark => {
        if (bookmark.url) {
            //here we have a regular entry
            //we have: title, index, path, url
            const keyUpdateIndex = bookmark.title + '#' + bookmark.path.join('/') + '#' + bookmark.url;
            mapIndex.set(keyUpdateIndex, bookmark);
        } else {
            //here we have a folder entry
            //we have: title, index, path
            const keyUpdateIndex = bookmark.title + '#' + bookmark.path.join('/');
            mapIndexFolder.set(keyUpdateIndex, bookmark);
        }
    });

    // Iterate over insBookmarks to find matching entries in delBookmarks with different indexes
    for (let i = insertions.length - 1; i >= 0; i--) {
        const insBookmark = insertions[i];
        if (insBookmark.url) {
            //here we have a regular entry
            //we have: title, index, path, url
            const keyUpdateIndex = insBookmark.title + '#' + insBookmark.path.join('/') + '#' + insBookmark.url;

            //index needs to come first
            if (mapIndex.has(keyUpdateIndex)) {
                const delBookmark = mapIndex.get(keyUpdateIndex);
                if (delBookmark) {
                    updateIndexes.push({...insBookmark, oldIndex: delBookmark.index});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            }
        } else {
            //here we have a folder entry
            //we have: title, index, path
            const keyUpdateIndex = insBookmark.title + '#' + insBookmark.path.join('/');

            //index needs to come first
            if (mapIndexFolder.has(keyUpdateIndex)) {
                const delBookmark = mapIndexFolder.get(keyUpdateIndex);
                if (delBookmark) {
                    updateIndexes.push({...insBookmark, oldIndex: delBookmark.index});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            }
        }
    }

    return {insertions, deletions, updateIndexes};
}

async function loadConfig() {
    const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword', 'checkIntervalMinutes']);
    const url = config.webdavUrl;
    const username = config.webdavUsername;
    const password = config.webdavPassword;
    const checkIntervalMinutes = config.checkIntervalMinutes;

    if (!url) {
        await browser.storage.local.set({message: `URL not set!`});
        throw new Error("URL not set!");
    }
    if (!username) {
        await browser.storage.local.set({message: `username not set!`});
        throw new Error("username not set!");
    }
    if (!password) {
        await browser.storage.local.set({message: `password not set!`});
        throw new Error("password not set!");
    }

    let checkInterval = parseInt(checkIntervalMinutes);
    if (isNaN(checkInterval)) {
        await browser.storage.local.set({message: `invalid check interval. Please enter a number.`});
        throw new Error("invalid check interval. Please enter a number.");
    }

    return {url, username, password, checkInterval}
}

(async () => {
    try {
        const {url, username, password, checkInterval} = await loadConfig();
        await syncAllBookmarks(url, username, password, false, true); //sync on startup
        setInterval(async () => {
            await syncAllBookmarks(url, username, password, false, true); //sync every x minutes
        }, checkInterval * 60 * 1000);
    } catch (error) {
        await browser.storage.local.set({message: error});
    }
})();

let debounceTimer;
let isLocalDelete = false

async function debounceBookmarkSync(localMaster, localDelete) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    if (!isLocalDelete && localDelete) {
        isLocalDelete = true;
    }

    const {url, username, password} = await loadConfig();

    debounceTimer = setTimeout(async () => {
        await syncAllBookmarks(url, username, password, localMaster, false);
        isLocalDelete = false;
    }, 1000);
}

// Listen for user changes to bookmarks
browser.bookmarks.onChanged.addListener(async () => {
    await debounceBookmarkSync(true, false);
});
browser.bookmarks.onCreated.addListener(async () => {
    await debounceBookmarkSync(true, false);
});
browser.bookmarks.onMoved.addListener(async () => {
    await debounceBookmarkSync(true, true);
});
browser.bookmarks.onRemoved.addListener(async () => {
    await debounceBookmarkSync(true, true);
});

// Listen for messages to trigger the syncAllBookmarks function
browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    try {
        const {url, username, password} = await loadConfig();
        if (message.action === 'Local Update') {
            const {
                insertions,
                deletions,
                remoteBookmarks
            } = await browser.storage.local.get(['insertions', 'deletions', 'remoteBookmarks']);
            await modifyLocalBookmarks(deletions, insertions);
            //Now we need to rescan, as indexes may have shifted
            const bookmarkTreeNodes = await browser.bookmarks.getTree()
            const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
            const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);
            await applyLocalBookmarkUpdates(changes.updateIndexes);
            await closeConfirmationWindow();
        } else if (message.action === 'Local Update-merge') {
            const {insertions, remoteBookmarks} = await browser.storage.local.get(['insertions', 'remoteBookmarks']);
            await modifyLocalBookmarks([], insertions);
            //Now we need to rescan, as indexes may have shifted
            const bookmarkTreeNodes = await browser.bookmarks.getTree()
            const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
            const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);
            await applyLocalBookmarkUpdates(changes.updateIndexes);
            await closeConfirmationWindow();
            //since we may have some local changes (merges), try to set local as master and merge
            await syncAllBookmarks(url, username, password, true, false);
        } else if (message.action === 'Remote Update') {
            const {updateIndexes} = await browser.storage.local.get(['updateIndexes']);
            await applyLocalBookmarkUpdates(updateIndexes);
            const bookmarkTreeNodes = await browser.bookmarks.getTree()
            const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
            const response = await updateWebDAVBookmarks(url, username, password, localBookmarks);
            if (response === null) {
                await browser.storage.local.set({message: `Remote file not found: ${url}. Change URL or create an empty file.`});
            }
            await closeConfirmationWindow();
        } else if (message.action === 'Remote Update-merge') {
            const {updateIndexes} = await browser.storage.local.get(['updateIndexes']);
            await applyLocalBookmarkUpdates(updateIndexes);
            const {deletions} = await browser.storage.local.get(['deletions']);
            await modifyLocalBookmarks([], deletions); //those are the remote deletions, if we merge, we add them to our local bookmarks
            const bookmarkTreeNodes = await browser.bookmarks.getTree()
            const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
            const response = await updateWebDAVBookmarks(url, username, password, localBookmarks);
            if (response === null) {
                await browser.storage.local.set({message: `Remote file not found: ${url}. Change URL or create an empty file.`});
            }
            await closeConfirmationWindow();
            //since we may have some local changes (merges), try to set local as master and merge
            await syncAllBookmarks(url, username, password, true, false);
        } else if (message.action === 'cancelChanges') {
            await closeConfirmationWindow();
        } else if (message.command === "syncAllBookmarks") {
            try {
                await syncAllBookmarks(url, username, password, false, false);
                sendResponse({success: true});
            } catch (error) {
                sendResponse({success: false, error: error});
            }
        }
    } catch (error) {
        console.error("Error in updating", error);
    }
    return true; // Keep the message channel open for sendResponse
});

//ugly hack so that this function can be called from mocha
({calcBookmarkChanges});