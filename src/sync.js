/**
 * Bookmark Sync Algorithm - 3-State Design with 4-of-4 Matching
 *
 * States:
 * - oldRemoteState: Snapshot of remote at last successful sync (includes tombstones)
 * - currentLocalState: Current local bookmarks (includes tombstones)
 * - currentRemoteState: Fresh remote state fetched at sync time (includes tombstones)
 *
 * Internal Logic (4-of-4 exact matching):
 * - Two bookmarks are the "same" only if all 4 attributes match (title, url, path, index)
 * - Move = delete at old location + insert at new location
 * - Tombstones only match their exact bookmark
 *
 * Conflict Detection (3-of-4 matching):
 * - Used to find "same" bookmark that was changed differently on each side
 *
 * Sync Flow:
 * 1. Categorize changes on each side (using 3-of-4 to find same bookmarks)
 * 2. Detect conflicts (same bookmark changed differently)
 * 3. Build newState (excluding conflicted items)
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
 * Exact 4-of-4 key for internal matching
 */
function bookmarkKey(bm) {
  const url = bm.url || "";
  const path = (bm.path || []).join("/");
  return `${bm.title}|${path}|${url}|${bm.index}`;
}

/**
 * Check if two bookmarks match exactly (4-of-4)
 */
function bookmarksEqual(a, b) {
  return (
    a.title === b.title &&
    (a.url || "") === (b.url || "") &&
    arraysEqual(a.path, b.path) &&
    a.index === b.index
  );
}

/**
 * Check if two bookmarks match by 3-of-4 (for conflict detection)
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
 * Find exact match in list (4-of-4)
 */
function findExact(bookmark, list) {
  return list.find((b) => bookmarksEqual(bookmark, b));
}

/**
 * Find 3-of-4 match in list
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
 * Uses exact 4-of-4 matching
 */
function diffStates(current, target) {
  const insertions = [];
  const deletions = [];
  const updates = [];

  const currentActive = getActive(current);
  const targetActive = getActive(target);

  const currentKeys = new Set(currentActive.map(bookmarkKey));
  const targetKeys = new Set(targetActive.map(bookmarkKey));

  // Items in target but not in current → insertions
  for (const tgt of targetActive) {
    if (!currentKeys.has(bookmarkKey(tgt))) {
      insertions.push(tgt);
    }
  }

  // Items in current but not in target → deletions
  for (const curr of currentActive) {
    if (!targetKeys.has(bookmarkKey(curr))) {
      deletions.push(curr);
    }
  }

  return { insertions, deletions, updates };
}

// ============================================
// CATEGORIZE CHANGES (using 3-of-4)
// ============================================

/**
 * Categorize what changed between old and current state
 * Uses 3-of-4 to identify "same" bookmark
 *
 * Returns: { unchanged, modified, deleted, added }
 */
function categorizeChanges(oldActive, currentActive, currentTombstones) {
  const unchanged = []; // In both, exactly same
  const modified = []; // In both (3-of-4), but different
  const deleted = []; // In old, not in current (or has tombstone)
  const added = []; // In current, not in old

  const matchedOld = new Set();
  const matchedCurrent = new Set();

  // Find matches between old and current using 3-of-4
  for (let i = 0; i < oldActive.length; i++) {
    const old = oldActive[i];

    // First check for exact match
    const exactMatch = currentActive.findIndex(
      (c, j) => !matchedCurrent.has(j) && bookmarksEqual(old, c),
    );

    if (exactMatch !== -1) {
      unchanged.push({ old, current: currentActive[exactMatch] });
      matchedOld.add(i);
      matchedCurrent.add(exactMatch);
      continue;
    }

    // Check for 3-of-4 match (modified)
    const match3of4Idx = currentActive.findIndex(
      (c, j) => !matchedCurrent.has(j) && match3of4(old, c),
    );

    if (match3of4Idx !== -1) {
      modified.push({ old, current: currentActive[match3of4Idx] });
      matchedOld.add(i);
      matchedCurrent.add(match3of4Idx);
      continue;
    }

    // Check if deleted (has tombstone or just gone)
    const hasTombstone = find3of4(old, currentTombstones);
    deleted.push({ old, tombstone: hasTombstone || null });
    matchedOld.add(i);
  }

  // Items in current that weren't matched → added
  for (let j = 0; j < currentActive.length; j++) {
    if (!matchedCurrent.has(j)) {
      added.push(currentActive[j]);
    }
  }

  return { unchanged, modified, deleted, added };
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
  // PASS 2: Detect conflicts
  // ----------------------------------------

  const conflicts = [];
  const conflictedOldKeys = new Set(); // Track which old bookmarks have conflicts

  // For each old bookmark, check if both sides changed it
  for (const old of oldActive) {
    const oldKey = bookmarkKey(old);

    // Find what local did to this bookmark
    const localUnchanged = localChanges.unchanged.find((u) =>
      bookmarksEqual(u.old, old),
    );
    const localModified = localChanges.modified.find((m) =>
      bookmarksEqual(m.old, old),
    );
    const localDeleted = localChanges.deleted.find((d) =>
      bookmarksEqual(d.old, old),
    );

    // Find what remote did to this bookmark
    const remoteUnchanged = remoteChanges.unchanged.find((u) =>
      bookmarksEqual(u.old, old),
    );
    const remoteModified = remoteChanges.modified.find((m) =>
      bookmarksEqual(m.old, old),
    );
    const remoteDeleted = remoteChanges.deleted.find((d) =>
      bookmarksEqual(d.old, old),
    );

    // Case: Local deleted, remote modified → conflict (unless only index changed)
    if (localDeleted && remoteModified) {
      const remoteDiff = findDifferingAttribute(old, remoteModified.current);
      // Index-only change is a side effect, not an intentional edit
      // No conflict - deletion wins
      if (remoteDiff !== "index") {
        conflicts.push({
          type: "delete_vs_edit",
          bookmark: old,
          localAction: "deleted",
          remoteAction: "modified",
          remoteVersion: remoteModified.current,
        });
        conflictedOldKeys.add(oldKey);
        continue;
      }
    }

    // Case: Local modified, remote deleted → conflict (unless only index changed)
    if (localModified && remoteDeleted) {
      const localDiff = findDifferingAttribute(old, localModified.current);
      // Index-only change is a side effect (e.g., another bookmark added before this one)
      // Not an intentional edit, so no conflict - deletion wins
      if (localDiff !== "index") {
        conflicts.push({
          type: "delete_vs_edit",
          bookmark: old,
          localAction: "modified",
          remoteAction: "deleted",
          localVersion: localModified.current,
        });
        conflictedOldKeys.add(oldKey);
        continue;
      }
    }

    // Case: Both modified → check if same or different change
    if (localModified && remoteModified) {
      const localCurrent = localModified.current;
      const remoteCurrent = remoteModified.current;

      if (bookmarksEqual(localCurrent, remoteCurrent)) {
        // Same change - no conflict
        continue;
      }

      // Different changes - check which attributes differ
      const localDiff = findDifferingAttribute(old, localCurrent);
      const remoteDiff = findDifferingAttribute(old, remoteCurrent);

      if (localDiff && remoteDiff && localDiff !== remoteDiff) {
        // Different attributes changed - can merge, no conflict
        continue;
      }

      // Same attribute changed differently → conflict
      conflicts.push({
        type: "edit_conflict",
        bookmark: old,
        localVersion: localCurrent,
        remoteVersion: remoteCurrent,
        attribute: localDiff || remoteDiff,
      });
      conflictedOldKeys.add(oldKey);
    }
  }

  // Check for add conflicts (both added similar but different bookmark)
  for (const localAdd of localChanges.added) {
    const remoteMatch = find3of4(localAdd, remoteChanges.added);
    if (remoteMatch && !bookmarksEqual(localAdd, remoteMatch)) {
      // Both added similar bookmark with differences
      // Check if this is actually an edit of an old bookmark
      const oldMatch = find3of4(localAdd, oldActive);
      if (oldMatch) {
        // This is edit conflict, already handled above
        continue;
      }

      conflicts.push({
        type: "add_conflict",
        localVersion: localAdd,
        remoteVersion: remoteMatch,
      });
    }
  }

  // ----------------------------------------
  // PASS 3: Build newState (excluding conflicts)
  // ----------------------------------------

  const newState = [];
  const addedKeys = new Set();

  // Process old bookmarks
  for (const old of oldActive) {
    const oldKey = bookmarkKey(old);

    // Skip if conflicted
    if (conflictedOldKeys.has(oldKey)) continue;

    const localUnchanged = localChanges.unchanged.find((u) =>
      bookmarksEqual(u.old, old),
    );
    const localModified = localChanges.modified.find((m) =>
      bookmarksEqual(m.old, old),
    );
    const localDeleted = localChanges.deleted.find((d) =>
      bookmarksEqual(d.old, old),
    );

    const remoteUnchanged = remoteChanges.unchanged.find((u) =>
      bookmarksEqual(u.old, old),
    );
    const remoteModified = remoteChanges.modified.find((m) =>
      bookmarksEqual(m.old, old),
    );
    const remoteDeleted = remoteChanges.deleted.find((d) =>
      bookmarksEqual(d.old, old),
    );

    // Both unchanged
    if (localUnchanged && remoteUnchanged) {
      newState.push(old);
      addedKeys.add(bookmarkKey(old));
      continue;
    }

    // Both deleted
    if (localDeleted && remoteDeleted) {
      newState.push(createTombstone(old));
      continue;
    }

    // Local unchanged, remote modified
    if (localUnchanged && remoteModified) {
      newState.push(remoteModified.current);
      addedKeys.add(bookmarkKey(remoteModified.current));
      continue;
    }

    // Local unchanged, remote deleted
    if (localUnchanged && remoteDeleted) {
      newState.push(createTombstone(old));
      continue;
    }

    // Local modified, remote unchanged
    if (localModified && remoteUnchanged) {
      newState.push(localModified.current);
      addedKeys.add(bookmarkKey(localModified.current));
      continue;
    }

    // Local deleted, remote unchanged
    if (localDeleted && remoteUnchanged) {
      newState.push(createTombstone(old));
      continue;
    }

    // Both modified (same change or mergeable - conflicts already filtered)
    if (localModified && remoteModified) {
      const localCurrent = localModified.current;
      const remoteCurrent = remoteModified.current;

      if (bookmarksEqual(localCurrent, remoteCurrent)) {
        newState.push(localCurrent);
        addedKeys.add(bookmarkKey(localCurrent));
      } else {
        // Merge different attributes
        const merged = { ...old };
        const localDiff = findDifferingAttribute(old, localCurrent);
        const remoteDiff = findDifferingAttribute(old, remoteCurrent);

        if (localDiff === "title") merged.title = localCurrent.title;
        if (localDiff === "url") merged.url = localCurrent.url;
        if (localDiff === "path") merged.path = localCurrent.path;
        if (localDiff === "index") merged.index = localCurrent.index;

        if (remoteDiff === "title") merged.title = remoteCurrent.title;
        if (remoteDiff === "url") merged.url = remoteCurrent.url;
        if (remoteDiff === "path") merged.path = remoteCurrent.path;
        if (remoteDiff === "index") merged.index = remoteCurrent.index;

        newState.push(merged);
        addedKeys.add(bookmarkKey(merged));
      }
      continue;
    }

    // Local modified, remote deleted OR local deleted, remote modified
    // These are conflicts, already handled above
  }

  // Process local additions
  for (const localAdd of localChanges.added) {
    const key = bookmarkKey(localAdd);
    if (addedKeys.has(key)) continue;

    // Check if conflicts with remote add
    const hasConflict = conflicts.some(
      (c) =>
        c.type === "add_conflict" && bookmarksEqual(c.localVersion, localAdd),
    );
    if (hasConflict) continue;

    // Check if remote has exact same
    const remoteExact = findExact(localAdd, remoteActive);
    if (remoteExact) {
      newState.push(localAdd);
      addedKeys.add(key);
      continue;
    }

    // Check if remote deleted this
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

    // Check if conflicts with local add
    const hasConflict = conflicts.some(
      (c) =>
        c.type === "add_conflict" && bookmarksEqual(c.remoteVersion, remoteAdd),
    );
    if (hasConflict) continue;

    // Check if local deleted this
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
  const { newState, conflicts } = mergeStates(
    oldRemoteState || [],
    currentLocalState || [],
    currentRemoteState || [],
  );

  // Step 2: Diff currentLocalState vs newState → localChanges
  const localChanges = diffStates(currentLocalState || [], newState);

  // Step 3: Diff currentRemoteState vs newState → remoteChanges
  const remoteChanges = diffStates(currentRemoteState || [], newState);

  return {
    localChanges,
    remoteChanges,
    conflicts,
    newState,
  };
}

// ============================================
// FOLDER CONFLICT DETECTION
// ============================================

/**
 * Detect folder-level conflicts (folder deleted on one side, OLD content modified on other)
 *
 * NOT a conflict:
 * - Folder deleted + NEW content added -> folder recreated with new content
 *
 * IS a conflict:
 * - Folder deleted + OLD content modified -> user must choose
 */
function detectFolderConflicts(
  oldRemoteState,
  currentLocalState,
  currentRemoteState,
) {
  // New content in a deleted folder is NOT a conflict - folder gets recreated
  // Only conflict if OLD content was modified (not just present)
  // For now, return empty - new content means folder survives
  return [];
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
    arraysEqual,
    bookmarkKey,
    match3of4,
    bookmarksEqual,
    findExact,
    find3of4,
    isTombstone,
    isFolder,
    getActive,
    getTombstones,
    createTombstone,
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
  arraysEqual,
  bookmarkKey,
  match3of4,
  bookmarksEqual,
  findExact,
  find3of4,
  isTombstone,
  isFolder,
  getActive,
  getTombstones,
  createTombstone,
  pathStartsWith,
  getBookmarksInFolder,
  findDifferingAttribute,
});
