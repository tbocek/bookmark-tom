// Check if two bookmarks match by 3-of-4 attributes, or by title+url (for moves)
function matchForDisplay(a, b) {
  if (!a || !b) return false;

  // Title + URL match = same bookmark (handles moves)
  if (a.title === b.title && (a.url || "") === (b.url || "")) {
    return true;
  }

  // Otherwise use 3-of-4
  let matches = 0;
  if (a.title === b.title) matches++;
  if ((a.url || "") === (b.url || "")) matches++;
  const pathA = (a.path || []).join("/");
  const pathB = (b.path || []).join("/");
  if (pathA === pathB) matches++;
  if (a.index === b.index) matches++;
  return matches >= 3;
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
  const insertions = [...(changes.insertions || [])];
  const deletions = [...(changes.deletions || [])];
  const updates = [...(changes.updates || [])];

  const remainingInsertions = [];
  const remainingDeletions = [];

  // For each insertion, try to find a matching deletion (3-of-4 or title+url)
  for (const ins of insertions) {
    const matchIdx = deletions.findIndex((del) => matchForDisplay(ins, del));
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

  // Remaining deletions that didn't match
  remainingDeletions.push(...deletions);

  return {
    insertions: remainingInsertions,
    deletions: remainingDeletions,
    updates,
  };
}

document.addEventListener("DOMContentLoaded", async function () {
  // Request data from background script via message (not storage)
  const data = await browser.runtime.sendMessage({
    command: "getConfirmationData",
  });
  let { localChanges, remoteChanges, action, conflicts } = data || {};

  // Group 3-of-4 matching insert/delete pairs as updates for display
  localChanges = groupChangesForDisplay(localChanges || {});
  remoteChanges = groupChangesForDisplay(remoteChanges || {});

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

  function createConflictListItem(conflict) {
    // Handle folder_deleted_remote conflict type (remote deleted folder, local has content)
    if (conflict.type === "folder_deleted_remote") {
      const folder = conflict.folder;
      const folderPath = folder.path || [];

      const detailsDiv = document.createElement("div");
      detailsDiv.classList.add("conflict-details");

      const folderDiv = document.createElement("div");
      folderDiv.classList.add("conflict-detail");
      folderDiv.innerHTML = `<span class="conflict-label">Folder:</span> <span class="conflict-value">${folder.title}</span> at ${folderPath.join(" > ") || "(root)"}`;
      detailsDiv.appendChild(folderDiv);

      const msgDiv = document.createElement("div");
      msgDiv.classList.add("conflict-detail");
      msgDiv.innerHTML = `<span class="conflict-label">Remote:</span> <span class="conflict-value">(deleted)</span>`;
      detailsDiv.appendChild(msgDiv);

      const contentDiv = document.createElement("div");
      contentDiv.classList.add("conflict-detail");
      contentDiv.innerHTML = `<span class="conflict-label">Local:</span> <span class="conflict-value">${conflict.localContent.length} item(s) inside</span>`;
      detailsDiv.appendChild(contentDiv);

      if (conflict.localContent.length <= 5) {
        for (const bm of conflict.localContent) {
          const itemDiv = document.createElement("div");
          itemDiv.classList.add("conflict-detail", "conflict-content-item");
          itemDiv.innerHTML = `&nbsp;&nbsp;- ${bm.title}`;
          detailsDiv.appendChild(itemDiv);
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

      const folderDiv = document.createElement("div");
      folderDiv.classList.add("conflict-detail");
      folderDiv.innerHTML = `<span class="conflict-label">Folder:</span> <span class="conflict-value">${folder.title}</span> at ${folderPath.join(" > ") || "(root)"}`;
      detailsDiv.appendChild(folderDiv);

      const msgDiv = document.createElement("div");
      msgDiv.classList.add("conflict-detail");
      msgDiv.innerHTML = `<span class="conflict-label">Local:</span> <span class="conflict-value">(you deleted this)</span>`;
      detailsDiv.appendChild(msgDiv);

      const contentDiv = document.createElement("div");
      contentDiv.classList.add("conflict-detail");
      contentDiv.innerHTML = `<span class="conflict-label">Remote:</span> <span class="conflict-value">${conflict.remoteContent.length} item(s) inside</span>`;
      detailsDiv.appendChild(contentDiv);

      if (conflict.remoteContent.length <= 5) {
        for (const bm of conflict.remoteContent) {
          const itemDiv = document.createElement("div");
          itemDiv.classList.add("conflict-detail", "conflict-content-item");
          itemDiv.innerHTML = `&nbsp;&nbsp;- ${bm.title}`;
          detailsDiv.appendChild(itemDiv);
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
        const localDiv = document.createElement("div");
        localDiv.classList.add("conflict-detail");
        localDiv.innerHTML = `<span class="conflict-label">Local:</span> <span class="conflict-value">(deleted)</span>`;
        detailsDiv.appendChild(localDiv);

        const remoteDiv = document.createElement("div");
        remoteDiv.classList.add("conflict-detail");
        remoteDiv.innerHTML = `<span class="conflict-label">Remote:</span> <span class="conflict-value">"${remoteVersion?.title || bookmark.title}"</span>`;
        detailsDiv.appendChild(remoteDiv);
      } else {
        // Local modified, remote deleted
        const localDiv = document.createElement("div");
        localDiv.classList.add("conflict-detail");
        localDiv.innerHTML = `<span class="conflict-label">Local:</span> <span class="conflict-value">"${localVersion?.title || bookmark.title}"</span>`;
        detailsDiv.appendChild(localDiv);

        const remoteDiv = document.createElement("div");
        remoteDiv.classList.add("conflict-detail");
        remoteDiv.innerHTML = `<span class="conflict-label">Remote:</span> <span class="conflict-value">(deleted)</span>`;
        detailsDiv.appendChild(remoteDiv);
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

  function createUpdateItem(update) {
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

  // Updates
  if (updatesLocal.length > 0) {
    updatesLocalDiv.appendChild(
      createSection("Update:", updatesLocal, createUpdateItem, cloud2machine),
    );
  } else {
    updatesLocalDiv.remove();
  }

  if (updatesRemote.length > 0) {
    updatesRemoteDiv.appendChild(
      createSection("Update:", updatesRemote, createUpdateItem, machine2cloud),
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
