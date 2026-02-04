/**
 * Background script - Main entry point
 * Ties together sync, storage, webdav, and bookmark modules
 */

//************************** CONSTANTS **************************
const ACTIONS = {
  SYNC: "Sync",
  CONFLICT: "Conflict",
  CONFLICT_LOCAL: "Conflict-local",
  CONFLICT_REMOTE: "Conflict-remote",
  CANCEL: "cancelChanges",
};

// Flag to prevent recording sync-triggered changes in the change log
let syncInProgress = false;

// UI state
let previousTabId = null;
let confirmationTabId = null;
let pendingConfirmation = null;
let debounceTimer = null;

// In-memory data for confirmation page (avoids storage for transient communication)
let confirmationData = null;

//************************** UTILITY FUNCTIONS **************************

function formatSyncTime() {
  return new Date().toLocaleString();
}

/**
 * Determine if a tombstone should be kept or filtered out
 * - Folder tombstones: remove if folder has content (path prefix check)
 * - All tombstones: remove if revived (exact 4-of-4 match)
 */
function shouldKeepTombstone(tombstone, activeBookmarks) {
  // For folders: check if any bookmark has path inside this folder
  if (!tombstone.url) {
    const folderPath = [...tombstone.path, tombstone.title];
    const hasContent = activeBookmarks.some((bm) =>
      pathStartsWith(bm.path, folderPath),
    );
    if (hasContent) return false; // folder has content, remove tombstone
  }

  // For bookmarks (and folders without content): check if revived (3-of-3 match)
  const revived = activeBookmarks.some((bm) => bookmarksEqual(tombstone, bm));
  if (revived) return false; // bookmark revived, remove tombstone

  return true; // keep tombstone
}

//************************** FOLDER MOVE TOMBSTONES **************************

/**
 * Recursively create tombstones for all contents of a moved folder
 * This is needed because when a folder is moved, its children don't fire onMoved events
 *
 * @param {string} folderId - The folder that was moved (current location)
 * @param {string[]} oldFolderPath - The old path where the folder used to be (including folder name)
 */
async function createTombstonesForFolderContents(folderId, oldFolderPath) {
  const children = await browser.bookmarks.getChildren(folderId);

  for (const child of children) {
    // Create tombstone for this child at its old path
    const tombstone = createTombstone({
      title: child.title,
      url: child.url,
      path: oldFolderPath,
      index: child.index,
    });
    await addLocalTombstoneDirectly(tombstone, bookmarksEqual);

    // If child is a folder, recurse into it
    if (!child.url) {
      const childOldPath = [...oldFolderPath, child.title];
      await createTombstonesForFolderContents(child.id, childOldPath);
    }
  }
}

//************************** DUPLICATE REMOVAL **************************

/**
 * Find and remove duplicate bookmarks (same title, url, path - different index)
 * This is needed because with 3-of-3 matching, duplicates at same path are considered identical
 *
 * For folders: merge contents into the kept folder before removing duplicate,
 * then recursively check children for duplicates
 * For bookmarks: simply remove the duplicate
 *
 * @param {string} bookmarkId - The bookmark that was just created/changed/moved
 * @param {boolean} recursive - Whether to recursively check children (default: true)
 * @returns {Promise<void>}
 */
async function removeDuplicateBookmarks(bookmarkId, recursive = true) {
  if (syncInProgress) return;

  try {
    const [bookmark] = await browser.bookmarks.get(bookmarkId);
    if (!bookmark) return;

    // Get the parent folder's children
    const siblings = await browser.bookmarks.getChildren(bookmark.parentId);

    const isFolder = !bookmark.url;

    // Find duplicates (same title, url, but different id)
    const duplicates = siblings.filter(
      (sib) =>
        sib.id !== bookmarkId &&
        sib.title === bookmark.title &&
        (sib.url || "") === (bookmark.url || ""),
    );

    // Remove duplicates (keep the one that was just created/changed)
    for (const dup of duplicates) {
      syncInProgress = true; // Prevent recording these changes
      try {
        if (isFolder) {
          // For folders: merge contents before removing
          const dupFolderPath = await getBookmarkPath(dup.id);

          // Create tombstones for all contents recursively (before moving)
          await createTombstonesForFolderContents(dup.id, dupFolderPath);

          // Move direct children to kept folder
          const dupChildren = await browser.bookmarks.getChildren(dup.id);
          for (const child of dupChildren) {
            await browser.bookmarks.move(child.id, { parentId: bookmarkId });
          }

          // Create tombstone for the duplicate folder itself
          const parentPath = await getBookmarkPath(dup.parentId);
          const folderTombstone = createTombstone({
            title: dup.title,
            path: parentPath,
            index: dup.index,
          });
          await addLocalTombstoneDirectly(folderTombstone, bookmarksEqual);

          // Now remove the empty duplicate folder
          await browser.bookmarks.remove(dup.id);
        } else {
          // For bookmarks: simply remove duplicate
          await browser.bookmarks.remove(dup.id);
        }
      } finally {
        syncInProgress = false;
      }
    }

    // Recursively check children for duplicates (after merging)
    if (recursive && isFolder) {
      const children = await browser.bookmarks.getChildren(bookmarkId);
      for (const child of children) {
        await removeDuplicateBookmarks(child.id, true);
      }
    }
  } catch (e) {
    // Bookmark might have been deleted already
  }
}

//************************** UI FUNCTIONS **************************

async function displayConfirmationPage(
  changes,
  action,
  localBookmarks,
  remoteBookmarks,
  conflicts = [],
) {
  const { localChanges, remoteChanges } = changes;

  // Store in memory for confirmation page and handlers (avoids storage)
  confirmationData = {
    localChanges,
    remoteChanges,
    action,
    localBookmarks,
    remoteBookmarks,
    conflicts,
    pendingNewState: null, // Will be set by caller if needed
  };

  const confirmationPageUrl = browser.runtime.getURL(
    "confirmation/confirmation.html",
  );

  if (confirmationTabId !== null) {
    try {
      const existingTab = await browser.tabs.get(confirmationTabId);
      if (existingTab && existingTab.url === confirmationPageUrl) {
        await browser.tabs.update(confirmationTabId, { active: true });
        await browser.tabs.reload(confirmationTabId);
        return;
      }
    } catch (e) {
      confirmationTabId = null;
    }
  }

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

  if (previousTabId) {
    try {
      await browser.tabs.update(previousTabId, { active: true });
    } catch (e) {
      // Previous tab no longer exists
    }
  }

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

/**
 * Common cleanup after sync operations complete
 */
async function finishSync() {
  await initializeBookmarkIdMap();
  await closeConfirmationWindow();
}

//************************** SYNC ORCHESTRATION **************************

async function syncAllBookmarks(url, username, password, fromBackgroundTimer) {
  // Check if configured
  if (!url) {
    await browser.storage.local.set({
      message: "Not configured - set WebDAV URL in options",
    });
    return;
  }

  // Get current local state
  const localBookmarks = await getLocalBookmarksSnapshot();
  const localTombstones = await getLocalTombstones();

  // Combine local bookmarks with tombstones for the 3-state sync
  const currentLocalState = [...localBookmarks, ...localTombstones];

  // Fetch remote state
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

  // If remote doesn't exist, push local bookmarks
  if (remoteData === null) {
    await updateWebDAV(url, username, password, localBookmarks);
    await browser.storage.local.set({
      message: `Initial sync: ${formatSyncTime()}`,
    });
    // Save initial state
    await saveLastSyncedState(localBookmarks);
    return;
  }

  await browser.storage.local.set({
    message: `Last sync: ${formatSyncTime()}`,
  });

  // Get last synced state (oldRemoteState)
  const oldRemoteState = await getLastSyncedState();

  // Current remote state
  const currentRemoteState = remoteData;

  // If no baseline exists (first sync or cleared storage), local is master
  // Push local to remote and set baseline
  if (!oldRemoteState || oldRemoteState.length === 0) {
    await updateWebDAV(url, username, password, localBookmarks);
    await saveLastSyncedState(localBookmarks);
    await browser.storage.local.set({
      message: `Initial sync (local master): ${formatSyncTime()}`,
    });
    return;
  }

  // Calculate changes using 3-state sync algorithm
  const { localChanges, remoteChanges, conflicts, newState } = calcSyncChanges(
    oldRemoteState,
    currentLocalState,
    currentRemoteState,
  );

  // Build debug log entry (will be saved after Proceed, shown in console now)
  const buildDebugLog = () => {
    const short = (str, len = 7) => {
      if (!str) return "";
      const s = str.replace(/^https?:\/\//, "");
      if (s.length <= len * 2 + 2) return s;
      return s.slice(0, len) + ".." + s.slice(-len);
    };
    const fmt = (b) => {
      if (!b) return "null";
      const del = b.deleted ? " [DEL]" : "";
      return `${short(b.title, 10)}|${short(b.url)}|${b.path?.join("/")}@${b.index}${del}`;
    };
    const fmtArr = (arr) => (arr || []).map(fmt);
    const fmtUpd = (u) =>
      `${fmt(u.oldBookmark)} -> ${fmt(u.newBookmark)} (${u.changedAttribute})`;

    return {
      timestamp: new Date().toISOString(),
      baseline: fmtArr(oldRemoteState),
      local: fmtArr(currentLocalState),
      remote: fmtArr(currentRemoteState),
      newState: fmtArr(newState),
      changes: {
        localIns: fmtArr(localChanges.insertions),
        localDel: fmtArr(localChanges.deletions),
        localUpd: (localChanges.updates || []).map(fmtUpd),
        remoteIns: fmtArr(remoteChanges.insertions),
        remoteDel: fmtArr(remoteChanges.deletions),
        remoteUpd: (remoteChanges.updates || []).map(fmtUpd),
      },
      conflicts: conflicts,
    };
  };
  const pendingDebugLog = buildDebugLog();

  // Log current sync to console
  console.log(`=== SYNC ${pendingDebugLog.timestamp} ===`);
  console.log("baseline:", pendingDebugLog.baseline);
  console.log("local:", pendingDebugLog.local);
  console.log("remote:", pendingDebugLog.remote);
  console.log("newState:", pendingDebugLog.newState);
  console.log("--- CHANGES ---");
  console.log("local.ins:", pendingDebugLog.changes.localIns);
  console.log("local.del:", pendingDebugLog.changes.localDel);
  console.log("local.upd:", pendingDebugLog.changes.localUpd);
  console.log("remote.ins:", pendingDebugLog.changes.remoteIns);
  console.log("remote.del:", pendingDebugLog.changes.remoteDel);
  console.log("remote.upd:", pendingDebugLog.changes.remoteUpd);
  console.log("conflicts:", pendingDebugLog.conflicts);
  console.log("=== END ===");

  // Note: folder conflicts (deleted folder + new content) are handled automatically
  // by the sync algorithm - folder survives if it has new content
  const allConflicts = conflicts;

  // Check if there are any changes
  const hasChanges =
    localChanges.insertions.length > 0 ||
    localChanges.deletions.length > 0 ||
    localChanges.updates.length > 0 ||
    remoteChanges.insertions.length > 0 ||
    remoteChanges.deletions.length > 0 ||
    remoteChanges.updates.length > 0 ||
    allConflicts.length > 0;

  // Check if only index updates (no structural changes or conflicts)
  const onlyIndexUpdates =
    localChanges.insertions.length === 0 &&
    localChanges.deletions.length === 0 &&
    remoteChanges.insertions.length === 0 &&
    remoteChanges.deletions.length === 0 &&
    allConflicts.length === 0 &&
    (localChanges.updates.length > 0 || remoteChanges.updates.length > 0);

  // Apply index updates silently (no confirmation needed)
  if (onlyIndexUpdates) {
    // Save debug log
    await saveDebugLog(pendingDebugLog);

    // Apply local index updates (remote wins, so we update local)
    if (localChanges.updates.length > 0) {
      syncInProgress = true;
      try {
        await applyLocalUpdates(localChanges.updates);
      } finally {
        syncInProgress = false;
      }
    }

    // Get final state and sync
    const finalBookmarks = await getLocalBookmarksSnapshot();
    const remoteTombstones = getTombstones(currentRemoteState);
    const filteredTombstones = remoteTombstones.filter((tombstone) =>
      shouldKeepTombstone(tombstone, finalBookmarks),
    );
    const newRemoteData = [...finalBookmarks, ...filteredTombstones];
    await updateWebDAV(url, username, password, newRemoteData);
    await saveLocalTombstones(filteredTombstones);
    await saveLastSyncedState(finalBookmarks);
    return;
  }

  // Even if no sync changes, filter out stale tombstones (revived items)
  if (!hasChanges) {
    const remoteActive = getActive(currentRemoteState);
    const remoteTombstones = getTombstones(currentRemoteState);
    const filteredTombstones = remoteTombstones.filter((tombstone) =>
      shouldKeepTombstone(tombstone, localBookmarks),
    );

    // If tombstones changed, update remote (keep remote active, update tombstones only)
    if (filteredTombstones.length !== remoteTombstones.length) {
      const newRemoteData = [...remoteActive, ...filteredTombstones];
      await updateWebDAV(url, username, password, newRemoteData);
      await saveLocalTombstones(filteredTombstones);
    }
    return;
  }

  const showConfirmation = async () => {
    await displayConfirmationPage(
      { localChanges, remoteChanges },
      allConflicts.length > 0 ? "Conflict" : "Sync",
      localBookmarks,
      remoteData,
      allConflicts,
    );
    // Store newState and debug log for handlers (after displayConfirmationPage sets up confirmationData)
    confirmationData.pendingNewState = newState;
    confirmationData.pendingDebugLog = pendingDebugLog;
  };

  if (fromBackgroundTimer) {
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

//************************** MESSAGE HANDLERS **************************

async function handleSync(config) {
  // Get data from in-memory confirmationData (not storage)
  const {
    localChanges,
    remoteChanges,
    remoteBookmarks,
    pendingNewState,
    pendingDebugLog,
  } = confirmationData || {};

  // Save debug log now that user confirmed
  if (pendingDebugLog) {
    await saveDebugLog(pendingDebugLog);
  }

  // Apply local changes (deletions and insertions)
  if (localChanges) {
    syncInProgress = true;
    try {
      await modifyLocalBookmarks(
        localChanges.deletions || [],
        localChanges.insertions || [],
        localChanges.updates || [],
        (path) => removeLocalTombstonesForPath(path, arraysEqual),
      );
      await applyLocalUpdates(localChanges.updates || []);
    } finally {
      syncInProgress = false;
    }
  }

  // Ensure items being pushed to remote also exist locally
  // (they may have been cascade-deleted when parent folder was deleted)
  if (remoteChanges?.insertions?.length > 0) {
    syncInProgress = true;
    try {
      for (const item of remoteChanges.insertions) {
        const exists = await locateBookmarkId(
          item.url,
          item.title,
          null,
          item.path,
        );
        if (!exists) {
          // Create parent folder if needed, then create bookmark
          const parentId = await locateParentId(item.path, true);
          if (parentId) {
            await browser.bookmarks.create({
              parentId,
              title: item.title,
              url: item.url,
              index: item.index,
            });
            // Remove tombstones for this path (folder was recreated)
            await removeLocalTombstonesForPath(item.path, arraysEqual);
          }
        }
      }
    } finally {
      syncInProgress = false;
    }
  }

  // Get final local state
  const finalBookmarks = await getLocalBookmarksSnapshot();

  // Get tombstones from newState and existing remote
  const newStateTombstones = getTombstones(pendingNewState || []);
  const existingRemoteTombstones = getTombstones(remoteBookmarks || []);

  // Merge tombstones: keep all existing remote tombstones + new ones from sync
  const allTombstones = [...existingRemoteTombstones];
  for (const newTomb of newStateTombstones) {
    const exists = allTombstones.some((t) => bookmarksEqual(newTomb, t));
    if (!exists) {
      allTombstones.push(newTomb);
    }
  }

  // Filter out tombstones for items that now exist (revived)
  const filteredTombstones = allTombstones.filter((tombstone) =>
    shouldKeepTombstone(tombstone, finalBookmarks),
  );

  // Create new remote data
  let newRemoteData = [...finalBookmarks, ...filteredTombstones];

  // Ensure parent folders exist for items being pushed to remote
  if (remoteChanges?.insertions?.length > 0) {
    for (const item of remoteChanges.insertions) {
      // Check each level of the path
      for (let i = 1; i <= item.path.length; i++) {
        const folderPath = item.path.slice(0, i);
        const folderTitle = folderPath[folderPath.length - 1];
        const parentPath = folderPath.slice(0, -1);

        // Check if folder exists in newRemoteData
        const folderExists = newRemoteData.some(
          (bm) =>
            !bm.url &&
            !bm.deleted &&
            bm.title === folderTitle &&
            arraysEqual(bm.path, parentPath),
        );

        if (!folderExists) {
          // Add folder to newRemoteData
          newRemoteData.push({
            title: folderTitle,
            path: parentPath,
            index: 0,
          });
          // Remove tombstone for this folder if present
          newRemoteData = newRemoteData.filter(
            (bm) =>
              !(
                bm.deleted &&
                bm.title === folderTitle &&
                arraysEqual(bm.path, parentPath)
              ),
          );
        }
      }
    }
  }

  // Update remote
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    newRemoteData,
  );

  // Save tombstones locally
  await saveLocalTombstones(filteredTombstones);

  // Save lastSyncedState
  await saveLastSyncedState(finalBookmarks);

  await finishSync();
}

async function handleConflictLocal(config) {
  const { remoteBookmarks } = confirmationData || {};
  const localBookmarks = await getLocalBookmarksSnapshot();
  const localTombstones = await getLocalTombstones();
  const remoteTombstones = getTombstones(remoteBookmarks || []);

  // Merge tombstones: local + remote tombstones not already in local
  const allTombstones = [...localTombstones];
  for (const remoteTomb of remoteTombstones) {
    const exists = allTombstones.some((t) => bookmarksEqual(remoteTomb, t));
    if (!exists) {
      allTombstones.push(remoteTomb);
    }
  }

  // Filter out tombstones for items that exist locally (local wins = they live)
  const filteredTombstones = allTombstones.filter((tombstone) =>
    shouldKeepTombstone(tombstone, localBookmarks),
  );

  // Push local state to remote
  const newRemoteData = [...localBookmarks, ...filteredTombstones];
  await updateWebDAV(
    config.url,
    config.username,
    config.password,
    newRemoteData,
  );

  await saveLocalTombstones(filteredTombstones);
  await saveLastSyncedState(localBookmarks);
  await finishSync();
}

async function handleConflictRemote(config) {
  // Get data from in-memory confirmationData (not storage)
  const { remoteBookmarks } = confirmationData || {};
  const localBookmarks = await getLocalBookmarksSnapshot();

  const remoteActive = getActive(remoteBookmarks || []);
  const remoteTombstones = getTombstones(remoteBookmarks || []);

  // Calculate what to delete and insert locally (3-of-3 matching)
  const toDelete = [];
  const toInsert = [];

  // Find local bookmarks not in remote -> delete
  for (const local of localBookmarks) {
    const remoteMatch = findExact(local, remoteActive);
    if (!remoteMatch) {
      toDelete.push(local);
    }
  }

  // Find remote bookmarks not in local -> insert
  for (const remote of remoteActive) {
    const localMatch = findExact(remote, localBookmarks);
    if (!localMatch) {
      toInsert.push(remote);
    }
  }

  syncInProgress = true;
  try {
    await modifyLocalBookmarks(toDelete, toInsert, [], (path) =>
      removeLocalTombstonesForPath(path, arraysEqual),
    );
  } finally {
    syncInProgress = false;
  }

  const finalBookmarks = await getLocalBookmarksSnapshot();

  // Filter tombstones for items that exist
  const filteredTombstones = remoteTombstones.filter((tombstone) =>
    shouldKeepTombstone(tombstone, finalBookmarks),
  );

  await saveLocalTombstones(filteredTombstones);
  await saveLastSyncedState(finalBookmarks);
  await finishSync();
}

async function handleSyncAllBookmarks(config, sendResponse) {
  try {
    await syncAllBookmarks(config.url, config.username, config.password, false);
    sendResponse({ success: true });
  } catch (error) {
    sendResponse({ success: false, error: error });
  }
}

async function handleClearTombstones(config, maxAgeDays) {
  try {
    const maxAgeMs =
      maxAgeDays === 0 ? Infinity : maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const shouldClear = (t) =>
      maxAgeDays === 0 || now - t.deletedAt >= maxAgeMs;

    // 1. Clear from remote
    let clearedRemote = 0;
    const remoteData = await fetchWebDAV(
      config.url,
      config.username,
      config.password,
    );
    if (remoteData !== null) {
      const remoteBookmarks = getActive(remoteData);
      const remoteTombstones = getTombstones(remoteData);
      const remainingRemote = remoteTombstones.filter((t) => !shouldClear(t));
      clearedRemote = remoteTombstones.length - remainingRemote.length;
      await updateWebDAV(config.url, config.username, config.password, [
        ...remoteBookmarks,
        ...remainingRemote,
      ]);
    }

    // 2. Clear from baseline
    let clearedBaseline = 0;
    const baseline = await getLastSyncedState();
    if (baseline && baseline.length > 0) {
      const baselineBookmarks = getActive(baseline);
      const baselineTombstones = getTombstones(baseline);
      const remainingBaseline = baselineTombstones.filter(
        (t) => !shouldClear(t),
      );
      clearedBaseline = baselineTombstones.length - remainingBaseline.length;
      await saveLastSyncedState([...baselineBookmarks, ...remainingBaseline]);
    }

    // 3. Clear from local
    let clearedLocal = 0;
    const localTombstones = await getLocalTombstones();
    const remainingLocal = localTombstones.filter((t) => !shouldClear(t));
    clearedLocal = localTombstones.length - remainingLocal.length;
    await saveLocalTombstones(remainingLocal);

    return { success: true, clearedRemote, clearedBaseline, clearedLocal };
  } catch (error) {
    console.error("Error clearing tombstones:", error);
    return { success: false, error: error.message };
  }
}

//************************** BOOKMARK EVENT LISTENERS **************************

browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
  if (syncInProgress) return;

  // Get the old bookmark data before recording the change
  const bookmarkIdMap = await getBookmarkIdMap();
  const oldBookmark = bookmarkIdMap[id];

  await recordChange(
    "changed",
    id,
    changeInfo,
    getBookmarkPath,
    syncInProgress,
  );

  // Create tombstone for old state if title or url changed
  // With 3-of-3 matching, a title/url change creates a "different" bookmark
  if (oldBookmark) {
    const titleChanged =
      changeInfo.title !== undefined && changeInfo.title !== oldBookmark.title;
    const urlChanged =
      changeInfo.url !== undefined && changeInfo.url !== oldBookmark.url;

    if (titleChanged || urlChanged) {
      // Create tombstone for the old bookmark state
      const tombstone = createTombstone({
        title: oldBookmark.title,
        url: oldBookmark.url,
        path: oldBookmark.path,
        index: oldBookmark.index,
      });
      await addLocalTombstoneDirectly(tombstone, bookmarksEqual);
    }
  }

  // Check for duplicates after title/url change
  await removeDuplicateBookmarks(id);
  await debounceBookmarkSync();
});

browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
  await recordChange("created", id, bookmark, getBookmarkPath, syncInProgress);
  // Check for duplicates after creating
  await removeDuplicateBookmarks(id);
  await debounceBookmarkSync();
});

browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (syncInProgress) return;

  const [bookmark] = await browser.bookmarks.get(id);
  const oldPath = await getBookmarkPath(moveInfo.oldParentId);

  // Create tombstone for old location using calcMove
  const oldBookmark = {
    title: bookmark.title,
    url: bookmark.url,
    path: oldPath,
    index: moveInfo.oldIndex,
  };
  const tombstone = calcMove(oldBookmark);
  await addLocalTombstoneDirectly(tombstone, bookmarksEqual);

  // If moving a folder, create tombstones for all children at their old paths
  if (!bookmark.url) {
    const oldFolderPath = [...oldPath, bookmark.title];
    await createTombstonesForFolderContents(id, oldFolderPath);
  }

  await recordChange("moved", id, moveInfo, getBookmarkPath, syncInProgress);
  // Check for duplicates after moving to new folder
  await removeDuplicateBookmarks(id);
  await debounceBookmarkSync();
});

browser.bookmarks.onRemoved.addListener(async (id, removeInfo) => {
  const bookmarkIdMapSnapshot = await getBookmarkIdMap();

  await recordChange(
    "removed",
    id,
    removeInfo,
    getBookmarkPath,
    syncInProgress,
  );

  const parentPath = await getBookmarkPath(removeInfo.parentId);
  const node = removeInfo.node;

  const rootFolders = [
    "Bookmarks Toolbar",
    "Other Bookmarks",
    "Mobile Bookmarks",
    "Bookmarks Menu",
  ];
  if (parentPath.length === 0 && rootFolders.includes(node.title)) {
    await debounceBookmarkSync();
    return;
  }

  const bookmark = {
    title: node.title,
    url: node.url,
    path: parentPath,
  };
  await addLocalTombstone(bookmark, createTombstone, bookmarksEqual);

  if (node.type === "folder") {
    const folderPath = [...parentPath, node.title];

    for (const [bmId, bmData] of Object.entries(bookmarkIdMapSnapshot)) {
      if (pathStartsWith(bmData.path, folderPath)) {
        if (bmData.path.length === 0 && rootFolders.includes(bmData.title)) {
          continue;
        }
        await addLocalTombstone(
          {
            title: bmData.title,
            url: bmData.url,
            path: bmData.path,
          },
          createTombstone,
          bookmarksEqual,
        );
      }
    }
  }

  await debounceBookmarkSync();
});

//************************** OTHER LISTENERS **************************

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

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === confirmationTabId) {
    confirmationTabId = null;
  }
});

const messageHandlers = {
  [ACTIONS.SYNC]: handleSync,
  [ACTIONS.CONFLICT_LOCAL]: handleConflictLocal,
  [ACTIONS.CONFLICT_REMOTE]: handleConflictRemote,
  [ACTIONS.CANCEL]: async () => closeConfirmationWindow(),
};

browser.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
  try {
    // Handle confirmation page data request (no config needed)
    if (message.command === "getConfirmationData") {
      return confirmationData;
    }

    const config = await loadConfig();

    if (message.action && messageHandlers[message.action]) {
      await messageHandlers[message.action](config);
    } else if (message.command === "syncAllBookmarks") {
      await handleSyncAllBookmarks(config, sendResponse);
    } else if (message.command === "clearRemoteTombstones") {
      return await handleClearTombstones(config, message.maxAgeDays);
    } else if (message.command === "initializeFromRemote") {
      if (config.url) {
        const remoteData = await fetchWebDAV(
          config.url,
          config.username,
          config.password,
        );
        if (remoteData) {
          await saveLastSyncedState(getActive(remoteData));
          return { success: true };
        }
      }
      return { success: false };
    } else if (message.command === "getDebugLogs") {
      return await getDebugLogs();
    }
  } catch (error) {
    console.error("Error in message handler:", error);
    return { success: false, error: error.message };
  }
  return true;
});

//************************** DEBOUNCE **************************

async function debounceBookmarkSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const config = await loadConfig();

  debounceTimer = setTimeout(async () => {
    await syncAllBookmarks(config.url, config.username, config.password, false);
  }, 1000);
}

//************************** INITIALIZATION **************************

(async () => {
  try {
    await initializeBookmarkIdMap();

    const config = await loadConfig();

    // On first run, initialize lastSyncedState from current local bookmarks
    // This ensures local state is preserved until user confirms sync changes
    const lastSyncedState = await getLastSyncedState();
    if (!lastSyncedState || lastSyncedState.length === 0) {
      const localBookmarks = await getLocalBookmarksSnapshot();
      await saveLastSyncedState(localBookmarks);
      await browser.storage.local.set({
        message: `Initialized baseline from local: ${formatSyncTime()}`,
      });
    }

    await syncAllBookmarks(config.url, config.username, config.password, true);

    const checkInterval = config.checkInterval || 5;
    setInterval(
      async () => {
        const cfg = await loadConfig();
        await syncAllBookmarks(cfg.url, cfg.username, cfg.password, true);
      },
      checkInterval * 60 * 1000,
    );
  } catch (error) {
    await browser.storage.local.set({ message: String(error) });
  }
})();
