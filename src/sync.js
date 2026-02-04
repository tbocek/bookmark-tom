/**
 * Bookmark Sync Algorithm - 3-State Design with 3-of-3 Matching
 *
 * States:
 * - oldRemoteState: Snapshot of remote at last successful sync (includes tombstones)
 * - currentLocalState: Current local bookmarks (includes tombstones)
 * - currentRemoteState: Fresh remote state fetched at sync time (includes tombstones)
 *
 * Internal Logic (3-of-3 matching - ignores index):
 * - Two bookmarks are the "same" if title, url, and path match (index ignored)
 * - This allows index shifts (reordering) to not create "new" bookmarks
 * - Duplicates (same title, url, path) should be removed by the caller
 *
 * Sync Flow:
 * 1. Categorize changes on each side (unchanged, deleted, added)
 * 2. Build newState based on changes
 * 3. Protect folders that have content from deletion
 * 4. Diff to get localChanges and remoteChanges
 */

// ============================================
// HELPER FUNCTIONS
// ============================================

function arraysEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((val, i) => val === b[i]);
}

/**
 * 3-of-3 key for matching (ignores index)
 */
function bookmarkKey(bm) {
  const url = bm.url || "";
  const path = (bm.path || []).join("/");
  return `${bm.title}|${path}|${url}`;
}

/**
 * Check if two bookmarks match (3-of-3: title, url, path - ignores index)
 */
function bookmarksEqual(a, b) {
  return (
    a.title === b.title &&
    (a.url || "") === (b.url || "") &&
    arraysEqual(a.path, b.path)
  );
}

/**
 * Check if two bookmarks match exactly (4-of-4, including index)
 * Used for UI display and precise matching when needed
 */
function bookmarksEqualExact(a, b) {
  return (
    a.title === b.title &&
    (a.url || "") === (b.url || "") &&
    arraysEqual(a.path, b.path) &&
    a.index === b.index
  );
}

/**
 * Check if two bookmarks match by 3-of-4 (for UI grouping only)
 */
function match3of4(a, b) {
  let matches = 0;
  if (a.title === b.title) matches++;
  if ((a.url || "") === (b.url || "")) matches++;
  if (arraysEqual(a.path, b.path)) matches++;
  if (a.index === b.index) matches++;
  return matches >= 3;
}

/**
 * Find match in list (3-of-3)
 */
function findExact(bookmark, list) {
  return list.find((b) => bookmarksEqual(bookmark, b));
}

/**
 * Find 3-of-4 match in list (for UI grouping only)
 */
function find3of4(bookmark, list) {
  return list.find((b) => match3of4(bookmark, b));
}

function isTombstone(bm) {
  return bm.deleted === true;
}

function isFolder(bm) {
  return !bm.url;
}

function getActive(list) {
  return (list || []).filter((b) => !isTombstone(b));
}

function getTombstones(list) {
  return (list || []).filter((b) => isTombstone(b));
}

function createTombstone(bookmark) {
  return {
    title: bookmark.title,
    url: bookmark.url || "",
    path: bookmark.path,
    index: bookmark.index,
    deleted: true,
    deletedAt: Date.now(),
  };
}

/**
 * Calculate the tombstone needed when a bookmark is moved.
 * A move is internally an insert at new location + delete at old location.
 * This function creates the tombstone for the old location.
 *
 * @param {Object} oldBookmark - The bookmark at its OLD location (before move)
 *   - title: string
 *   - url: string (optional for folders)
 *   - path: array
 *   - index: number
 * @returns {Object} tombstone for the old location
 */
function calcMove(oldBookmark) {
  return createTombstone(oldBookmark);
}

function pathStartsWith(path, folderPath) {
  if (!path || !folderPath) return false;
  if (path.length < folderPath.length) return false;
  return folderPath.every((segment, i) => path[i] === segment);
}

function getBookmarksInFolder(bookmarks, folderPath) {
  return bookmarks.filter((bm) => pathStartsWith(bm.path, folderPath));
}

/**
 * Find which attribute differs between two bookmarks
 */
function findDifferingAttribute(a, b) {
  if (a.title !== b.title) return "title";
  if ((a.url || "") !== (b.url || "")) return "url";
  if (!arraysEqual(a.path, b.path)) return "path";
  if (a.index !== b.index) return "index";
  return null;
}

// ============================================
// DIFF FUNCTION (4-of-4 exact matching)
// ============================================

/**
 * Calculate changes needed to go from `current` to `target`
 * Uses 3-of-3 matching for identity, detects index changes as updates
 */
function diffStates(current, target, debugLabel = "") {
  const insertions = [];
  const deletions = [];
  const updates = [];

  const currentActive = getActive(current);
  const targetActive = getActive(target);

  const currentKeys = new Set(currentActive.map(bookmarkKey));
  const targetKeys = new Set(targetActive.map(bookmarkKey));

  // Build a map of current bookmarks by key for quick lookup
  const currentByKey = new Map();
  for (const curr of currentActive) {
    currentByKey.set(bookmarkKey(curr), curr);
  }

  // Items in target but not in current -> insertions
  // Items in both but with different index -> updates
  for (const tgt of targetActive) {
    const key = bookmarkKey(tgt);
    if (!currentKeys.has(key)) {
      insertions.push(tgt);
    } else {
      // Check if index differs
      const curr = currentByKey.get(key);
      if (curr.index !== tgt.index) {
        updates.push({
          oldBookmark: curr,
          newBookmark: tgt,
          changedAttribute: "index",
        });
      }
    }
  }

  // Items in current but not in target -> deletions
  for (const curr of currentActive) {
    if (!targetKeys.has(bookmarkKey(curr))) {
      deletions.push(curr);
    }
  }

  return { insertions, deletions, updates };
}

// ============================================
// CATEGORIZE CHANGES (4-of-4 exact matching)
// ============================================

/**
 * Categorize what changed between old and current state
 * Uses 4-of-4 exact matching only
 *
 * Returns: { unchanged, deleted, added }
 */
function categorizeChanges(oldActive, currentActive, currentTombstones) {
  const unchanged = []; // In both, exactly same (4-of-4)
  const deleted = []; // In old, has tombstone in current (4-of-4)
  const added = []; // In current, not in old

  const matchedOld = new Set();
  const matchedCurrent = new Set();

  // Find exact matches between old and current (4-of-4)
  for (let i = 0; i < oldActive.length; i++) {
    const old = oldActive[i];

    const exactMatch = currentActive.findIndex(
      (c, j) => !matchedCurrent.has(j) && bookmarksEqual(old, c),
    );

    if (exactMatch !== -1) {
      unchanged.push({ old, current: currentActive[exactMatch] });
      matchedOld.add(i);
      matchedCurrent.add(exactMatch);
      continue;
    }

    // Check if deleted (must have exact tombstone match)
    const hasTombstone = findExact(old, currentTombstones);
    if (hasTombstone) {
      deleted.push({ old, tombstone: hasTombstone });
      matchedOld.add(i);
    }
    // If no exact match and no tombstone, item is "missing" from this side
    // Will be handled in merge logic
  }

  // Items in current that weren't matched -> added
  for (let j = 0; j < currentActive.length; j++) {
    if (!matchedCurrent.has(j)) {
      added.push(currentActive[j]);
    }
  }

  return { unchanged, deleted, added };
}

// ============================================
// MERGE FUNCTION - Calculate newState
// ============================================

/**
 * Merge 3 states into newState
 */
function mergeStates(oldState, localState, remoteState) {
  const oldActive = getActive(oldState);
  const localActive = getActive(localState);
  const localTombstones = getTombstones(localState);
  const remoteActive = getActive(remoteState);
  const remoteTombstones = getTombstones(remoteState);
  const conflicts = [];

  // ----------------------------------------
  // PASS 1: Categorize changes on each side
  // ----------------------------------------

  const localChanges = categorizeChanges(
    oldActive,
    localActive,
    localTombstones,
  );
  const remoteChanges = categorizeChanges(
    oldActive,
    remoteActive,
    remoteTombstones,
  );

  // ----------------------------------------
  // PASS 2: Build newState
  // ----------------------------------------

  const newState = [];
  const addedKeys = new Set();

  // Process old bookmarks
  for (const old of oldActive) {
    // Find what local did to this bookmark
    const localUnchanged = localChanges.unchanged.find((u) =>
      bookmarksEqual(u.old, old),
    );
    const localDeleted = localChanges.deleted.find((d) =>
      bookmarksEqual(d.old, old),
    );

    // Find what remote did to this bookmark
    const remoteUnchanged = remoteChanges.unchanged.find((u) =>
      bookmarksEqual(u.old, old),
    );
    const remoteDeleted = remoteChanges.deleted.find((d) =>
      bookmarksEqual(d.old, old),
    );

    // Both unchanged (3-of-3 match) - check for index differences
    if (localUnchanged && remoteUnchanged) {
      const localCurrent = localUnchanged.current;
      const remoteCurrent = remoteUnchanged.current;
      const baselineIndex = old.index;
      const localIndex = localCurrent.index;
      const remoteIndex = remoteCurrent.index;

      // 3-way merge for index (no conflicts, just pick winner)
      // If local changed from baseline → local wins (intentional)
      // If local unchanged from baseline → remote wins
      const localChanged = localIndex !== baselineIndex;
      const winningIndex = localChanged ? localIndex : remoteIndex;
      newState.push({ ...old, index: winningIndex });
      addedKeys.add(bookmarkKey(old));
      continue;
    }

    // Both deleted
    if (localDeleted && remoteDeleted) {
      newState.push(createTombstone(old));
      continue;
    }

    // Local unchanged, remote deleted
    if (localUnchanged && remoteDeleted) {
      newState.push(createTombstone(old));
      continue;
    }

    // Local deleted, remote unchanged
    if (localDeleted && remoteUnchanged) {
      newState.push(createTombstone(old));
      continue;
    }

    // Local deleted, remote missing (not in remote at all) -> push tombstone
    if (localDeleted && !remoteUnchanged && !remoteDeleted) {
      newState.push(createTombstone(old));
      continue;
    }

    // Remote deleted, local missing (not in local at all) -> push tombstone
    if (remoteDeleted && !localUnchanged && !localDeleted) {
      newState.push(createTombstone(old));
      continue;
    }

    // Local unchanged, remote missing (no match, no tombstone) -> keep it
    if (localUnchanged && !remoteUnchanged && !remoteDeleted) {
      newState.push(old);
      addedKeys.add(bookmarkKey(old));
      continue;
    }

    // Remote unchanged, local missing (no match, no tombstone) -> keep it
    if (remoteUnchanged && !localUnchanged && !localDeleted) {
      newState.push(old);
      addedKeys.add(bookmarkKey(old));
      continue;
    }

    // Both sides missing (no match, no tombstone on either side)
    // This can happen if the item was never on this machine
    // Don't add to newState (effectively deleted)
    if (
      !localUnchanged &&
      !localDeleted &&
      !remoteUnchanged &&
      !remoteDeleted
    ) {
      continue;
    }

    // SAFETY: If we reach here, no condition matched - this should not happen
    // To prevent accidental data loss, keep the bookmark and log a warning
    console.warn(
      `[SYNC WARNING] Bookmark "${old.title}" did not match any merge condition. ` +
        `Keeping it to prevent data loss. ` +
        `local: unchanged=${!!localUnchanged} deleted=${!!localDeleted}, ` +
        `remote: unchanged=${!!remoteUnchanged} deleted=${!!remoteDeleted}`,
    );
    newState.push(old);
    addedKeys.add(bookmarkKey(old));
  }

  // Process local additions
  for (const localAdd of localChanges.added) {
    const key = bookmarkKey(localAdd);
    if (addedKeys.has(key)) continue;

    // Check if remote has exact same
    const remoteExact = findExact(localAdd, remoteActive);
    if (remoteExact) {
      newState.push(localAdd);
      addedKeys.add(key);
      continue;
    }

    // Check if remote deleted this (exact tombstone match)
    const remoteTomb = findExact(localAdd, remoteTombstones);
    if (remoteTomb) {
      // Local added, remote has tombstone - local wins (recreated)
      newState.push(localAdd);
      addedKeys.add(key);
      continue;
    }

    // Normal local add
    newState.push(localAdd);
    addedKeys.add(key);
  }

  // Process remote additions
  for (const remoteAdd of remoteChanges.added) {
    const key = bookmarkKey(remoteAdd);
    if (addedKeys.has(key)) continue;

    // Check if local deleted this (exact tombstone match)
    const localTomb = findExact(remoteAdd, localTombstones);
    if (localTomb) {
      // Remote added, local has tombstone - remote wins (recreated)
      newState.push(remoteAdd);
      addedKeys.add(key);
      continue;
    }

    // Normal remote add
    newState.push(remoteAdd);
    addedKeys.add(key);
  }

  return { newState, conflicts };
}

// ============================================
// FOLDER PROTECTION
// ============================================

/**
 * Check if a folder has any content in the given bookmark list
 * @param {Object} folder - The folder bookmark (no url)
 * @param {Array} bookmarks - List of bookmarks to check
 * @returns {boolean} true if folder has content
 */
function folderHasContent(folder, bookmarks) {
  const folderPath = [...folder.path, folder.title];
  return bookmarks.some((bm) => {
    if (isTombstone(bm)) return false;
    return pathStartsWith(bm.path, folderPath);
  });
}

/**
 * Remove folder tombstones from newState if the folder has content
 * This prevents deleting folders that contain new bookmarks
 *
 * @param {Array} newState - The merged state
 * @returns {Array} newState with protected folders converted back to active
 */
function protectFoldersWithContent(newState) {
  const activeBookmarks = getActive(newState);
  const result = [];

  for (const item of newState) {
    // If it's a folder tombstone, check if folder has content
    if (isTombstone(item) && isFolder(item)) {
      if (folderHasContent(item, activeBookmarks)) {
        // Convert tombstone back to active folder
        result.push({
          title: item.title,
          path: item.path,
          index: item.index,
          // No url (it's a folder), no deleted flag
        });
        continue;
      }
    }
    result.push(item);
  }

  return result;
}

// ============================================
// FOLDER CONFLICT DETECTION (stub - no longer used)
// ============================================

/**
 * Detect folder-level conflicts
 * With 4-of-4 matching, folder conflicts are handled by protectFoldersWithContent
 * This function is kept for API compatibility but always returns empty
 */
function detectFolderConflicts(
  oldRemoteState,
  currentLocalState,
  currentRemoteState,
) {
  return [];
}

// ============================================
// MAIN SYNC FUNCTION
// ============================================

/**
 * Calculate sync changes based on 3 states
 */
function calcSyncChanges(
  oldRemoteState,
  currentLocalState,
  currentRemoteState,
) {
  // Step 1: Merge to get newState
  let { newState, conflicts } = mergeStates(
    oldRemoteState || [],
    currentLocalState || [],
    currentRemoteState || [],
  );

  // Step 2: Protect folders that have content from deletion
  newState = protectFoldersWithContent(newState);

  // Step 3: Diff currentLocalState vs newState -> localChanges
  const localChanges = diffStates(
    currentLocalState || [],
    newState,
    "LOCAL->newState",
  );

  // Step 4: Diff currentRemoteState vs newState -> remoteChanges
  const remoteChanges = diffStates(
    currentRemoteState || [],
    newState,
    "REMOTE->newState",
  );

  return {
    localChanges,
    remoteChanges,
    conflicts,
    newState,
  };
}

// ============================================
// EXPORTS
// ============================================

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    calcSyncChanges,
    detectFolderConflicts,
    diffStates,
    mergeStates,
    categorizeChanges,
    protectFoldersWithContent,
    folderHasContent,
    arraysEqual,
    bookmarkKey,
    match3of4,
    bookmarksEqual,
    bookmarksEqualExact,
    findExact,
    find3of4,
    isTombstone,
    isFolder,
    getActive,
    getTombstones,
    createTombstone,
    calcMove,
    pathStartsWith,
    getBookmarksInFolder,
    findDifferingAttribute,
  };
}

// For eval-based loading in tests
({
  calcSyncChanges,
  detectFolderConflicts,
  diffStates,
  mergeStates,
  categorizeChanges,
  protectFoldersWithContent,
  folderHasContent,
  arraysEqual,
  bookmarkKey,
  match3of4,
  bookmarksEqual,
  bookmarksEqualExact,
  findExact,
  find3of4,
  isTombstone,
  isFolder,
  getActive,
  getTombstones,
  createTombstone,
  calcMove,
  pathStartsWith,
  getBookmarksInFolder,
  findDifferingAttribute,
});
