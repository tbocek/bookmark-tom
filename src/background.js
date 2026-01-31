//************************** CONSTANTS **************************
const ACTIONS = {
  SYNC: "Sync",
  CONFLICT: "Conflict",
  CONFLICT_LOCAL: "Conflict-local",
  CONFLICT_REMOTE: "Conflict-remote",
  CANCEL: "cancelChanges",
};

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

// Create a unique key for bookmark identity (without index)
function bookmarkIdentityKey(bm) {
  return bm.title + "#" + bm.path.join("/") + "#" + (bm.url || "");
}

// Create a bookmark key for map lookups
function bookmarkKey(bm, includeIndex = true) {
  if (includeIndex) {
    return (
      bm.title + "#" + bm.index + "#" + bm.path.join("/") + "#" + (bm.url || "")
    );
  }
  return bm.title + "#" + bm.path.join("/") + "#" + (bm.url || "");
}

// 3-of-4 matching: returns true if at least 3 attributes match
function matchBookmarks3of4(a, b) {
  if (!a || !b) return false;

  const titleMatch = a.title === b.title;
  const pathMatch = arraysEqual(a.path || [], b.path || []);
  const urlMatch = (a.url || "") === (b.url || "");
  const indexMatch = a.index === b.index;

  const matchCount =
    (titleMatch ? 1 : 0) +
    (pathMatch ? 1 : 0) +
    (urlMatch ? 1 : 0) +
    (indexMatch ? 1 : 0);

  return matchCount >= 3;
}

// Format current time for sync messages
function formatSyncTime() {
  const options = {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  };
  return new Date().toLocaleDateString("de-DE", options);
}

// Find which attribute changed between two bookmarks
function findChangedAttribute(oldBm, newBm) {
  if (!oldBm || !newBm) return null;
  if (oldBm.title !== newBm.title) return "title";
  if (!arraysEqual(oldBm.path || [], newBm.path || [])) return "path";
  if ((oldBm.url || "") !== (newBm.url || "")) return "url";
  if (oldBm.index !== newBm.index) return "index";
  return null;
}

// Compare two bookmarks for equality
function bookmarksEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;

  return (
    a.title === b.title &&
    (a.url || "") === (b.url || "") &&
    a.index === b.index &&
    arraysEqual(a.path || [], b.path || [])
  );
}

//************************** TOMBSTONE HELPERS **************************
// Create a tombstone for a deleted bookmark
function createTombstone(bookmark) {
  return {
    title: bookmark.title,
    url: bookmark.url,
    path: bookmark.path,
    deleted: true,
    deletedAt: Date.now(),
  };
}

// Check if a bookmark matches a tombstone (by identity, not index)
function matchesTombstone(bookmark, tombstone) {
  return (
    bookmark.title === tombstone.title &&
    (bookmark.url || "") === (tombstone.url || "") &&
    arraysEqual(bookmark.path || [], tombstone.path || [])
  );
}

// Get active bookmarks (filter out tombstones)
function getActiveBookmarks(bookmarks) {
  return bookmarks.filter((b) => !b.deleted);
}

// Get tombstones from bookmark list
function getTombstones(bookmarks) {
  return bookmarks.filter((b) => b.deleted);
}

//************************** WEBDAV **************************
function createWebDAVHeaders(username, password, isWrite = false) {
  const headers = new Headers();
  headers.set("Authorization", "Basic " + btoa(username + ":" + password));
  headers.set("X-Extension-Request", "bookmark");
  if (isWrite) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function addCacheBuster(url) {
  const cacheBuster = `cb=${Date.now()}`;
  return url.includes("?") ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;
}

async function fetchWebDAV(url, username, password) {
  const headers = createWebDAVHeaders(username, password);

  try {
    const response = await fetch(addCacheBuster(url), {
      headers,
      credentials: "omit",
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.error("Error fetching from WebDAV:", error);
    return null;
  }
}

async function updateWebDAV(url, username, password, bookmarks) {
  const headers = createWebDAVHeaders(username, password, true);

  const response = await fetch(url, {
    method: "PUT",
    headers,
    credentials: "omit",
    body: JSON.stringify(bookmarks),
  });

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
      path: parentPathArray,
    };

    if (bookmark.url) {
      bookmarkData.url = bookmark.url;
    }

    results.push(bookmarkData);

    // If the bookmark has children, fetch and structure them recursively
    if (bookmark.children) {
      const isRoot = bookmark.title === "";
      const childrenPathArray = isRoot
        ? []
        : [...parentPathArray, bookmark.title];
      const childrenResults = await retrieveLocalBookmarks(
        bookmark.children,
        childrenPathArray,
      );
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
      console.error("Error searching by URL:", error);
      // Fallback to title search if URL search fails
      if (title) {
        searchResults = await browser.bookmarks.search({ title });
      } else {
        return null;
      }
    }
  } else if (title) {
    // If no URL is provided, search by title
    searchResults = await browser.bookmarks.search({ title });
  } else {
    throw new Error(`No bookmark found for ${url}/${title}`);
  }

  for (const bookmark of searchResults) {
    // Check additional criteria to ensure it's the correct bookmark
    if (
      bookmark.title === title &&
      (index === null || bookmark.index === index) &&
      (url === null || bookmark.url === url)
    ) {
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
        return aIsFolder ? 1 : -1; // Non-folders come first
      }
      // For items of same type, sort by path length descending
      return b.path.length - a.path.length;
    });

    // Delete bookmarks
    for (const delBookmark of sortedDeletions) {
      const id = await locateBookmarkId(
        delBookmark.url,
        delBookmark.title,
        null,
        delBookmark.path,
      );
      try {
        if (id) {
          await browser.bookmarks.remove(id);
        } else {
          console.warn("bookmark not found", delBookmark);
        }
      } catch (error) {
        console.error("Error deleting bookmark:", delBookmark, error);
      }
    }

    // Insert bookmarks
    for (const insBookmark of insBookmarks) {
      const id = await locateBookmarkId(
        insBookmark.url,
        insBookmark.title,
        null,
        insBookmark.path,
      );
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
          index: insBookmark.index,
        });
      }
    }
  } catch (error) {
    console.error("Error updating bookmarks:", error);
  }
}

async function applyLocalUpdates(updates) {
  try {
    for (const update of updates) {
      const { oldBookmark, newBookmark, changedAttribute } = update;

      // Find the bookmark using old values
      const id = await locateBookmarkId(
        oldBookmark.url,
        oldBookmark.title,
        oldBookmark.index,
        oldBookmark.path,
      );

      if (!id) {
        console.warn("Could not find bookmark to update:", oldBookmark);
        continue;
      }

      if (changedAttribute === "title" || changedAttribute === "url") {
        // Update title or URL
        await browser.bookmarks.update(id, {
          title: newBookmark.title,
          url: newBookmark.url,
        });
      } else if (changedAttribute === "index") {
        // Move to new index (same parent)
        await browser.bookmarks.move(id, { index: newBookmark.index });
      } else if (changedAttribute === "path") {
        // Move to new parent folder
        const newParentId = await locateParentId(newBookmark.path);
        if (newParentId) {
          await browser.bookmarks.move(id, {
            parentId: newParentId,
            index: newBookmark.index,
          });
        }
      }
    }
  } catch (error) {
    console.error("Error applying updates:", error);
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

//************************** LOCAL TOMBSTONE STORAGE **************************
async function getLocalTombstones() {
  const storage = await browser.storage.local.get(["tombstones"]);
  return storage.tombstones || [];
}

async function saveLocalTombstones(tombstones) {
  await browser.storage.local.set({ tombstones });
}

async function addLocalTombstone(bookmark) {
  const tombstones = await getLocalTombstones();
  // Check if tombstone already exists
  const exists = tombstones.some((t) => matchesTombstone(bookmark, t));
  if (!exists) {
    tombstones.push(createTombstone(bookmark));
    await saveLocalTombstones(tombstones);
  }
}

//************************** NOTIFICATION ************************
let previousTabId;
let confirmationTabId = null;

async function displayConfirmationPage(
  changes,
  action,
  localBookmarks,
  remoteBookmarks,
  conflicts = [],
) {
  const { localChanges, remoteChanges } = changes;

  // Store changes and context in the browser's local storage
  await browser.storage.local.set({
    localChanges: localChanges,
    remoteChanges: remoteChanges,
    action: action,
    localBookmarks: localBookmarks,
    remoteBookmarks: remoteBookmarks,
    conflicts: conflicts,
  });

  const confirmationPageUrl = browser.runtime.getURL(
    "confirmation/confirmation.html",
  );

  // Check if we already have a tracked confirmation tab
  if (confirmationTabId !== null) {
    try {
      const existingTab = await browser.tabs.get(confirmationTabId);
      if (existingTab && existingTab.url === confirmationPageUrl) {
        await browser.tabs.update(confirmationTabId, { active: true });
        await browser.tabs.reload(confirmationTabId);
        return;
      }
    } catch (e) {
      // Tab no longer exists, reset the ID
      confirmationTabId = null;
    }
  }

  // Fallback: Check if the confirmation page is open in any tab
  const tabs = await browser.tabs.query({ url: confirmationPageUrl });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await browser.tabs.update(tab.id, { active: true });
    await browser.tabs.reload(tab.id);
    confirmationTabId = tab.id;
    return;
  }

  const [currentTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (currentTab) {
    previousTabId = currentTab.id;
  }
  // Open a new tab with the confirmation page
  const newTab = await browser.tabs.create({
    url: confirmationPageUrl,
  });
  confirmationTabId = newTab.id;
}

async function closeConfirmationWindow() {
  if (confirmationTabId !== null) {
    try {
      await browser.tabs.remove(confirmationTabId);
    } catch (e) {
      // Tab already closed
    }
    confirmationTabId = null;
  }

  // Activate the previous tab
  if (previousTabId) {
    try {
      await browser.tabs.update(previousTabId, { active: true });
    } catch (e) {
      // Previous tab no longer exists
    }
  }

  // Clear stored data
  await browser.storage.local.remove([
    "localChanges",
    "remoteChanges",
    "action",
    "localBookmarks",
    "remoteBookmarks",
    "conflicts",
  ]);
  previousTabId = null;
}

//************************** SYNC LOGIC WITH TOMBSTONES **************************
// Find a 3-of-4 match for a bookmark in an array
function find3of4Match(bookmark, bookmarks) {
  for (const candidate of bookmarks) {
    if (matchBookmarks3of4(bookmark, candidate)) {
      return candidate;
    }
  }
  return null;
}

// Calculate changes between local and remote using tombstones
function calcTombstoneChanges(localBookmarks, remoteData, localTombstones) {
  const remoteBookmarks = getActiveBookmarks(remoteData);
  const remoteTombstones = getTombstones(remoteData);

  const localChanges = { insertions: [], deletions: [], updates: [] };
  const remoteChanges = { insertions: [], deletions: [], updates: [] };
  const conflicts = [];

  // Build maps for quick lookup by identity key
  const localMap = new Map();
  localBookmarks.forEach((b) => localMap.set(bookmarkIdentityKey(b), b));

  const remoteMap = new Map();
  remoteBookmarks.forEach((b) => remoteMap.set(bookmarkIdentityKey(b), b));

  const localTombstoneMap = new Map();
  localTombstones.forEach((t) =>
    localTombstoneMap.set(bookmarkIdentityKey(t), t),
  );

  const remoteTombstoneMap = new Map();
  remoteTombstones.forEach((t) =>
    remoteTombstoneMap.set(bookmarkIdentityKey(t), t),
  );

  // Track matched bookmarks to avoid double-processing
  const matchedLocalKeys = new Set();
  const matchedRemoteKeys = new Set();

  // Phase 1: Find exact matches and check for index-only updates
  for (const local of localBookmarks) {
    const key = bookmarkIdentityKey(local);
    const remote = remoteMap.get(key);
    const remoteTombstone = remoteTombstoneMap.get(key);

    if (remoteTombstone) {
      // Remote deleted this bookmark - delete locally
      localChanges.deletions.push(local);
      matchedLocalKeys.add(key);
    } else if (remote) {
      // Exact identity match - check for index-only updates
      matchedLocalKeys.add(key);
      matchedRemoteKeys.add(key);

      if (!bookmarksEqual(local, remote)) {
        const changedAttr = findChangedAttribute(local, remote);
        if (changedAttr === "index") {
          // Index changed - local wins (push to remote)
          remoteChanges.updates.push({
            oldBookmark: remote,
            newBookmark: local,
            changedAttribute: changedAttr,
          });
        }
      }
    }
  }

  // Phase 2: For unmatched local bookmarks, try 3-of-4 matching
  const unmatchedRemote = remoteBookmarks.filter(
    (b) => !matchedRemoteKeys.has(bookmarkIdentityKey(b)),
  );

  for (const local of localBookmarks) {
    const key = bookmarkIdentityKey(local);
    if (matchedLocalKeys.has(key)) continue;

    // Check for remote tombstone match
    const remoteTombstone = remoteTombstoneMap.get(key);
    if (remoteTombstone) {
      localChanges.deletions.push(local);
      matchedLocalKeys.add(key);
      continue;
    }

    // Try 3-of-4 matching with unmatched remote bookmarks
    const match3of4 = find3of4Match(local, unmatchedRemote);
    if (match3of4) {
      const remoteKey = bookmarkIdentityKey(match3of4);
      const changedAttr = findChangedAttribute(match3of4, local);

      // Local changed this bookmark - push update to remote
      remoteChanges.updates.push({
        oldBookmark: match3of4,
        newBookmark: local,
        changedAttribute: changedAttr,
      });

      matchedLocalKeys.add(key);
      matchedRemoteKeys.add(remoteKey);
      // Remove from unmatchedRemote to avoid re-matching
      const idx = unmatchedRemote.indexOf(match3of4);
      if (idx !== -1) unmatchedRemote.splice(idx, 1);
    } else {
      // No match - this is a new local bookmark to push to remote
      remoteChanges.insertions.push(local);
      matchedLocalKeys.add(key);
    }
  }

  // Phase 3: For unmatched remote bookmarks, try 3-of-4 matching with local
  const unmatchedLocal = localBookmarks.filter(
    (b) => !matchedLocalKeys.has(bookmarkIdentityKey(b)),
  );

  for (const remote of remoteBookmarks) {
    const key = bookmarkIdentityKey(remote);
    if (matchedRemoteKeys.has(key)) continue;

    // Check for local tombstone match
    const localTombstone = localTombstoneMap.get(key);
    if (localTombstone) {
      remoteChanges.deletions.push(remote);
      matchedRemoteKeys.add(key);
      continue;
    }

    // Try 3-of-4 matching with unmatched local bookmarks
    const match3of4 = find3of4Match(remote, unmatchedLocal);
    if (match3of4) {
      const localKey = bookmarkIdentityKey(match3of4);
      const changedAttr = findChangedAttribute(match3of4, remote);

      // Remote changed this bookmark - pull update to local
      localChanges.updates.push({
        oldBookmark: match3of4,
        newBookmark: remote,
        changedAttribute: changedAttr,
      });

      matchedRemoteKeys.add(key);
      matchedLocalKeys.add(localKey);
      // Remove from unmatchedLocal to avoid re-matching
      const idx = unmatchedLocal.indexOf(match3of4);
      if (idx !== -1) unmatchedLocal.splice(idx, 1);
    } else {
      // No match - this is a new remote bookmark to pull to local
      localChanges.insertions.push(remote);
      matchedRemoteKeys.add(key);
    }
  }

  return { localChanges, remoteChanges, conflicts };
}

// Main sync function
async function syncAllBookmarks(
  url,
  username,
  password,
  localMaster,
  fromBackgroundTimer,
) {
  const bookmarkTreeNodes = await browser.bookmarks.getTree();
  const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
  const localTombstones = await getLocalTombstones();

  let remoteData;
  try {
    remoteData = await fetchWebDAV(url, username, password);
  } catch (error) {
    console.error(error);
    await browser.storage.local.set({
      message: `Error fetching bookmarks: ${error}`,
    });
    return;
  }

  // If remote doesn't exist, push local bookmarks (no tombstones needed initially)
  if (remoteData === null) {
    await updateWebDAV(url, username, password, localBookmarks);
    await browser.storage.local.set({
      message: `Initial sync: ${formatSyncTime()}`,
    });
    return;
  }

  // Store when last synced
  await browser.storage.local.set({
    message: `Last sync: ${formatSyncTime()}`,
  });

  // Calculate changes using tombstones
  const { localChanges, remoteChanges, conflicts } = calcTombstoneChanges(
    localBookmarks,
    remoteData,
    localTombstones,
  );

  // Check if there are any changes
  const hasChanges =
    localChanges.insertions.length > 0 ||
    localChanges.deletions.length > 0 ||
    localChanges.updates.length > 0 ||
    remoteChanges.insertions.length > 0 ||
    remoteChanges.deletions.length > 0 ||
    remoteChanges.updates.length > 0 ||
    conflicts.length > 0;

  if (!hasChanges) {
    return;
  }

  // Helper function to show confirmation page
  const showConfirmation = async () => {
    if (conflicts.length > 0) {
      // Has conflicts - show conflict resolution UI
      await displayConfirmationPage(
        {
          localChanges: { insertions: [], deletions: [], updates: [] },
          remoteChanges: { insertions: [], deletions: [], updates: [] },
        },
        "Conflict",
        localBookmarks,
        remoteData,
        conflicts,
      );
    } else {
      await displayConfirmationPage(
        { localChanges, remoteChanges },
        "Sync",
        localBookmarks,
        remoteData,
        [],
      );
    }
  };

  if (fromBackgroundTimer) {
    // Store the confirmation function for the notification click handler
    pendingConfirmation = showConfirmation;
    browser.notifications.create("bookmark-sync", {
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/logo.svg"),
      title: "Incoming Bookmark Changes",
      message: "Open Sync Tab?",
      priority: 2,
    });
  } else {
    await showConfirmation();
  }
}

// Store pending confirmation for notification click handler
let pendingConfirmation = null;

// Register notification click handler once
browser.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId === "bookmark-sync" && pendingConfirmation) {
    try {
      await pendingConfirmation();
      pendingConfirmation = null;
      browser.notifications.clear(notificationId);
    } catch (e) {
      console.error(e);
    }
  }
});

async function loadConfig() {
  const config = await browser.storage.sync.get([
    "webdavUrl",
    "webdavUsername",
    "webdavPassword",
    "checkIntervalMinutes",
  ]);
  const url = config.webdavUrl;
  const username = config.webdavUsername;
  const password = config.webdavPassword;
  const checkIntervalMinutes = config.checkIntervalMinutes;

  if (!url) {
    await browser.storage.local.set({ message: `URL not set!` });
    throw new Error("URL not set!");
  }
  if (!username) {
    await browser.storage.local.set({ message: `username not set!` });
    throw new Error("username not set!");
  }
  if (!password) {
    await browser.storage.local.set({ message: `password not set!` });
    throw new Error("password not set!");
  }

  let checkInterval = parseInt(checkIntervalMinutes);
  if (isNaN(checkInterval)) {
    await browser.storage.local.set({
      message: `invalid check interval. Please enter a number.`,
    });
    throw new Error("invalid check interval. Please enter a number.");
  }

  return { url, username, password, checkInterval };
}

(async () => {
  try {
    const { url, username, password, checkInterval } = await loadConfig();
    await syncAllBookmarks(url, username, password, false, true);
    setInterval(
      async () => {
        await syncAllBookmarks(url, username, password, false, true);
      },
      checkInterval * 60 * 1000,
    );
  } catch (error) {
    await browser.storage.local.set({ message: error });
  }
})();

let debounceTimer;

async function debounceBookmarkSync(localMaster) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const { url, username, password } = await loadConfig();

  debounceTimer = setTimeout(async () => {
    await syncAllBookmarks(url, username, password, localMaster, false);
  }, 1000);
}

// Listen for user changes to bookmarks
browser.bookmarks.onChanged.addListener(async () => {
  await debounceBookmarkSync(true);
});
browser.bookmarks.onCreated.addListener(async () => {
  await debounceBookmarkSync(true);
});
browser.bookmarks.onMoved.addListener(async () => {
  await debounceBookmarkSync(true);
});
browser.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  // Add tombstone for deleted bookmark
  const bookmark = {
    title: removeInfo.node.title,
    url: removeInfo.node.url,
    path: [], // We'll need to track the path - for now simplified
  };
  // Get parent path
  if (removeInfo.parentId) {
    try {
      let currentId = removeInfo.parentId;
      const path = [];
      while (currentId) {
        const [node] = await browser.bookmarks.get(currentId);
        if (node.title) {
          path.unshift(node.title);
        }
        currentId = node.parentId;
      }
      bookmark.path = path;
    } catch (e) {
      // Parent might not exist anymore
    }
  }
  await addLocalTombstone(bookmark);
  await debounceBookmarkSync(true);
});

// Reset confirmationTabId when the tab is manually closed
browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === confirmationTabId) {
    confirmationTabId = null;
  }
});

//************************** MESSAGE HANDLERS **************************
async function getLocalBookmarksSnapshot() {
  const bookmarkTreeNodes = await browser.bookmarks.getTree();
  return retrieveLocalBookmarks(bookmarkTreeNodes);
}

async function handleSync(config) {
  const { localChanges, remoteBookmarks } = await browser.storage.local.get([
    "localChanges",
    "remoteBookmarks",
  ]);

  // Apply remote changes to local
  if (localChanges) {
    await modifyLocalBookmarks(localChanges.deletions, localChanges.insertions);
    await applyLocalUpdates(localChanges.updates || []);
  }

  // Get final local state
  const finalBookmarks = await getLocalBookmarksSnapshot();

  // Get current remote tombstones and local tombstones
  const remoteData = remoteBookmarks || [];
  const remoteTombstones = getTombstones(remoteData);
  const localTombstones = await getLocalTombstones();

  // Merge tombstones (combine local and remote, cleanup old ones)
  const allTombstones = [...remoteTombstones];
  for (const lt of localTombstones) {
    const exists = allTombstones.some((t) => matchesTombstone(lt, t));
    if (!exists) {
      allTombstones.push(lt);
    }
  }

  // Create new remote data: active bookmarks + tombstones
  const newRemoteData = [...finalBookmarks, ...allTombstones];

  // Update remote
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    newRemoteData,
  );

  // Save merged tombstones locally
  await saveLocalTombstones(allTombstones);

  await closeConfirmationWindow();
}

async function handleConflictLocal(config) {
  const localBookmarks = await getLocalBookmarksSnapshot();
  const localTombstones = await getLocalTombstones();

  // Push local state + tombstones to remote
  const newRemoteData = [...localBookmarks, ...localTombstones];
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    newRemoteData,
  );

  await closeConfirmationWindow();
}

async function handleConflictRemote(config) {
  const { remoteBookmarks } = await browser.storage.local.get([
    "remoteBookmarks",
  ]);
  const localBookmarks = await getLocalBookmarksSnapshot();

  const remoteActive = getActiveBookmarks(remoteBookmarks || []);
  const remoteTombstones = getTombstones(remoteBookmarks || []);

  // Build maps
  const localMap = new Map();
  localBookmarks.forEach((b) => localMap.set(bookmarkIdentityKey(b), b));

  const remoteMap = new Map();
  remoteActive.forEach((b) => remoteMap.set(bookmarkIdentityKey(b), b));

  // Calculate what to delete and insert locally
  const toDelete = [];
  const toInsert = [];

  // Delete local bookmarks not in remote
  for (const local of localBookmarks) {
    const key = bookmarkIdentityKey(local);
    if (!remoteMap.has(key)) {
      toDelete.push(local);
    }
  }

  // Insert remote bookmarks not in local
  for (const remote of remoteActive) {
    const key = bookmarkIdentityKey(remote);
    if (!localMap.has(key)) {
      toInsert.push(remote);
    }
  }

  await modifyLocalBookmarks(toDelete, toInsert);

  // Clear local tombstones (we accepted remote)
  await saveLocalTombstones(remoteTombstones);

  await closeConfirmationWindow();
}

async function handleSyncAllBookmarks(config, sendResponse) {
  try {
    await syncAllBookmarks(
      config.url,
      config.username,
      config.password,
      false,
      false,
    );
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error });
  }
}

const messageHandlers = {
  [ACTIONS.SYNC]: handleSync,
  [ACTIONS.CONFLICT_LOCAL]: handleConflictLocal,
  [ACTIONS.CONFLICT_REMOTE]: handleConflictRemote,
  [ACTIONS.CANCEL]: async () => closeConfirmationWindow(),
};

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    const config = await loadConfig();

    if (message.action && messageHandlers[message.action]) {
      await messageHandlers[message.action](config);
    } else if (message.command === "syncAllBookmarks") {
      await handleSyncAllBookmarks(config, sendResponse);
    }
  } catch (error) {
    console.error("Error in message handler:", error);
  }
  return true;
});

// Export for mocha tests
({
  calcTombstoneChanges,
  bookmarksEqual,
  matchBookmarks3of4,
  findChangedAttribute,
  createTombstone,
  matchesTombstone,
  getActiveBookmarks,
  getTombstones,
  bookmarkIdentityKey,
  find3of4Match,
});
