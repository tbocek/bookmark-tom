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
async function fetchBookmarksFromWebDAV(url, username, password) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));
    headers.set('X-Extension-Request', 'bookmark');

    const response = await fetch(url, {
        headers: headers,
        credentials: 'omit',
    });
    if (response.status === 404) { //its empty on the remote site
        return null;
    }

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
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
async function fetchBookmarksLocal(bookmarks, parentPathArray = []) {
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
            const childrenResults = await fetchBookmarksLocal(bookmark.children, childrenPathArray);
            results = results.concat(childrenResults);
        }
    }

    return results;
}

async function findBookmarkId(url, title, index, pathArray) {
    let searchResults;

    // If a URL is provided, search by URL
    if (url) {
        searchResults = await browser.bookmarks.search({ url });
    } else if(title) {
        // If no URL is provided, search by title
        searchResults = await browser.bookmarks.search({ title });
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

//Find the Id of the bookmark folder specified in pathArray
async function findBookmarkFolder(pathArray) {
    const bookmarkTree = await browser.bookmarks.getTree();

    function searchTree(nodes, pathParts) {
        if (pathParts.length === 0) {
            return null;
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

async function updateLocalBookmarksInsDel(delBookmarks, insBookmarks) {
    try {
        // Delete bookmarks
        for (let i = delBookmarks.length - 1; i >= 0; i--) {
            const delBookmark = delBookmarks[i];
            const id = await findBookmarkId(delBookmark.url, delBookmark.title, null, delBookmark.path);
            if (id) {
                await browser.bookmarks.remove(id);
            }
        }
        // Insert bookmarks
        for (const insBookmark of insBookmarks) {
            const parentId = await findBookmarkFolder(insBookmark.path);
            if (parentId) {
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
async function updateLocalBookmarksUpdate(upBookmarksUrls, upBookmarksTitles, upBookmarksIndexes) {
    try {
        // Update Bookmarks
        for (const upBookmarksUrl of upBookmarksUrls) {
            const id = await findBookmarkId(upBookmarksUrl.oldUrl, upBookmarksUrl.title, null, upBookmarksUrl.path);
            if (id) {
                await browser.bookmarks.update(id, {url: upBookmarksUrl.url});
            }
        }
        for (const upBookmarksTitle of upBookmarksTitles) {
            const id = await findBookmarkId(upBookmarksTitle.url, upBookmarksTitle.oldTitle, null, upBookmarksTitle.path);
            if (id) {
                await browser.bookmarks.update(id, {title: upBookmarksTitle.title});
            }
        }
        for (const upBookmarksIndex of upBookmarksIndexes) {
            const id = await findBookmarkId(upBookmarksIndex.url, upBookmarksIndex.title, upBookmarksIndex.oldIndex, upBookmarksIndex.path);
            if (id) {
                await browser.bookmarks.move(id, {index: upBookmarksIndex.index});
            }
        }
    } catch (error) {
        console.error('Error updating bookmarks:', error);
    }
}

//************************** NOTIFICATION ************************
let previousTabId;
let confirmationTabId = null;
async function openConfirmationPage(changes, action, localBookmarks, remoteBookmarks) {
    const { insertions, deletions, updateUrls, updateTitles, updateIndexes } = changes;

    // Store changes and context in the browser's local storage
    browser.storage.local.set({
        insertions: insertions,
        deletions: deletions,
        updateUrls: updateUrls,
        updateTitles: updateTitles,
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
            await browser.tabs.update(tab.id, { active: true });
            await browser.tabs.reload(tab.id); // Refresh the tab
            confirmationTabId = tab.id;
            return;
        }
    }

    const [currentTab] = await browser.tabs.query({ active: true, currentWindow: true });
    previousTabId = currentTab.id;
    // Open a new tab with the confirmation page
    const newTab = await browser.tabs.create({ url: browser.runtime.getURL('confirmation/confirmation.html') });
    confirmationTabId = newTab.id;
}

async function closeWindow() {
    const [confirmationTab] = await browser.tabs.query({ url: browser.runtime.getURL('confirmation/confirmation.html') });
    if (confirmationTab) {
        await browser.tabs.remove(confirmationTab.id);
    }

    // Activate the previous tab
    if (previousTabId) {
        await browser.tabs.update(previousTabId, { active: true });
    }

    // Clear stored data
    await browser.storage.local.remove(['insertions', 'deletions', 'updateUrls', 'updateTitles', 'updateIndexes', 'action', 'localBookmarks', 'remoteBookmarks']);
    previousTabId = null;
}

//************************** MAIN LOGIC **************************
// Function to get all bookmarks and store them in local storage
async function syncAllBookmarks(url, username, password, localMaster, fromBackgroundTimer) {
    const bookmarkTreeNodes = await browser.bookmarks.getTree()
    const localBookmarks = await fetchBookmarksLocal(bookmarkTreeNodes);
    let remoteBookmarks;
    try {
        remoteBookmarks = await fetchBookmarksFromWebDAV(url,username,password);
    } catch (error) {
        await browser.storage.local.set({ message: `Error fetching bookmarks: ${error}`});
        throw error
    }

    // Store when last synced
    const options = { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
    const currentTime = new Date().toLocaleDateString('de-DE', options)
    await browser.storage.local.set({ message: `Last sync: ${currentTime}`});

    if(!bookmarksChanged(remoteBookmarks, localBookmarks)) {
        return;
    }

    if(fromBackgroundTimer) {
        browser.notifications.create({
            "type": "basic",
            "iconUrl": browser.runtime.getURL("icons/logo.svg"),
            "title": "Incoming Bookmark Changes",
            "message": "Open Sync Tab?",
            "priority": 2
        });

        browser.notifications.onClicked.addListener(async (notificationId) => {
            // OK button clicked
            if(localMaster || !remoteBookmarks) {
                const changes = getBookmarkChanges(localBookmarks, remoteBookmarks?remoteBookmarks:[]);
                await openConfirmationPage(changes, 'Remote Update', localBookmarks, remoteBookmarks?remoteBookmarks:[]);
            } else {
                const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);
                await openConfirmationPage(changes, 'Local Update', localBookmarks, remoteBookmarks);
            }
            browser.notifications.clear(notificationId);
        });
    } else if(localMaster || !remoteBookmarks) {
        const changes = getBookmarkChanges(localBookmarks, remoteBookmarks?remoteBookmarks:[]);
        await openConfirmationPage(changes, 'Remote Update', localBookmarks, remoteBookmarks?remoteBookmarks:[]);
    } else {
        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);
        await openConfirmationPage(changes, 'Local Update', localBookmarks, remoteBookmarks);
    }
}

function getBookmarkChanges(otherBookmarks, myBookmarks) {
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

    const updateUrls = [];
    const updateTitles = [];
    const updateIndexes = [];
    const updatePaths = [];

    // Create a map from delBookmarks for quick lookup
    const mapUrl = new Map();
    const mapTitle = new Map();
    const mapPath = new Map();
    const mapIndex = new Map();

    const mapTitleFolder = new Map();
    const mapPathFolder = new Map();
    const mapIndexFolder = new Map();

    deletions.forEach(bookmark => {

        if(bookmark.url) {
            //here we have a regular entry
            //we have: title, index, path, url
            const keyUpdateUrl = bookmark.title + '#' + bookmark.index + '#' + bookmark.path.join('/');
            const keyUpdateTitle = bookmark.index + '#' + bookmark.path.join('/') + '#' + bookmark.url;
            const keyUpdatePath = bookmark.title + '#' + bookmark.index + '#' +  bookmark.url;
            const keyUpdateIndex = bookmark.title + '#' + bookmark.path.join('/') + '#' + bookmark.url;

            mapUrl.set(keyUpdateUrl, bookmark);
            mapTitle.set(keyUpdateTitle, bookmark);
            mapPath.set(keyUpdatePath, bookmark);
            mapIndex.set(keyUpdateIndex, bookmark);
        } else {
            //here we have a folder entry
            //we have: title, index, path
            const keyUpdateTitle = bookmark.index + '#' + bookmark.path.join('/');
            const keyUpdatePath = bookmark.title + '#' + bookmark.index;
            const keyUpdateIndex = bookmark.title + '#' + bookmark.path.join('/');

            mapTitleFolder.set(keyUpdateTitle, bookmark);
            mapPathFolder.set(keyUpdatePath, bookmark);
            mapIndexFolder.set(keyUpdateIndex, bookmark);
        }
    });

    // Iterate over insBookmarks to find matching entries in delBookmarks with different indexes
    for (let i = insertions.length - 1; i >= 0; i--) {
        const insBookmark = insertions[i];
        if(insBookmark.url) {
            //here we have a regular entry
            //we have: title, index, path, url
            const keyUpdateUrl = insBookmark.title + '#' + insBookmark.index + '#' + insBookmark.path.join('/');
            const keyUpdateTitle = insBookmark.index + '#' + insBookmark.path.join('/') + '#' + insBookmark.url;
            const keyUpdatePath = insBookmark.title + '#' + insBookmark.index + '#' +  insBookmark.url;
            const keyUpdateIndex = insBookmark.title + '#' + insBookmark.path.join('/') + '#' + insBookmark.url;

            if (mapUrl.has(keyUpdateUrl)) {
                const delBookmark = mapUrl.get(keyUpdateUrl);
                if (delBookmark) {
                    updateUrls.push({...insBookmark, oldUrl: delBookmark.url});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            } else if (mapTitle.has(keyUpdateTitle)) {
                const delBookmark = mapTitle.get(keyUpdateTitle);
                if (delBookmark) {
                    updateTitles.push({...insBookmark, oldTitle: delBookmark.title});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            } else if (mapPath.has(keyUpdatePath)) {
                const delBookmark = mapPath.get(keyUpdatePath);
                if (delBookmark) {
                    updatePaths.push({...insBookmark, oldPath: delBookmark.path});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            } else if (mapIndex.has(keyUpdateIndex)) {
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
            const keyUpdateTitle = insBookmark.index + '#' + insBookmark.path.join('/');
            const keyUpdatePath = insBookmark.title + '#' + insBookmark.index;
            const keyUpdateIndex = insBookmark.title + '#' + insBookmark.path.join('/');

            if (mapTitleFolder.has(keyUpdateTitle)) {
                const delBookmark = mapTitleFolder.get(keyUpdateTitle);
                if (delBookmark) {
                    updateTitles.push({...insBookmark, oldTitle: delBookmark.title});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            } else if (mapPathFolder.has(keyUpdatePath)) {
                const delBookmark = mapPathFolder.get(keyUpdatePath);
                if (delBookmark) {
                    updatePaths.push({...insBookmark, oldPath: delBookmark.path});
                    // Remove the entries from both delBookmarks and insBookmarks
                    deletions.splice(deletions.indexOf(delBookmark), 1);
                    insertions.splice(i, 1);
                }
            } else if (mapIndexFolder.has(keyUpdateIndex)) {
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

    return {insertions, deletions, updateUrls, updateTitles, updateIndexes, updatePaths};
}

// Function to compare bookmarks
function bookmarksChanged(mainBookmarks, oldBookmarks) {
    if(mainBookmarks === null && oldBookmarks.length > 0) {
        return true;
    }
    if (mainBookmarks.length !== oldBookmarks.length) {
        return true;
    }

    const localMap = new Map(oldBookmarks.map(b => [b.url + b.path + b.title + b.index, b]));

    for (const remoteBookmark of mainBookmarks) {
        const localBookmark = localMap.get(remoteBookmark.url + remoteBookmark.path + remoteBookmark.title + remoteBookmark.index);
        if (!localBookmark) {
            return true;
        }
        if (JSON.stringify(remoteBookmark) !== JSON.stringify(localBookmark)) {
            return true;
        }
    }
    return false;
}

async function readConfig()  {
    const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword', 'checkIntervalMinutes']);
    const url = config.webdavUrl;
    const username = config.webdavUsername;
    const password = config.webdavPassword;
    const checkIntervalMinutes = config.checkIntervalMinutes;

    if(!url) {
        await browser.storage.local.set({ message: `URL not set!`});
        throw new Error("URL not set!");
    }
    if(!username) {
        await browser.storage.local.set({ message: `username not set!`});
        throw new Error("username not set!");
    }
    if(!password) {
        await browser.storage.local.set({ message: `password not set!`});
        throw new Error("password not set!");
    }

    let checkInterval = parseInt(checkIntervalMinutes);
    if (isNaN(checkInterval)) {
        await browser.storage.local.set({ message: `invalid check interval. Please enter a number.`});
        throw new Error("invalid check interval. Please enter a number.");
    }

    return {url, username, password, checkInterval}
}

(async () => {
    try {
        const {url, username, password, checkInterval} = await readConfig();
        await syncAllBookmarks(url, username, password, false, true); //sync on startup
        setInterval(async () => {
            await syncAllBookmarks(url, username, password, false, true); //sync every x minutes
        }, checkInterval * 60 * 1000);
    } catch (error) {
        await browser.storage.local.set({ message: error});
    }
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

    const {url, username, password} = await readConfig();

    debounceTimer = setTimeout(async () => {
        await syncAllBookmarks(url, username, password, localMaster, false);
        isLocalDelete = false;
    }, 1000);
}

// Listen for user changes to bookmarks
browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    await debounceSync(true, false);
});
browser.bookmarks.onCreated.addListener(async (id, changeInfo) => {
    await debounceSync(true,false);
});
browser.bookmarks.onMoved.addListener(async (id, changeInfo) => {
    await debounceSync(true,true);
});
browser.bookmarks.onRemoved.addListener(async (id, changeInfo) => {
    await debounceSync(true,true);
});

// Listen for messages to trigger the syncAllBookmarks function
browser.runtime.onMessage.addListener( async(message, sender, sendResponse) => {
    try {
        if (message.action === 'Local Update') {
            const {insertions, deletions, remoteBookmarks} = await browser.storage.local.get(['insertions', 'deletions', 'remoteBookmarks']);
            await updateLocalBookmarksInsDel(deletions, insertions);
            //Now we need to rescan, as indexes may have shifted
            const bookmarkTreeNodes = await browser.bookmarks.getTree()
            const localBookmarks = await fetchBookmarksLocal(bookmarkTreeNodes);
            const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);
            await updateLocalBookmarksUpdate(changes.updateUrls, changes.updateTitles, changes.updateIndexes);
            await closeWindow();
        } else if (message.action === 'Local Update-merge') {
            const {insertions, remoteBookmarks} = await browser.storage.local.get(['insertions', 'remoteBookmarks']);
            await updateLocalBookmarksInsDel([], insertions);
            //Now we need to rescan, as indexes may have shifted
            const bookmarkTreeNodes = await browser.bookmarks.getTree()
            const localBookmarks = await fetchBookmarksLocal(bookmarkTreeNodes);
            const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);
            await updateLocalBookmarksUpdate(changes.updateUrls, changes.updateTitles, changes.updateIndexes);
            await closeWindow();
        }
        else if (message.action === 'Remote Update') {
            const {localBookmarks} = await browser.storage.local.get(['localBookmarks']);
            const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword']);
            const url = config.webdavUrl;
            const username = config.webdavUsername;
            const password = config.webdavPassword;
            await updateWebDAVFile(url, username, password, localBookmarks);
            await closeWindow();
        } else if (message.action === 'cancelChanges') {
            await closeWindow();
        } else if (message.command === "syncAllBookmarks") {
            try {
                const {url, username, password} = await readConfig();
                await syncAllBookmarks(url, username, password, false, false);
                sendResponse({success: true});
            } catch (error) {
                sendResponse({success: false, error: error});
            }
            return true;  // Keep the message channel open for sendResponse
        }

    } catch (error) {
        console.error("Error in updating", error);
    }
});

export {
    getBookmarkChanges
};
