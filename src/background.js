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

//************************** UTILITY FUNCTIONS **************************

function formatSyncTime() {
  return new Date().toLocaleString();
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

//************************** SYNC ORCHESTRATION **************************

async function syncAllBookmarks(
  url,
  username,
  password,
  localMaster,
  fromBackgroundTimer,
) {
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

  // Calculate changes using 3-state sync algorithm
  const { localChanges, remoteChanges, conflicts, newState } = calcSyncChanges(
    oldRemoteState,
    currentLocalState,
    currentRemoteState,
  );

  // Also check for folder-level conflicts
  const folderConflicts = detectFolderConflicts(
    oldRemoteState,
    currentLocalState,
    currentRemoteState,
  );

  const allConflicts = [...conflicts, ...folderConflicts];

  // Check if there are any changes
  const hasChanges =
    localChanges.insertions.length > 0 ||
    localChanges.deletions.length > 0 ||
    localChanges.updates.length > 0 ||
    remoteChanges.insertions.length > 0 ||
    remoteChanges.deletions.length > 0 ||
    remoteChanges.updates.length > 0 ||
    allConflicts.length > 0;

  if (!hasChanges) {
    return;
  }

  // Store newState for use in handlers
  await browser.storage.local.set({ pendingNewState: newState });

  const showConfirmation = async () => {
    await displayConfirmationPage(
      { localChanges, remoteChanges },
      allConflicts.length > 0 ? "Conflict" : "Sync",
      localBookmarks,
      remoteData,
      allConflicts,
    );
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
  const { localChanges, remoteChanges, remoteBookmarks, pendingNewState } =
    await browser.storage.local.get([
      "localChanges",
      "remoteChanges",
      "remoteBookmarks",
      "pendingNewState",
    ]);

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

  // Get tombstones from newState
  const newStateTombstones = getTombstones(pendingNewState || []);

  // Filter out tombstones for items that now exist
  const filteredTombstones = newStateTombstones.filter((tombstone) => {
    // Check if there's a matching active bookmark
    const revived = finalBookmarks.some((bm) => match3of4(tombstone, bm));
    return !revived;
  });

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

  // Clear change log
  await clearChangeLog();

  // Reinitialize bookmark ID map
  await initializeBookmarkIdMap();

  await closeConfirmationWindow();
}

async function handleConflictLocal(config) {
  const localBookmarks = await getLocalBookmarksSnapshot();
  const localTombstones = await getLocalTombstones();

  // Filter out tombstones for folders that exist locally
  const filteredTombstones = localTombstones.filter((tombstone) => {
    if (!tombstone.url) {
      const folderPath = [...tombstone.path, tombstone.title];
      const folderExists = localBookmarks.some((bm) => {
        if (bm.path.length >= folderPath.length) {
          return folderPath.every((segment, i) => bm.path[i] === segment);
        }
        return false;
      });
      if (folderExists) {
        return false;
      }
    }
    return true;
  });

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
  await clearChangeLog();
  await initializeBookmarkIdMap();
  await closeConfirmationWindow();
}

async function handleConflictRemote(config) {
  const { remoteBookmarks } = await browser.storage.local.get([
    "remoteBookmarks",
  ]);
  const localBookmarks = await getLocalBookmarksSnapshot();

  const remoteActive = getActive(remoteBookmarks || []);
  const remoteTombstones = getTombstones(remoteBookmarks || []);

  // Calculate what to delete and insert locally
  const toDelete = [];
  const toInsert = [];

  for (const local of localBookmarks) {
    const remoteMatch = find3of4(local, remoteActive);
    if (!remoteMatch) {
      toDelete.push(local);
    }
  }

  for (const remote of remoteActive) {
    const localMatch = find3of4(remote, localBookmarks);
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

  // Filter tombstones
  const filteredTombstones = remoteTombstones.filter((tombstone) => {
    if (!tombstone.url) {
      const folderPath = [...tombstone.path, tombstone.title];
      const folderExists = finalBookmarks.some((bm) => {
        if (bm.path.length >= folderPath.length) {
          return folderPath.every((segment, i) => bm.path[i] === segment);
        }
        return false;
      });
      if (folderExists) {
        return false;
      }
    }
    return true;
  });

  await saveLocalTombstones(filteredTombstones);
  await saveLastSyncedState(finalBookmarks);
  await clearChangeLog();
  await initializeBookmarkIdMap();
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

async function handleClearRemoteTombstones(config, maxAgeDays) {
  try {
    const remoteData = await fetchWebDAV(
      config.url,
      config.username,
      config.password,
    );

    if (remoteData === null) {
      return { success: true, clearedRemote: 0 };
    }

    const remoteBookmarks = getActive(remoteData);
    const remoteTombstones = getTombstones(remoteData);

    let remainingTombstones;
    if (maxAgeDays === 0) {
      remainingTombstones = [];
    } else {
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      const now = Date.now();
      remainingTombstones = remoteTombstones.filter(
        (t) => now - t.deletedAt < maxAgeMs,
      );
    }

    const clearedRemote = remoteTombstones.length - remainingTombstones.length;

    const newRemoteData = [...remoteBookmarks, ...remainingTombstones];
    await updateWebDAV(
      config.url,
      config.username,
      config.password,
      newRemoteData,
    );

    return { success: true, clearedRemote };
  } catch (error) {
    console.error("Error clearing remote tombstones:", error);
    return { success: false, error: error.message };
  }
}

//************************** BOOKMARK EVENT LISTENERS **************************

browser.bookmarks.onChanged.addListener(async (id, changeInfo) => {
  await recordChange(
    "changed",
    id,
    changeInfo,
    getBookmarkPath,
    syncInProgress,
  );
  await debounceBookmarkSync(true);
});

browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
  await recordChange("created", id, bookmark, getBookmarkPath, syncInProgress);
  await debounceBookmarkSync(true);
});

browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
  if (syncInProgress) return;

  const [bookmark] = await browser.bookmarks.get(id);
  const oldPath = await getBookmarkPath(moveInfo.oldParentId);

  // Create tombstone for old location
  const oldBookmark = {
    title: bookmark.title,
    url: bookmark.url,
    path: oldPath,
    index: moveInfo.oldIndex,
  };
  await addLocalTombstone(oldBookmark, createTombstone, match3of4);

  await recordChange("moved", id, moveInfo, getBookmarkPath, syncInProgress);
  await debounceBookmarkSync(true);
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
    console.log(`Skipping tombstone for root folder: ${node.title}`);
    await debounceBookmarkSync(true);
    return;
  }

  const bookmark = {
    title: node.title,
    url: node.url,
    path: parentPath,
  };
  await addLocalTombstone(bookmark, createTombstone, match3of4);

  if (node.type === "folder") {
    const folderPath = [...parentPath, node.title];

    for (const [bmId, bmData] of Object.entries(bookmarkIdMapSnapshot)) {
      if (bmData.path && bmData.path.length >= folderPath.length) {
        const pathMatches = folderPath.every(
          (segment, i) => bmData.path[i] === segment,
        );
        if (pathMatches) {
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
            match3of4,
          );
        }
      }
    }
  }

  await debounceBookmarkSync(true);
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
    const config = await loadConfig();

    if (message.action && messageHandlers[message.action]) {
      await messageHandlers[message.action](config);
    } else if (message.command === "syncAllBookmarks") {
      await handleSyncAllBookmarks(config, sendResponse);
    } else if (message.command === "clearRemoteTombstones") {
      return await handleClearRemoteTombstones(config, message.maxAgeDays);
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
    }
  } catch (error) {
    console.error("Error in message handler:", error);
    return { success: false, error: error.message };
  }
  return true;
});

//************************** DEBOUNCE **************************

async function debounceBookmarkSync(localMaster) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const config = await loadConfig();

  debounceTimer = setTimeout(async () => {
    await syncAllBookmarks(
      config.url,
      config.username,
      config.password,
      localMaster,
      false,
    );
  }, 1000);
}

//************************** INITIALIZATION **************************

(async () => {
  try {
    await initializeBookmarkIdMap();

    const config = await loadConfig();

    // On first run, initialize lastSyncedState from remote
    const lastSyncedState = await getLastSyncedState();
    if (!lastSyncedState || lastSyncedState.length === 0) {
      if (config.url) {
        const remoteData = await fetchWebDAV(
          config.url,
          config.username,
          config.password,
        );
        if (remoteData) {
          await saveLastSyncedState(getActive(remoteData));
          await browser.storage.local.set({
            message: `Initialized from remote: ${formatSyncTime()}`,
          });
        }
      }
    }

    await syncAllBookmarks(
      config.url,
      config.username,
      config.password,
      false,
      true,
    );

    const checkInterval = config.checkInterval || 5;
    setInterval(
      async () => {
        const cfg = await loadConfig();
        await syncAllBookmarks(
          cfg.url,
          cfg.username,
          cfg.password,
          false,
          true,
        );
      },
      checkInterval * 60 * 1000,
    );
  } catch (error) {
    await browser.storage.local.set({ message: String(error) });
  }
})();
