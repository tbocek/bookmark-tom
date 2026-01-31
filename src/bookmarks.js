/**
 * Browser bookmark operations
 * Functions for reading, modifying, and managing local bookmarks
 */

// ============================================
// HELPERS
// ============================================

function arraysEqual(arr1, arr2) {
  if (!arr1 && !arr2) return true;
  if (!arr1 || !arr2) return false;
  if (arr1.length !== arr2.length) return false;
  return arr1.every((val, idx) => val === arr2[idx]);
}

// ============================================
// READ OPERATIONS
// ============================================

/**
 * Get the path array for a bookmark's parent
 */
async function getBookmarkPath(parentId) {
  const path = [];
  let currentId = parentId;
  while (currentId) {
    try {
      const [node] = await browser.bookmarks.get(currentId);
      if (node.title) {
        path.unshift(node.title);
      }
      currentId = node.parentId;
    } catch (e) {
      break;
    }
  }
  return path;
}

/**
 * Recursively retrieve bookmarks in flat format with paths
 */
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

/**
 * Get a snapshot of all local bookmarks
 */
async function getLocalBookmarksSnapshot() {
  const bookmarkTreeNodes = await browser.bookmarks.getTree();
  return retrieveLocalBookmarks(bookmarkTreeNodes);
}

/**
 * Find a bookmark ID by its properties
 */
async function locateBookmarkId(url, title, index, pathArray) {
  let searchResults;

  if (url) {
    try {
      searchResults = await browser.bookmarks.search({ url: url });

      if (searchResults.length === 0) {
        searchResults = await browser.bookmarks.search({ query: url });
      }

      if (searchResults.length === 0) {
        const decodedUrl = decodeURIComponent(url);
        searchResults = await browser.bookmarks.search({ query: decodedUrl });
      }
    } catch (error) {
      console.error("Error searching by URL:", error);
      if (title) {
        searchResults = await browser.bookmarks.search({ title });
      } else {
        return null;
      }
    }
  } else if (title) {
    searchResults = await browser.bookmarks.search({ title });
  } else {
    throw new Error(`No bookmark found for ${url}/${title}`);
  }

  for (const bookmark of searchResults) {
    if (
      bookmark.title === title &&
      (index === null || bookmark.index === index) &&
      (url === null || bookmark.url === url)
    ) {
      let currentNode = bookmark;
      let currentPath = [];
      while (currentNode.parentId) {
        const parentNode = await browser.bookmarks.get(currentNode.parentId);
        currentNode = parentNode[0];
        if (currentNode.title) {
          currentPath.unshift(currentNode.title);
        }
      }
      if (arraysEqual(currentPath, pathArray)) {
        return bookmark.id;
      }
    }
  }

  return null;
}

/**
 * Find or create parent folder ID for a path
 */
async function locateParentId(pathArray, createIfMissing = false) {
  if (!pathArray || pathArray.length === 0) {
    const bookmarkTree = await browser.bookmarks.getTree();
    return bookmarkTree[0].id;
  }

  const bookmarkTree = await browser.bookmarks.getTree();

  function searchTree(nodes, pathParts) {
    if (pathParts.length === 0) {
      return nodes[0].id;
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

  let parentId = searchTree(bookmarkTree[0].children, pathArray);

  if (!parentId && createIfMissing) {
    parentId = await createFolderPath(pathArray);
  }

  return parentId;
}

// ============================================
// WRITE OPERATIONS
// ============================================

/**
 * Create folder hierarchy for a given path
 * @param {Function} removeLocalTombstonesForPath - Optional function to remove tombstones when folder is created
 */
async function createFolderPath(
  pathArray,
  removeLocalTombstonesForPath = null,
) {
  const bookmarkTree = await browser.bookmarks.getTree();
  let currentParentId = bookmarkTree[0].children[0].id;

  for (const root of bookmarkTree[0].children) {
    if (root.title === pathArray[0]) {
      currentParentId = root.id;
      break;
    }
  }

  for (let i = 0; i < pathArray.length; i++) {
    const folderName = pathArray[i];

    const children = await browser.bookmarks.getChildren(currentParentId);
    let found = null;
    for (const child of children) {
      if (child.title === folderName && !child.url) {
        found = child;
        break;
      }
    }

    if (found) {
      currentParentId = found.id;
    } else {
      const newFolder = await browser.bookmarks.create({
        parentId: currentParentId,
        title: folderName,
      });
      currentParentId = newFolder.id;

      if (removeLocalTombstonesForPath) {
        const folderPath = pathArray.slice(0, i + 1);
        await removeLocalTombstonesForPath(folderPath);
      }
    }
  }

  return currentParentId;
}

/**
 * Apply deletions and insertions to local bookmarks
 * @param {Array} delBookmarks - Bookmarks to delete
 * @param {Array} insBookmarks - Bookmarks to insert
 * @param {Array} updates - Bookmark updates
 * @param {Function} removeLocalTombstonesForPath - Optional function to remove tombstones
 */
async function modifyLocalBookmarks(
  delBookmarks,
  insBookmarks,
  updates = [],
  removeLocalTombstonesForPath = null,
) {
  try {
    // Sort deletions to handle contents before folders
    const sortedDeletions = [...delBookmarks].sort((a, b) => {
      const aIsFolder = !a.url;
      const bIsFolder = !b.url;
      if (aIsFolder !== bIsFolder) {
        return aIsFolder ? 1 : -1;
      }
      return b.path.length - a.path.length;
    });

    // Delete bookmarks
    for (const delBookmark of sortedDeletions) {
      const isFolder = !delBookmark.url;

      if (isFolder) {
        const folderPath = [...delBookmark.path, delBookmark.title];

        const hasNewInsert = insBookmarks.some((ins) => {
          if (ins.path.length >= folderPath.length) {
            return folderPath.every((segment, i) => ins.path[i] === segment);
          }
          return false;
        });

        const hasNewUpdate = updates.some((upd) => {
          const newPath = upd.newBookmark?.path || [];
          if (newPath.length >= folderPath.length) {
            return folderPath.every((segment, i) => newPath[i] === segment);
          }
          return false;
        });

        if (hasNewInsert || hasNewUpdate) {
          console.log(
            "Skipping folder deletion - new content targets folder:",
            delBookmark.title,
          );
          if (removeLocalTombstonesForPath) {
            await removeLocalTombstonesForPath(folderPath);
          }
          continue;
        }
      }

      const id = await locateBookmarkId(
        delBookmark.url,
        delBookmark.title,
        null,
        delBookmark.path,
      );
      try {
        if (id) {
          if (isFolder) {
            await browser.bookmarks.removeTree(id);
          } else {
            await browser.bookmarks.remove(id);
          }
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
      const parentId = await locateParentId(insBookmark.path, true);
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

/**
 * Apply updates to local bookmarks (title, url, index, path changes)
 */
async function applyLocalUpdates(updates) {
  try {
    for (const update of updates) {
      const { oldBookmark, newBookmark, changedAttribute } = update;

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
        await browser.bookmarks.update(id, {
          title: newBookmark.title,
          url: newBookmark.url,
        });
      } else if (changedAttribute === "index") {
        await browser.bookmarks.move(id, { index: newBookmark.index });
      } else if (changedAttribute === "path") {
        const newParentId = await locateParentId(newBookmark.path, true);
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
