/**
 * Storage operations for bookmark sync
 * Handles change log, bookmark ID map, tombstones, and sync state
 */

// Import helpers (these will be available when loaded as script)
// In module context, these would be imported from sync.js

// ============================================
// BOOKMARK ID MAP
// ============================================

async function getBookmarkIdMap() {
  const storage = await browser.storage.local.get(["bookmarkIdMap"]);
  return storage.bookmarkIdMap || {};
}

async function saveBookmarkIdMap(bookmarkIdMap) {
  await browser.storage.local.set({ bookmarkIdMap });
}

async function initializeBookmarkIdMap() {
  const bookmarkTreeNodes = await browser.bookmarks.getTree();
  const bookmarkIdMap = {};

  async function walkTree(nodes, path = []) {
    for (const node of nodes) {
      if (node.id) {
        bookmarkIdMap[node.id] = {
          title: node.title || "",
          path: path,
          url: node.url,
          index: node.index,
        };
      }

      if (node.children) {
        const childPath = node.title ? [...path, node.title] : path;
        await walkTree(node.children, childPath);
      }
    }
  }

  await walkTree(bookmarkTreeNodes);
  await saveBookmarkIdMap(bookmarkIdMap);
}

// ============================================
// CHANGE LOG
// ============================================

async function getChangeLog() {
  const storage = await browser.storage.local.get(["changeLog"]);
  return storage.changeLog || [];
}

async function saveChangeLog(changeLog) {
  await browser.storage.local.set({ changeLog });
}

async function clearChangeLog() {
  await browser.storage.local.set({ changeLog: [] });
}

/**
 * Record a local change
 * @param {string} type - 'created', 'changed', 'moved', 'removed'
 * @param {string} bookmarkId - Browser bookmark ID
 * @param {Object} info - Change info from browser event
 * @param {Function} getBookmarkPath - Function to get bookmark path from parentId
 * @param {boolean} syncInProgress - Whether sync is in progress (skip recording if true)
 */
async function recordChange(
  type,
  bookmarkId,
  info,
  getBookmarkPath,
  syncInProgress,
) {
  if (syncInProgress) {
    return;
  }

  const bookmarkIdMap = await getBookmarkIdMap();
  const changeLog = await getChangeLog();

  const entry = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    type,
    bookmarkId,
    bookmark: null,
    oldValues: null,
  };

  switch (type) {
    case "created": {
      const path = await getBookmarkPath(info.parentId);
      entry.bookmark = {
        title: info.title,
        path: path,
        url: info.url,
        index: info.index,
      };
      bookmarkIdMap[bookmarkId] = entry.bookmark;
      break;
    }

    case "changed": {
      const oldBookmark = bookmarkIdMap[bookmarkId];
      if (oldBookmark) {
        entry.oldValues = { ...oldBookmark };
        entry.bookmark = {
          ...oldBookmark,
          title: info.title ?? oldBookmark.title,
          url: info.url ?? oldBookmark.url,
        };
        bookmarkIdMap[bookmarkId] = entry.bookmark;
      } else {
        try {
          const [bm] = await browser.bookmarks.get(bookmarkId);
          const path = await getBookmarkPath(bm.parentId);
          entry.bookmark = {
            title: bm.title,
            path: path,
            url: bm.url,
            index: bm.index,
          };
          bookmarkIdMap[bookmarkId] = entry.bookmark;
        } catch (e) {
          // Can't get bookmark info
        }
      }
      break;
    }

    case "moved": {
      const oldBm = bookmarkIdMap[bookmarkId];
      const newPath = await getBookmarkPath(info.parentId);
      const oldPath = await getBookmarkPath(info.oldParentId);
      if (oldBm) {
        entry.oldValues = { path: oldPath, index: info.oldIndex };
        entry.bookmark = {
          ...oldBm,
          path: newPath,
          index: info.index,
        };
        bookmarkIdMap[bookmarkId] = entry.bookmark;
      } else {
        try {
          const [bm] = await browser.bookmarks.get(bookmarkId);
          entry.bookmark = {
            title: bm.title,
            path: newPath,
            url: bm.url,
            index: info.index,
          };
          entry.oldValues = { path: oldPath, index: info.oldIndex };
          bookmarkIdMap[bookmarkId] = entry.bookmark;
        } catch (e) {
          // Can't get bookmark info
        }
      }
      break;
    }

    case "removed": {
      const oldBm = bookmarkIdMap[bookmarkId];
      if (oldBm) {
        entry.bookmark = oldBm;
      } else {
        const path = await getBookmarkPath(info.parentId);
        entry.bookmark = {
          title: info.node.title,
          path: path,
          url: info.node.url,
          index: info.index,
        };
      }
      delete bookmarkIdMap[bookmarkId];
      break;
    }
  }

  if (entry.bookmark) {
    changeLog.push(entry);
    await saveChangeLog(changeLog);
  }
  await saveBookmarkIdMap(bookmarkIdMap);
}

// ============================================
// TOMBSTONES
// ============================================

async function getLocalTombstones() {
  const storage = await browser.storage.local.get(["tombstones"]);
  return storage.tombstones || [];
}

async function saveLocalTombstones(tombstones) {
  await browser.storage.local.set({ tombstones });
}

/**
 * Add a local tombstone
 * @param {Object} bookmark - Bookmark to create tombstone for
 * @param {Function} createTombstone - Function to create tombstone object
 * @param {Function} match3of4 - Function to check 3-of-4 match
 */
async function addLocalTombstone(bookmark, createTombstone, match3of4) {
  const tombstones = await getLocalTombstones();
  const exists = tombstones.some((t) => match3of4(bookmark, t));
  if (!exists) {
    tombstones.push(createTombstone(bookmark));
    await saveLocalTombstones(tombstones);
  }
}

/**
 * Add an already-created tombstone to local storage
 * @param {Object} tombstone - The tombstone object (already created via calcMove/createTombstone)
 * @param {Function} match3of4 - Function to check 3-of-4 match
 */
async function addLocalTombstoneDirectly(tombstone, match3of4) {
  const tombstones = await getLocalTombstones();
  const exists = tombstones.some((t) => match3of4(tombstone, t));
  if (!exists) {
    tombstones.push(tombstone);
    await saveLocalTombstones(tombstones);
  }
}

/**
 * Remove tombstones for a folder path (when folder is revived)
 * @param {Array} pathArray - Folder path
 * @param {Function} arraysEqual - Function to compare arrays
 */
async function removeLocalTombstonesForPath(pathArray, arraysEqual) {
  const tombstones = await getLocalTombstones();
  const filtered = tombstones.filter((t) => {
    if (arraysEqual(t.path, pathArray)) {
      return false;
    }
    if (t.path && t.path.length > pathArray.length) {
      const isInside = pathArray.every((segment, i) => t.path[i] === segment);
      if (isInside) {
        return false;
      }
    }
    return true;
  });
  if (filtered.length !== tombstones.length) {
    await saveLocalTombstones(filtered);
  }
}

// ============================================
// LAST SYNCED STATE
// ============================================

async function getLastSyncedState() {
  const storage = await browser.storage.local.get(["lastSyncedState"]);
  return storage.lastSyncedState || [];
}

async function saveLastSyncedState(state) {
  await browser.storage.local.set({
    lastSyncedState: state,
    lastSyncTimestamp: Date.now(),
  });
}
