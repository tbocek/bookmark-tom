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

function getOldFileUrl(url) {
  return url.replace(/\.json$/, ".json.old");
}

async function fetchWebDAV(url, username, password, isOldFile = false) {
  const targetUrl = isOldFile ? getOldFileUrl(url) : url;
  const headers = createWebDAVHeaders(username, password);

  try {
    const response = await fetch(addCacheBuster(targetUrl), {
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
    if (isOldFile) {
      console.warn("Could not fetch .old file:", error);
    }
    return null;
  }
}

async function updateWebDAV(
  url,
  username,
  password,
  bookmarks,
  isOldFile = false,
) {
  const targetUrl = isOldFile ? getOldFileUrl(url) : url;
  const headers = createWebDAVHeaders(username, password, true);

  const response = await fetch(targetUrl, {
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

async function applyLocalBookmarkUpdates(upBookmarksIndexes) {
  try {
    // Sort updates by path length to handle parent folders first
    const sortedUpdates = [...upBookmarksIndexes].sort(
      (a, b) => a.path.length - b.path.length,
    );

    for (const bookmark of sortedUpdates) {
      const id = await locateBookmarkId(
        bookmark.url,
        bookmark.title,
        bookmark.oldIndex,
        bookmark.path,
      );

      if (id) {
        const index =
          bookmark.index === -1 ? bookmark.oldIndex : bookmark.index;

        await browser.bookmarks.move(id, { index });
      }
    }
  } catch (error) {
    console.error("Error updating bookmark indexes:", error);
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

async function displayConfirmationPage(
  changes,
  action,
  localBookmarks,
  remoteBookmarks,
  oldBookmarks = null,
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
    oldBookmarks: oldBookmarks,
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
    "oldBookmarks",
    "conflicts",
  ]);
  previousTabId = null;
}

//************************** MAIN LOGIC **************************
// Function to get all bookmarks and store them in local storage
async function syncAllBookmarks(
  url,
  username,
  password,
  localMaster,
  fromBackgroundTimer,
) {
  const bookmarkTreeNodes = await browser.bookmarks.getTree();
  const localBookmarks = await retrieveLocalBookmarks(bookmarkTreeNodes);
  let remoteBookmarks;
  let oldBookmarks;
  try {
    remoteBookmarks = await fetchWebDAV(url, username, password, false);
    oldBookmarks = await fetchWebDAV(url, username, password, true);
  } catch (error) {
    console.error(error);
    await browser.storage.local.set({
      message: `Error fetching bookmarks: ${error}`,
    });
    return;
  }

  // If neither remote file exists, push local bookmarks to both and return
  if (remoteBookmarks === null && oldBookmarks === null) {
    await updateWebDAV(url, username, password, localBookmarks, false);
    await updateWebDAV(url, username, password, localBookmarks, true);
    await browser.storage.local.set({
      message: `Initial sync: ${formatSyncTime()}`,
    });
    return;
  }

  // If only .old file is missing, create it from current remote
  if (oldBookmarks === null && remoteBookmarks !== null) {
    await updateWebDAV(url, username, password, remoteBookmarks, true);
    oldBookmarks = remoteBookmarks;
  }

  // Store when last synced
  await browser.storage.local.set({
    message: `Last sync: ${formatSyncTime()}`,
  });

  // Use three-way merge if oldBookmarks exists
  const threeWayResult = calcThreeWayChanges(
    localBookmarks,
    remoteBookmarks ? remoteBookmarks : [],
    oldBookmarks,
  );

  // Check if there are any changes or conflicts
  const hasChanges =
    threeWayResult.pullFromRemote.length > 0 ||
    threeWayResult.pushToRemote.length > 0 ||
    threeWayResult.conflicts.length > 0;

  if (!hasChanges) {
    return;
  }

  // Helper function to show confirmation page with three-way data
  const showConfirmation = async () => {
    if (threeWayResult.conflicts.length > 0) {
      // Has conflicts - show conflict resolution UI
      await displayConfirmationPage(
        {
          localChanges: { insertions: [], deletions: [], updateIndexes: [] },
          remoteChanges: { insertions: [], deletions: [], updateIndexes: [] },
        },
        "Conflict",
        localBookmarks,
        remoteBookmarks ? remoteBookmarks : [],
        oldBookmarks,
        threeWayResult.conflicts,
      );
    } else {
      // Show all changes (both directions)
      const changes = convertThreeWayToChanges(threeWayResult);
      console.log("three-way changes:", changes);
      await displayConfirmationPage(
        changes,
        "Sync",
        localBookmarks,
        remoteBookmarks ? remoteBookmarks : [],
        oldBookmarks,
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

function filterCascadeChanges(updateIndexes) {
  // Group by parent path (siblings)
  const groups = new Map();
  for (const update of updateIndexes) {
    const pathKey = update.path.join("/");
    if (!groups.has(pathKey)) groups.set(pathKey, []);
    groups.get(pathKey).push(update);
  }

  const filtered = [];
  for (const [pathKey, siblings] of groups) {
    if (siblings.length <= 1) {
      filtered.push(...siblings);
      continue;
    }

    // Calculate deltas and find cascade pattern
    const withDeltas = siblings.map((s) => ({
      ...s,
      delta: s.index - s.oldIndex,
    }));

    // Count +1 and -1 deltas
    let plus1 = 0,
      minus1 = 0;
    for (const item of withDeltas) {
      if (item.delta === 1) plus1++;
      if (item.delta === -1) minus1++;
    }

    // Determine cascade delta (most common ±1 with at least 2 occurrences)
    const cascadeDelta =
      plus1 > minus1 && plus1 > 1
        ? 1
        : minus1 > plus1 && minus1 > 1
          ? -1
          : null;

    // Keep items that don't match cascade pattern
    for (const item of withDeltas) {
      if (cascadeDelta === null || item.delta !== cascadeDelta) {
        // Remove the delta property before returning
        const { delta, ...bookmark } = item;
        filtered.push(bookmark);
      }
    }

    // Edge case: if we filtered everything, keep at least the largest move
    if (filtered.length === 0 && withDeltas.length > 0) {
      const largestMove = withDeltas.reduce((max, item) =>
        Math.abs(item.delta) > Math.abs(max.delta) ? item : max,
      );
      const { delta, ...bookmark } = largestMove;
      filtered.push(bookmark);
    }
  }

  return filtered;
}

function calcBookmarkChanges(otherBookmarks, myBookmarks) {
  const myBookmarksMap = new Map();
  const otherBookmarksMap = new Map();

  // Populate maps and check for duplicates in myBookmarks
  const deletions = [];
  myBookmarks.forEach((bookmark) => {
    const key = bookmarkKey(bookmark, true);
    if (myBookmarksMap.has(key)) {
      deletions.push(bookmark);
    } else {
      myBookmarksMap.set(key, bookmark);
    }
  });

  // Populate maps and check for duplicates in otherBookmarks
  const insertions = [];
  otherBookmarks.forEach((bookmark) => {
    const key = bookmarkKey(bookmark, true);
    if (otherBookmarksMap.has(key)) {
      insertions.push(bookmark);
    } else {
      otherBookmarksMap.set(key, bookmark);
    }
  });

  // Identify insertions: bookmarks in otherBookmarks not present in myBookmarks
  otherBookmarksMap.forEach((bookmark, key) => {
    if (!myBookmarksMap.has(key)) {
      insertions.push(bookmark);
    }
  });

  // Identify deletions: bookmarks in myBookmarks not present in otherBookmarks
  myBookmarksMap.forEach((bookmark, key) => {
    if (!otherBookmarksMap.has(key)) {
      deletions.push(bookmark);
    }
  });

  // Build maps for index-change detection (key WITHOUT index)
  const updateIndexes = [];
  const deletionsByKeyNoIndex = new Map();

  deletions.forEach((bookmark) => {
    const key = bookmarkKey(bookmark, false);
    deletionsByKeyNoIndex.set(key, bookmark);
  });

  // Find matching entries with different indexes
  for (let i = insertions.length - 1; i >= 0; i--) {
    const insBookmark = insertions[i];
    const key = bookmarkKey(insBookmark, false);

    if (deletionsByKeyNoIndex.has(key)) {
      const delBookmark = deletionsByKeyNoIndex.get(key);
      updateIndexes.push({ ...insBookmark, oldIndex: delBookmark.index });
      deletions.splice(deletions.indexOf(delBookmark), 1);
      insertions.splice(i, 1);
      deletionsByKeyNoIndex.delete(key);
    }
  }

  // Filter cascade changes before returning
  const filteredUpdateIndexes = filterCascadeChanges(updateIndexes);

  return { insertions, deletions, updateIndexes: filteredUpdateIndexes };
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

// Three-way diff calculation
function calcThreeWayChanges(localBookmarks, remoteBookmarks, oldBookmarks) {
  // oldBookmarks should always exist now (auto-created if missing)
  // Treat missing oldBookmarks as empty array for safety
  const baseline = oldBookmarks || [];

  const pullFromRemote = []; // Remote changed, local same as old
  const pushToRemote = []; // Local changed, remote same as old
  const conflicts = []; // Both changed differently

  // Track which bookmarks we've processed
  const processedOld = new Set();
  const processedLocal = new Set();
  const processedRemote = new Set();

  // Process each bookmark in baseline
  for (let i = 0; i < baseline.length; i++) {
    const old = baseline[i];
    processedOld.add(i);

    // Find matching bookmarks using 3-of-4 matching
    const localIdx = localBookmarks.findIndex(
      (b, idx) => !processedLocal.has(idx) && matchBookmarks3of4(old, b),
    );
    const remoteIdx = remoteBookmarks.findIndex(
      (b, idx) => !processedRemote.has(idx) && matchBookmarks3of4(old, b),
    );

    const local = localIdx >= 0 ? localBookmarks[localIdx] : null;
    const remote = remoteIdx >= 0 ? remoteBookmarks[remoteIdx] : null;

    if (localIdx >= 0) processedLocal.add(localIdx);
    if (remoteIdx >= 0) processedRemote.add(remoteIdx);

    const localChanged = !bookmarksEqual(local, old);
    const remoteChanged = !bookmarksEqual(remote, old);

    if (!localChanged && !remoteChanged) {
      // No changes
      continue;
    }

    if (!localChanged && remoteChanged) {
      // Pull from remote
      if (!remote) {
        // Remote deleted
        pullFromRemote.push({ type: "delete", bookmark: old });
      } else {
        // Remote modified
        const changedAttr = findChangedAttribute(old, remote);
        pullFromRemote.push({
          type: "update",
          bookmark: remote,
          oldBookmark: old,
          changedAttribute: changedAttr,
        });
      }
    } else if (localChanged && !remoteChanged) {
      // Push to remote
      if (!local) {
        // Local deleted
        pushToRemote.push({ type: "delete", bookmark: old });
      } else {
        // Local modified
        const changedAttr = findChangedAttribute(old, local);
        pushToRemote.push({
          type: "update",
          bookmark: local,
          oldBookmark: old,
          changedAttribute: changedAttr,
        });
      }
    } else {
      // Both changed
      if (bookmarksEqual(local, remote)) {
        // Same change made on both sides - no action needed
        continue;
      }

      // Check if they changed different attributes (can auto-merge)
      const localAttr = findChangedAttribute(old, local);
      const remoteAttr = findChangedAttribute(old, remote);

      if (
        local &&
        remote &&
        localAttr &&
        remoteAttr &&
        localAttr !== remoteAttr
      ) {
        // Different attributes changed - can merge!
        // Pull remote change, push local change
        pullFromRemote.push({
          type: "update",
          bookmark: remote,
          oldBookmark: old,
          changedAttribute: remoteAttr,
        });
        pushToRemote.push({
          type: "update",
          bookmark: local,
          oldBookmark: old,
          changedAttribute: localAttr,
        });
      } else {
        // Same attribute changed differently, or one side deleted - Conflict!
        conflicts.push({
          local: local,
          remote: remote,
          old: old,
          localAttribute: localAttr,
          remoteAttribute: remoteAttr,
        });
      }
    }
  }

  // Find new bookmarks in local (not in old)
  for (let i = 0; i < localBookmarks.length; i++) {
    if (processedLocal.has(i)) continue;
    const local = localBookmarks[i];

    // Check if remote also added the same bookmark
    const remoteIdx = remoteBookmarks.findIndex(
      (b, idx) => !processedRemote.has(idx) && matchBookmarks3of4(local, b),
    );

    if (remoteIdx >= 0) {
      processedRemote.add(remoteIdx);
      const remote = remoteBookmarks[remoteIdx];
      if (bookmarksEqual(local, remote)) {
        // Both added same bookmark - no action
        continue;
      } else {
        // Both added similar bookmark with differences - conflict
        conflicts.push({
          local: local,
          remote: remote,
          old: null,
          localAttribute: null,
          remoteAttribute: null,
        });
      }
    } else {
      // Only local added - push to remote
      pushToRemote.push({ type: "insert", bookmark: local });
    }
    processedLocal.add(i);
  }

  // Find new bookmarks in remote (not in old)
  for (let i = 0; i < remoteBookmarks.length; i++) {
    if (processedRemote.has(i)) continue;
    // Only remote added - pull from remote
    pullFromRemote.push({ type: "insert", bookmark: remoteBookmarks[i] });
  }

  return {
    mode: "three-way",
    pullFromRemote,
    pushToRemote,
    conflicts,
  };
}

// Convert three-way result to changes format
function convertThreeWayToChanges(threeWayResult) {
  const localChanges = { insertions: [], deletions: [], updateIndexes: [] };
  const remoteChanges = { insertions: [], deletions: [], updateIndexes: [] };

  // Process changes to apply locally (from remote)
  for (const change of threeWayResult.pullFromRemote) {
    if (change.type === "insert") {
      localChanges.insertions.push(change.bookmark);
    } else if (change.type === "delete") {
      localChanges.deletions.push(change.bookmark);
    } else if (change.type === "update") {
      const isIndexOnly =
        change.bookmark.title === change.oldBookmark.title &&
        (change.bookmark.url || "") === (change.oldBookmark.url || "") &&
        arraysEqual(change.bookmark.path || [], change.oldBookmark.path || []);

      if (isIndexOnly) {
        localChanges.updateIndexes.push({
          ...change.bookmark,
          oldIndex: change.oldBookmark.index,
        });
      } else {
        localChanges.deletions.push(change.oldBookmark);
        localChanges.insertions.push(change.bookmark);
      }
    }
  }

  // Process changes to apply remotely (from local)
  for (const change of threeWayResult.pushToRemote) {
    if (change.type === "insert") {
      remoteChanges.insertions.push(change.bookmark);
    } else if (change.type === "delete") {
      remoteChanges.deletions.push(change.bookmark);
    } else if (change.type === "update") {
      const isIndexOnly =
        change.bookmark.title === change.oldBookmark.title &&
        (change.bookmark.url || "") === (change.oldBookmark.url || "") &&
        arraysEqual(change.bookmark.path || [], change.oldBookmark.path || []);

      if (isIndexOnly) {
        remoteChanges.updateIndexes.push({
          ...change.bookmark,
          oldIndex: change.oldBookmark.index,
        });
      } else {
        remoteChanges.deletions.push(change.oldBookmark);
        remoteChanges.insertions.push(change.bookmark);
      }
    }
  }

  return { localChanges, remoteChanges };
}

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
browser.bookmarks.onRemoved.addListener(async () => {
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

  // Apply remote changes to local (localChanges = changes from remote to apply locally)
  if (localChanges) {
    await modifyLocalBookmarks(localChanges.deletions, localChanges.insertions);
    await applyLocalBookmarkUpdates(localChanges.updateIndexes);
  }

  // Get final local state and push to remote (includes local changes)
  const finalBookmarks = await getLocalBookmarksSnapshot();

  // Update both remote files
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    finalBookmarks,
    false,
  );
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    finalBookmarks,
    true,
  );

  await closeConfirmationWindow();
}

async function handleConflictLocal(config) {
  const localBookmarks = await getLocalBookmarksSnapshot();
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    localBookmarks,
    false,
  );
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    localBookmarks,
    true,
  );
  await closeConfirmationWindow();
}

async function handleConflictRemote(config) {
  const { remoteBookmarks, localBookmarks } = await browser.storage.local.get([
    "remoteBookmarks",
    "localBookmarks",
  ]);

  const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);
  await modifyLocalBookmarks(changes.deletions, changes.insertions);

  const currentLocalBookmarks = await getLocalBookmarksSnapshot();
  const indexChanges = calcBookmarkChanges(
    remoteBookmarks,
    currentLocalBookmarks,
  );
  await applyLocalBookmarkUpdates(indexChanges.updateIndexes);

  const finalBookmarks = await getLocalBookmarksSnapshot();
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    finalBookmarks,
    true,
  );
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
  calcBookmarkChanges,
  filterCascadeChanges,
  calcThreeWayChanges,
  bookmarksEqual,
  matchBookmarks3of4,
  findChangedAttribute,
});
