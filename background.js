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

(async () => {
    const config = await browser.storage.sync.get(['webdavUrl']);
    const url = config.webdavUrl;
    // Add listener to modify request headers
    browser.webRequest.onBeforeSendHeaders.addListener(
        addAuthHeader,
        { urls: [url] },
        ["blocking", "requestHeaders"]
    );
})();

//************************** WEBDAV **************************
async function fetchBookmarksFromWebDAV(url, username, password) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));
    headers.set('X-Extension-Request', 'bookmark');

    try {
        const response = await fetch(url, { headers: headers });
        if(response.status === 404) { //its empty on the remote site
            return [];
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
        body: JSON.stringify(bookmarks)
    });

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
}
//************************** LOCAL BOOKMARKS **************************
// Function to recursively fetch and structure bookmarks
function fetchBookmarksLocal(bookmarks, parentPath = "") {
    let results = [];

    bookmarks.forEach(bookmark => {
        if (bookmark.url) {
            results.push({
                title: bookmark.title,
                url: bookmark.url,
                id: bookmark.id,
                path: parentPath
            });
        }

        // If the bookmark has children, fetch and structure them recursively
        if (bookmark.children) {
            const isRoot = bookmark.title === ""
            results = results.concat(fetchBookmarksLocal(bookmark.children, isRoot ? "":`${parentPath}/${bookmark.title}`));
        }
    });

    return results;
}

// Function to update local bookmarks
async function updateLocalBookmarks(bookmarks) {
    const localBookmarkTree = await browser.bookmarks.getTree();
    const localBookmarks = fetchBookmarksLocal(localBookmarkTree);
    const existingMapUrl = new Map(localBookmarks.map(b => [b.url + b.path, b]));
    const existingMapTitle = new Map(localBookmarks.map(b => [b.title + b.path, b]));
    const existingMapOnlyUrl = new Map(localBookmarks.map(b => [b.url, b]));

    isUpdatingBookmarks = false;
    try {
        for (const bookmark of bookmarks) {
            const existingBookmarkUrl = existingMapUrl.get(bookmark.url + bookmark.path);
            const existingBookmarkTitle = existingMapTitle.get(bookmark.title + bookmark.path);
            const existingBookmarkUrlOnly = existingMapOnlyUrl.get(bookmark.url);
            const path = bookmark.path.split('/').slice(1).join('/'); // Remove leading slash

            //title changed but not URL
            if (existingBookmarkUrl) {
                if (existingBookmarkUrl.title !== bookmark.title) {
                    await browser.bookmarks.update(existingBookmarkUrl.id, {title: bookmark.title});
                }
            } else if (existingBookmarkTitle) {
                if (existingBookmarkTitle.url !== bookmark.url) {
                    await browser.bookmarks.update(existingBookmarkTitle.id, {url: bookmark.url});
                }
            } else {
                if (existingBookmarkUrlOnly) {
                    await browser.bookmarks.remove(existingBookmarkUrlOnly.id);
                }
                const parentId = await createFolders(path);
                await browser.bookmarks.create({title: bookmark.title, url: bookmark.url, parentId: parentId});
            }
        }
    } finally {
        isUpdatingBookmarks = true;
    }
}

// Function to create folders if they don't exist
async function createFolders(path) {
    const parts = path.split('/').filter(Boolean);;
    let currentFolderId = 'toolbar_____';  // Assuming the root is the bookmarks toolbar

    for (const part of parts) {

        if (part === "Bookmarks Toolbar" || part === "Bookmarks Menu") {
            // Set the current folder ID to the respective root ID
            if (part === "Bookmarks Toolbar") {
                currentFolderId = 'toolbar_____'; // ID for Bookmarks Toolbar
            } else if (part === "Bookmarks Menu") {
                currentFolderId = 'menu________'; // ID for Bookmarks Menu
            }
            continue; // Skip to the next part
        }

        const existingFolders = await browser.bookmarks.getChildren(currentFolderId);
        let folder = existingFolders.find(item => item.title === part && !item.url);
        if (!folder) {
            console.log("create folder", currentFolderId, part)
            folder = await browser.bookmarks.create({ title: part, parentId: currentFolderId });
        }
        currentFolderId = folder.id;
    }
    return currentFolderId;
}

//************************** MAIN LOGIC **************************
// Function to get all bookmarks and store them in local storage
function syncAllBookmarks(localMaster) {
    browser.bookmarks.getTree().then(async bookmarkTreeNodes => {

        const config = await browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword']);
        const url = config.webdavUrl;
        const username = config.webdavUsername;
        const password = config.webdavPassword;

        const localBookmarks = fetchBookmarksLocal(bookmarkTreeNodes);
        const remoteBookmarks = await fetchBookmarksFromWebDAV(url,username,password);

        console.log(localBookmarks);

        //throw new Error("aoeuaoeuaoeu")

        if(!bookmarksChanged(remoteBookmarks, localBookmarks)) {
            console.log("not changed");
            return;
        }

        let mergedBookmarks
        if(localMaster) {
            mergedBookmarks = mergeBookmarks(localBookmarks, remoteBookmarks);
        } else {
            mergedBookmarks = mergeBookmarks(remoteBookmarks, localBookmarks);
        }


        //remote changed upload to WebDav
        let await1, await2;
        if(bookmarksChanged(remoteBookmarks, mergedBookmarks)) {
            console.log("dav changed");
            await1 = updateWebDAVFile(url, username, password, mergedBookmarks);
        }

        if(bookmarksChanged(localBookmarks, mergedBookmarks)) {
            console.log("local changed");
            await2 = updateLocalBookmarks(mergedBookmarks);
        }

        if(await1) {
            await await1;
        }
        if(await2) {
            await await2;
        }

    });
}

// Function to merge bookmarks while preserving order
function mergeBookmarks(oldBookmarks, mainBookmarks) {
    const localMap = new Map(oldBookmarks.map(b => [b.url + b.path, b]));

    const mergedBookmarks = mainBookmarks.map(remoteBookmark => {
        const localBookmark = localMap.get(remoteBookmark.url + remoteBookmark.path);
        return localBookmark ? { ...localBookmark, ...remoteBookmark } : remoteBookmark;
    });

    const mergedSet = new Set(mergedBookmarks.map(b => b.url + b.path));

    oldBookmarks.forEach(localBookmark => {
        if (!mergedSet.has(localBookmark.url + localBookmark.path)) {
            mergedBookmarks.push(localBookmark);
        }
    });

    return mergedBookmarks;
}

// Function to compare bookmarks
function bookmarksChanged(mainBookmarks, oldBookmarks) {

    if (mainBookmarks.length !== oldBookmarks.length) {
        console.log("length change")
        return true;
    }

    const localMap = new Map(oldBookmarks.map(b => [b.url + b.path, b]));

    for (const remoteBookmark of mainBookmarks) {
        const localBookmark = localMap.get(remoteBookmark.url + remoteBookmark.path);
        if (!localBookmark) {
            console.log("string change1")
            return true;
        }
        if (JSON.stringify(remoteBookmark) !== JSON.stringify(localBookmark)) {

            console.log(remoteBookmark)
            console.log(localBookmark)

            console.log("string change2")
            return true;
        }
    }

    console.log("nope change")
    return false;
}


syncAllBookmarks(false); //sync on startup
setInterval(() => {
    syncAllBookmarks(false); //sync every x minutes
}, 600000);

let isUpdatingBookmarks = true;
// Listen for user changes to bookmarks
browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
    if (isUpdatingBookmarks) {
        console.log("updatingBookmarks");
        syncAllBookmarks(true);
    }
});
browser.bookmarks.onCreated.addListener(async (id, changeInfo) => {
    if (isUpdatingBookmarks) {
        console.log("onCreated");
        syncAllBookmarks(true);
    }
});
browser.bookmarks.onMoved.addListener(async (id, changeInfo) => {
    if (isUpdatingBookmarks) {
        console.log("onMoved");
        syncAllBookmarks(true);
    }
});
browser.bookmarks.onRemoved.addListener(async (id, changeInfo) => {
    if (isUpdatingBookmarks) {
        console.log("onRemoved");
        syncAllBookmarks(true);
    }
});

// Listen for messages to trigger the syncAllBookmarks function
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === "syncAllBookmarks") {
        try {
            syncAllBookmarks(false).then(() => {
                sendResponse({success: true});
            });
        } catch (error) {
            sendResponse({success: false, error: error});
        }
        return true;  // Keep the message channel open for sendResponse
    }
});