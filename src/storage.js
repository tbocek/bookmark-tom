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

/**
 * Update bookmarkIdMap when a local change occurs
 * @param {string} type - 'created', 'changed', 'moved', 'removed'
 * @param {string} bookmarkId - Browser bookmark ID
 * @param {Object} info - Change info from browser event
 * @param {Function} getBookmarkPath - Function to get bookmark path from parentId
 * @param {boolean} syncInProgress - Whether sync is in progress (skip if true)
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

  switch (type) {
    case "created": {
      const path = await getBookmarkPath(info.parentId);
      bookmarkIdMap[bookmarkId] = {
        title: info.title,
        path: path,
        url: info.url,
        index: info.index,
      };
      break;
    }

    case "changed": {
      const oldBookmark = bookmarkIdMap[bookmarkId];
      if (oldBookmark) {
        bookmarkIdMap[bookmarkId] = {
          ...oldBookmark,
          title: info.title ?? oldBookmark.title,
          url: info.url ?? oldBookmark.url,
        };
      } else {
        try {
          const [bm] = await browser.bookmarks.get(bookmarkId);
          const path = await getBookmarkPath(bm.parentId);
          bookmarkIdMap[bookmarkId] = {
            title: bm.title,
            path: path,
            url: bm.url,
            index: bm.index,
          };
        } catch (e) {
          // Can't get bookmark info
        }
      }
      break;
    }

    case "moved": {
      const oldBm = bookmarkIdMap[bookmarkId];
      const newPath = await getBookmarkPath(info.parentId);
      if (oldBm) {
        bookmarkIdMap[bookmarkId] = {
          ...oldBm,
          path: newPath,
          index: info.index,
        };
      } else {
        try {
          const [bm] = await browser.bookmarks.get(bookmarkId);
          bookmarkIdMap[bookmarkId] = {
            title: bm.title,
            path: newPath,
            url: bm.url,
            index: info.index,
          };
        } catch (e) {
          // Can't get bookmark info
        }
      }
      break;
    }

    case "removed": {
      delete bookmarkIdMap[bookmarkId];
      break;
    }
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
  // DEBUG: Uncomment to trace baseline saves
  // console.log("=== DEBUG: saveLastSyncedState ===");
  // console.log("Stack:", new Error().stack);
  // console.log("State:", JSON.stringify(state));

  await browser.storage.local.set({
    lastSyncedState: state,
    lastSyncTimestamp: Date.now(),
  });
}

// ============================================
// DEBUG LOGS
// ============================================

const MAX_DEBUG_LOGS = 3;

async function saveDebugLog(logEntry) {
  const storage = await browser.storage.local.get(["debugLogs"]);
  const logs = storage.debugLogs || [];
  logs.unshift(logEntry); // Add to front
  if (logs.length > MAX_DEBUG_LOGS) {
    logs.length = MAX_DEBUG_LOGS; // Keep only last 3
  }
  await browser.storage.local.set({ debugLogs: logs });
}

async function getDebugLogs() {
  const storage = await browser.storage.local.get(["debugLogs"]);
  return storage.debugLogs || [];
}
