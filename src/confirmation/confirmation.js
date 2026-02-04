// Check if two bookmarks match for display grouping purposes
// This is used to pair insertions/deletions as "updates" in the UI
function matchForDisplay(a, b) {
  if (!a || !b) return false;

  const pathA = (a.path || []).join("/");
  const pathB = (b.path || []).join("/");

  // For display: match by title + path (for folders) or title + url (for bookmarks)
  // This way, index changes show as "position" updates, not mismatched title changes
  if (a.title === b.title && pathA === pathB) {
    // Same title and path - this is an index or URL change
    return true;
  }

  if (a.title === b.title && (a.url || "") === (b.url || "")) {
    // Same title and URL - this is a path or index change (move)
    return true;
  }

  return false;
}

// Find which attribute differs between two bookmarks
function findChangedAttribute(a, b) {
  if (a.title !== b.title) return "title";
  if ((a.url || "") !== (b.url || "")) return "url";
  const pathA = (a.path || []).join("/");
  const pathB = (b.path || []).join("/");
  if (pathA !== pathB) return "path";
  if (a.index !== b.index) return "index";
  return null;
}

// Convert 3-of-4 matching insert/delete pairs into updates for display
function groupChangesForDisplay(changes) {
  let insertions = [...(changes.insertions || [])];
  let deletions = [...(changes.deletions || [])];
  const updates = [...(changes.updates || [])];

  // Helper to check same title + path (position change)
  const isSameTitlePath = (a, b) => {
    if (a.title !== b.title) return false;
    const pathA = (a.path || []).join("/");
    const pathB = (b.path || []).join("/");
    return pathA === pathB;
  };

  // Helper to check same title + url (move)
  const isSameTitleUrl = (a, b) => {
    return a.title === b.title && (a.url || "") === (b.url || "");
  };

  // PASS 1: Match position changes first (same title + path, different index)
  let remainingInsertions = [];
  for (const ins of insertions) {
    const matchIdx = deletions.findIndex((del) => isSameTitlePath(ins, del));
    if (matchIdx !== -1) {
      const del = deletions.splice(matchIdx, 1)[0];
      const attr = findChangedAttribute(del, ins);
      updates.push({
        oldBookmark: del,
        newBookmark: ins,
        changedAttribute: attr,
      });
    } else {
      remainingInsertions.push(ins);
    }
  }

  // PASS 2: Match moves (same title + url, different path)
  insertions = remainingInsertions;
  remainingInsertions = [];
  for (const ins of insertions) {
    const matchIdx = deletions.findIndex((del) => isSameTitleUrl(ins, del));
    if (matchIdx !== -1) {
      const del = deletions.splice(matchIdx, 1)[0];
      const attr = findChangedAttribute(del, ins);
      updates.push({
        oldBookmark: del,
        newBookmark: ins,
        changedAttribute: attr,
      });
    } else {
      remainingInsertions.push(ins);
    }
  }

  return {
    insertions: remainingInsertions,
    deletions: deletions,
    updates,
  };
}

document.addEventListener("DOMContentLoaded", async function () {
  // Request data from background script via message (not storage)
  const data = await browser.runtime.sendMessage({
    command: "getConfirmationData",
  });
  let { localChanges, remoteChanges, action, conflicts } = data || {};

  // DEBUG: Set to true to log confirmation data
  const debugConfirmation = false;
  if (debugConfirmation) {
    console.log("=== DEBUG: CONFIRMATION PAGE ===");
    console.log("Raw data:", JSON.stringify(data));
    console.log("localChanges BEFORE:", JSON.stringify(localChanges));
    console.log("remoteChanges BEFORE:", JSON.stringify(remoteChanges));
  }

  // Group 3-of-4 matching insert/delete pairs as updates for display
  localChanges = groupChangesForDisplay(localChanges || {});
  remoteChanges = groupChangesForDisplay(remoteChanges || {});

  if (debugConfirmation) {
    console.log("localChanges AFTER:", JSON.stringify(localChanges));
    console.log("remoteChanges AFTER:", JSON.stringify(remoteChanges));
    console.log("=== END DEBUG ===");
  }

  const insertionsLocalDiv = document.getElementById("insertions-local");
  const insertionsRemoteDiv = document.getElementById("insertions-remote");
  const deletionsLocalDiv = document.getElementById("deletions-local");
  const deletionsRemoteDiv = document.getElementById("deletions-remote");
  const updatesLocalDiv = document.getElementById("updates-local");
  const updatesRemoteDiv = document.getElementById("updates-remote");
  const conflictsDiv = document.getElementById("conflicts");
  const normalButtons = document.getElementById("normal-buttons");
  const conflictButtons = document.getElementById("conflict-buttons");

  const spinner1 = document.getElementById("spinner1");

  // Helper to append URL span to a list item
  function appendUrlSpan(li, url) {
    const br = document.createElement("br");
    const span = document.createElement("span");
    span.classList.add("url");
    const a = document.createElement("a");
    a.href = url;
    a.textContent = url;
    span.appendChild(a);
    li.appendChild(br);
    li.appendChild(span);
  }

  // Helper to append path span to a list item
  function appendPathSpan(li, path) {
    const br = document.createElement("br");
    const span = document.createElement("span");
    span.classList.add("path");
    span.textContent = path.join(" > ");
    li.appendChild(br);
    li.appendChild(span);
  }

  // Create a bookmark list item with optional customizations
  function createBookmarkListItem(bookmark, options = {}) {
    const li = document.createElement("li");
    if (options.className) {
      li.classList.add(options.className);
    }

    // Title (bold if specified)
    if (options.boldTitle) {
      const titleSpan = document.createElement("strong");
      titleSpan.textContent = bookmark.title;
      li.appendChild(titleSpan);
    } else {
      li.appendChild(document.createTextNode(bookmark.title));
    }

    // Custom content after title (e.g., index change indicator)
    if (options.afterTitle) {
      li.appendChild(options.afterTitle);
    }

    // URL
    if (bookmark.url) {
      appendUrlSpan(li, bookmark.url);
    }

    // Path
    appendPathSpan(li, bookmark.path);

    // Additional content at the end (e.g., conflict details)
    if (options.appendContent) {
      li.appendChild(options.appendContent);
    }

    return li;
  }

  function createListItem(bookmark) {
    return createBookmarkListItem(bookmark);
  }

  function createUpdateListItem(update) {
    const changeSpan = document.createElement("span");
    changeSpan.classList.add("change-info");

    const attr = update.changedAttribute;
    const oldVal = update.oldBookmark[attr];
    const newVal = update.newBookmark[attr];

    let changeText;
    if (attr === "path") {
      changeText = ` (${attr}: ${oldVal.join(" > ")} → ${newVal.join(" > ")})`;
    } else if (attr === "index") {
      changeText = ` (position: ${oldVal} → ${newVal})`;
    } else {
      changeText = ` (${attr}: ${oldVal} → ${newVal})`;
    }
    changeSpan.textContent = changeText;

    return createBookmarkListItem(update.newBookmark, {
      afterTitle: changeSpan,
    });
  }

  // Helper to create a conflict detail row with label and value
  function createConflictDetail(label, value, suffix = "") {
    const div = document.createElement("div");
    div.classList.add("conflict-detail");

    const labelSpan = document.createElement("span");
    labelSpan.classList.add("conflict-label");
    labelSpan.textContent = label + ":";
    div.appendChild(labelSpan);

    div.appendChild(document.createTextNode(" "));

    const valueSpan = document.createElement("span");
    valueSpan.classList.add("conflict-value");
    valueSpan.textContent = value;
    div.appendChild(valueSpan);

    if (suffix) {
      div.appendChild(document.createTextNode(suffix));
    }

    return div;
  }

  // Helper to create a content item row (indented list item)
  function createContentItem(title) {
    const itemDiv = document.createElement("div");
    itemDiv.classList.add("conflict-detail", "conflict-content-item");
    itemDiv.textContent = "\u00A0\u00A0- " + title;
    return itemDiv;
  }

  function createConflictListItem(conflict) {
    // Handle folder_deleted_remote conflict type (remote deleted folder, local has content)
    if (conflict.type === "folder_deleted_remote") {
      const folder = conflict.folder;
      const folderPath = folder.path || [];

      const detailsDiv = document.createElement("div");
      detailsDiv.classList.add("conflict-details");

      detailsDiv.appendChild(
        createConflictDetail(
          "Folder",
          folder.title,
          " at " + (folderPath.join(" > ") || "(root)"),
        ),
      );
      detailsDiv.appendChild(createConflictDetail("Remote", "(deleted)"));
      detailsDiv.appendChild(
        createConflictDetail(
          "Local",
          conflict.localContent.length + " item(s) inside",
        ),
      );

      if (conflict.localContent.length <= 5) {
        for (const bm of conflict.localContent) {
          detailsDiv.appendChild(createContentItem(bm.title));
        }
      }

      const attrInfo = document.createElement("div");
      attrInfo.classList.add("conflict-attr");
      attrInfo.textContent = "(remote deleted folder vs. your local content)";
      detailsDiv.appendChild(attrInfo);

      return createBookmarkListItem(
        { title: folder.title, path: folderPath },
        {
          className: "conflict-item",
          boldTitle: true,
          appendContent: detailsDiv,
        },
      );
    }

    // Handle folder_deleted_local conflict type (local deleted folder, remote has content)
    if (conflict.type === "folder_deleted_local") {
      const folder = conflict.folder;
      const folderPath = folder.path || [];

      const detailsDiv = document.createElement("div");
      detailsDiv.classList.add("conflict-details");

      detailsDiv.appendChild(
        createConflictDetail(
          "Folder",
          folder.title,
          " at " + (folderPath.join(" > ") || "(root)"),
        ),
      );
      detailsDiv.appendChild(
        createConflictDetail("Local", "(you deleted this)"),
      );
      detailsDiv.appendChild(
        createConflictDetail(
          "Remote",
          conflict.remoteContent.length + " item(s) inside",
        ),
      );

      if (conflict.remoteContent.length <= 5) {
        for (const bm of conflict.remoteContent) {
          detailsDiv.appendChild(createContentItem(bm.title));
        }
      }

      const attrInfo = document.createElement("div");
      attrInfo.classList.add("conflict-attr");
      attrInfo.textContent = "(you deleted folder vs. remote content)";
      detailsDiv.appendChild(attrInfo);

      return createBookmarkListItem(
        { title: folder.title, path: folderPath },
        {
          className: "conflict-item",
          boldTitle: true,
          appendContent: detailsDiv,
        },
      );
    }

    // Handle delete_vs_edit conflict type
    if (conflict.type === "delete_vs_edit") {
      const bookmark = conflict.bookmark;
      const localVersion = conflict.localVersion;
      const remoteVersion = conflict.remoteVersion;

      const detailsDiv = document.createElement("div");
      detailsDiv.classList.add("conflict-details");

      if (conflict.localAction === "deleted") {
        // Local deleted, remote modified
        detailsDiv.appendChild(createConflictDetail("Local", "(deleted)"));
        detailsDiv.appendChild(
          createConflictDetail(
            "Remote",
            '"' + (remoteVersion?.title || bookmark.title) + '"',
          ),
        );
      } else {
        // Local modified, remote deleted
        detailsDiv.appendChild(
          createConflictDetail(
            "Local",
            '"' + (localVersion?.title || bookmark.title) + '"',
          ),
        );
        detailsDiv.appendChild(createConflictDetail("Remote", "(deleted)"));
      }

      const attrInfo = document.createElement("div");
      attrInfo.classList.add("conflict-attr");
      attrInfo.textContent = "(edit vs. delete conflict)";
      detailsDiv.appendChild(attrInfo);

      return createBookmarkListItem(
        { title: bookmark.title, url: bookmark.url, path: bookmark.path },
        {
          className: "conflict-item",
          boldTitle: true,
          appendContent: detailsDiv,
        },
      );
    }

    // Regular bookmark conflict (edit_conflict, add_conflict)
    // Handle both old format (local/remote) and new format (localVersion/remoteVersion)
    const local = conflict.local || conflict.localVersion;
    const remote = conflict.remote || conflict.remoteVersion;
    const title =
      local?.title || remote?.title || conflict.bookmark?.title || "Unknown";
    const url = local?.url || remote?.url || conflict.bookmark?.url;
    const path = local?.path || remote?.path || conflict.bookmark?.path || [];
    const attr = conflict.changedAttribute || conflict.attribute;

    // Build conflict details showing what differs
    const detailsDiv = document.createElement("div");
    detailsDiv.classList.add("conflict-details");

    const createDetail = (label, bookmark, highlightAttr) => {
      const div = document.createElement("div");
      div.classList.add("conflict-detail");
      const labelSpan = document.createElement("span");
      labelSpan.classList.add("conflict-label");
      labelSpan.textContent = label + ": ";
      div.appendChild(labelSpan);

      if (bookmark) {
        let valueText;
        if (highlightAttr === "path") {
          valueText = bookmark.path?.join(" > ") || "(root)";
        } else if (highlightAttr) {
          valueText = bookmark[highlightAttr] || "(empty)";
        } else {
          valueText = `"${bookmark.title}"`;
        }
        const valueSpan = document.createElement("span");
        valueSpan.classList.add("conflict-value");
        valueSpan.textContent = valueText;
        div.appendChild(valueSpan);
      }
      return div;
    };

    // Show the changed attribute for both local and remote
    detailsDiv.appendChild(createDetail("Local", local, attr));
    detailsDiv.appendChild(createDetail("Remote", remote, attr));

    // Add info about which attribute differs
    const attrInfo = document.createElement("div");
    attrInfo.classList.add("conflict-attr");
    attrInfo.textContent = `(${attr} differs)`;
    detailsDiv.appendChild(attrInfo);

    return createBookmarkListItem(
      { title, url, path },
      {
        className: "conflict-item",
        boldTitle: true,
        appendContent: detailsDiv,
      },
    );
  }

  // Generic section creator with optional icon
  function createSection(
    title,
    items,
    itemCreator = createListItem,
    iconSrc = null,
  ) {
    const section = document.createElement("div");
    const h2 = document.createElement("h2");

    if (iconSrc) {
      const icon = document.createElement("img");
      icon.src = iconSrc;
      icon.alt = title;
      icon.classList.add("direction-icon");
      h2.appendChild(icon);
      h2.appendChild(document.createTextNode(" " + title));
    } else {
      h2.textContent = title;
    }
    section.appendChild(h2);

    const ul = document.createElement("ul");
    items.forEach((item) => ul.appendChild(itemCreator(item)));
    section.appendChild(ul);

    return section;
  }

  // Separate changes by direction
  // local = from remote to local (cloud2machine)
  // remote = from local to remote (machine2cloud)
  const insertionsLocal = localChanges?.insertions || [];
  const insertionsRemote = remoteChanges?.insertions || [];
  const deletionsLocal = localChanges?.deletions || [];
  const deletionsRemote = remoteChanges?.deletions || [];
  const updatesLocal = localChanges?.updates || [];
  const updatesRemote = remoteChanges?.updates || [];

  // Group position-only updates by folder path
  function groupPositionUpdates(updates) {
    const positionUpdates = updates.filter(
      (u) => u.changedAttribute === "index",
    );
    const otherUpdates = updates.filter((u) => u.changedAttribute !== "index");

    // Group position updates by path
    const byPath = {};
    for (const update of positionUpdates) {
      const pathKey = (update.newBookmark.path || []).join(" > ") || "(root)";
      if (!byPath[pathKey]) {
        byPath[pathKey] = [];
      }
      byPath[pathKey].push(update);
    }

    // Convert grouped updates to summary items
    const groupedItems = Object.entries(byPath).map(([pathKey, items]) => ({
      type: "position_group",
      path: pathKey,
      count: items.length,
    }));

    return { otherUpdates, groupedItems };
  }

  function createUpdateItem(update) {
    // Handle grouped position updates
    if (update.type === "position_group") {
      const li = document.createElement("li");
      const pathSpan = document.createElement("span");
      pathSpan.classList.add("path");
      pathSpan.textContent = update.path;
      li.appendChild(pathSpan);

      const changeSpan = document.createElement("span");
      changeSpan.classList.add("change-info");
      changeSpan.textContent = ` (${update.count} position changes)`;
      li.appendChild(changeSpan);

      return li;
    }

    const changeSpan = document.createElement("span");
    changeSpan.classList.add("change-info");

    const attr = update.changedAttribute;
    const oldVal = update.oldBookmark[attr];
    const newVal = update.newBookmark[attr];

    let changeText;
    if (attr === "path") {
      changeText = ` (${attr}: ${oldVal.join(" > ")} → ${newVal.join(" > ")})`;
    } else if (attr === "index") {
      changeText = ` (position: ${oldVal} → ${newVal})`;
    } else {
      changeText = ` (${attr}: ${oldVal} → ${newVal})`;
    }
    changeSpan.textContent = changeText;

    return createBookmarkListItem(update.newBookmark, {
      afterTitle: changeSpan,
    });
  }

  const cloud2machine = "../icons/cloud2machine.svg";
  const machine2cloud = "../icons/machine2cloud.svg";

  // Insertions
  if (insertionsLocal.length > 0) {
    insertionsLocalDiv.appendChild(
      createSection("Insert:", insertionsLocal, createListItem, cloud2machine),
    );
  } else {
    insertionsLocalDiv.remove();
  }

  if (insertionsRemote.length > 0) {
    insertionsRemoteDiv.appendChild(
      createSection("Insert:", insertionsRemote, createListItem, machine2cloud),
    );
  } else {
    insertionsRemoteDiv.remove();
  }

  // Deletions
  if (deletionsLocal.length > 0) {
    deletionsLocalDiv.appendChild(
      createSection("Delete:", deletionsLocal, createListItem, cloud2machine),
    );
  } else {
    deletionsLocalDiv.remove();
  }

  if (deletionsRemote.length > 0) {
    deletionsRemoteDiv.appendChild(
      createSection("Delete:", deletionsRemote, createListItem, machine2cloud),
    );
  } else {
    deletionsRemoteDiv.remove();
  }

  // Updates - group position changes by folder
  const { otherUpdates: otherUpdatesLocal, groupedItems: groupedLocal } =
    groupPositionUpdates(updatesLocal);
  const { otherUpdates: otherUpdatesRemote, groupedItems: groupedRemote } =
    groupPositionUpdates(updatesRemote);

  const allUpdatesLocal = [...otherUpdatesLocal, ...groupedLocal];
  const allUpdatesRemote = [...otherUpdatesRemote, ...groupedRemote];

  if (allUpdatesLocal.length > 0) {
    updatesLocalDiv.appendChild(
      createSection(
        "Update:",
        allUpdatesLocal,
        createUpdateItem,
        cloud2machine,
      ),
    );
  } else {
    updatesLocalDiv.remove();
  }

  if (allUpdatesRemote.length > 0) {
    updatesRemoteDiv.appendChild(
      createSection(
        "Update:",
        allUpdatesRemote,
        createUpdateItem,
        machine2cloud,
      ),
    );
  } else {
    updatesRemoteDiv.remove();
  }

  if (conflicts && conflicts.length > 0) {
    conflictsDiv.appendChild(
      createSection("Conflicts:", conflicts, createConflictListItem),
    );
    // Show conflict buttons, hide normal buttons
    normalButtons.classList.add("display-none");
    conflictButtons.classList.remove("display-none");
  } else {
    conflictsDiv.remove();
  }

  // Helper to show spinner
  function showSpinner(spinner) {
    spinner.classList.remove("hidden");
  }

  // Normal action buttons
  document
    .getElementById("confirm-force")
    .addEventListener("click", function () {
      showSpinner(spinner1);
      browser.runtime.sendMessage({ action: "Sync" });
    });

  document.getElementById("cancel").addEventListener("click", function () {
    browser.runtime.sendMessage({ action: "cancelChanges" });
  });

  // Conflict resolution buttons
  const spinner4 = document.getElementById("spinner4");
  const spinner5 = document.getElementById("spinner5");

  document
    .getElementById("conflict-local")
    .addEventListener("click", function () {
      showSpinner(spinner4);
      browser.runtime.sendMessage({ action: "Conflict-local" });
    });

  document
    .getElementById("conflict-remote")
    .addEventListener("click", function () {
      showSpinner(spinner5);
      browser.runtime.sendMessage({ action: "Conflict-remote" });
    });

  document
    .getElementById("conflict-cancel")
    .addEventListener("click", function () {
      browser.runtime.sendMessage({ action: "cancelChanges" });
    });
});
