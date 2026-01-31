document.addEventListener("DOMContentLoaded", async function () {
  const storageData = await browser.storage.local.get([
    "localChanges",
    "remoteChanges",
    "action",
    "conflicts",
  ]);
  const { localChanges, remoteChanges, action, conflicts } = storageData;

  const insertionsDiv = document.getElementById("insertions");
  const deletionsDiv = document.getElementById("deletions");
  const reordersDiv = document.getElementById("reorders");
  const conflictsDiv = document.getElementById("conflicts");
  const directionImg = document.getElementById("direction");
  const normalButtons = document.getElementById("normal-buttons");
  const conflictButtons = document.getElementById("conflict-buttons");

  const spinner1 = document.getElementById("spinner1");

  // Hide direction image for bidirectional sync
  directionImg.classList.add("display-none");

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

  function createReorderListItem(bookmark) {
    const indexSpan = document.createElement("span");
    indexSpan.classList.add("index-change");
    indexSpan.textContent = ` (position: ${bookmark.oldIndex} → ${bookmark.index})`;

    return createBookmarkListItem(bookmark, { afterTitle: indexSpan });
  }

  function createConflictListItem(conflict) {
    const title =
      conflict.local?.title ||
      conflict.remote?.title ||
      conflict.old?.title ||
      "Unknown";
    const url =
      conflict.local?.url || conflict.remote?.url || conflict.old?.url;
    const path =
      conflict.local?.path || conflict.remote?.path || conflict.old?.path || [];

    // Build conflict details
    const detailsDiv = document.createElement("div");
    detailsDiv.classList.add("conflict-details");

    const createDetail = (label, bookmark) => {
      const div = document.createElement("div");
      div.classList.add("conflict-detail");
      const labelSpan = document.createElement("span");
      labelSpan.classList.add("conflict-label");
      labelSpan.textContent = label + ": ";
      div.appendChild(labelSpan);
      if (bookmark) {
        div.appendChild(
          document.createTextNode(
            `"${bookmark.title}" at index ${bookmark.index}`,
          ),
        );
      } else {
        const deletedSpan = document.createElement("span");
        deletedSpan.classList.add("conflict-deleted");
        deletedSpan.textContent = "(deleted)";
        div.appendChild(deletedSpan);
      }
      return div;
    };

    detailsDiv.appendChild(createDetail("Old", conflict.old));
    detailsDiv.appendChild(createDetail("Local", conflict.local));
    detailsDiv.appendChild(createDetail("Remote", conflict.remote));

    return createBookmarkListItem(
      { title, url, path },
      {
        className: "conflict-item",
        boldTitle: true,
        appendContent: detailsDiv,
      },
    );
  }

  // Generic section creator
  function createSection(title, items, itemCreator = createListItem) {
    const section = document.createElement("div");
    const h2 = document.createElement("h2");
    h2.textContent = title;
    section.appendChild(h2);

    const ul = document.createElement("ul");
    items.forEach((item) => ul.appendChild(itemCreator(item)));
    section.appendChild(ul);

    return section;
  }

  // Combine local and remote changes for display
  const allInsertions = [
    ...(localChanges?.insertions || []).map((b) => ({
      ...b,
      direction: "local",
    })),
    ...(remoteChanges?.insertions || []).map((b) => ({
      ...b,
      direction: "remote",
    })),
  ];
  const allDeletions = [
    ...(localChanges?.deletions || []).map((b) => ({
      ...b,
      direction: "local",
    })),
    ...(remoteChanges?.deletions || []).map((b) => ({
      ...b,
      direction: "remote",
    })),
  ];
  const allReorders = [
    ...(localChanges?.updateIndexes || []).map((b) => ({
      ...b,
      direction: "local",
    })),
    ...(remoteChanges?.updateIndexes || []).map((b) => ({
      ...b,
      direction: "remote",
    })),
  ];

  function createDirectionalListItem(bookmark) {
    const directionLabel =
      bookmark.direction === "local" ? " (from remote)" : " (to remote)";
    const span = document.createElement("span");
    span.classList.add("direction-label");
    span.textContent = directionLabel;
    return createBookmarkListItem(bookmark, { afterTitle: span });
  }

  function createDirectionalReorderItem(bookmark) {
    const indexSpan = document.createElement("span");
    indexSpan.classList.add("index-change");
    const directionLabel =
      bookmark.direction === "local" ? " (from remote)" : " (to remote)";
    indexSpan.textContent = ` (position: ${bookmark.oldIndex} → ${bookmark.index})${directionLabel}`;
    return createBookmarkListItem(bookmark, { afterTitle: indexSpan });
  }

  if (allInsertions.length > 0) {
    insertionsDiv.appendChild(
      createSection("Insert:", allInsertions, createDirectionalListItem),
    );
  } else {
    insertionsDiv.remove();
  }

  if (allDeletions.length > 0) {
    deletionsDiv.appendChild(
      createSection("Delete:", allDeletions, createDirectionalListItem),
    );
  } else {
    deletionsDiv.remove();
  }

  if (allReorders.length > 0) {
    reordersDiv.appendChild(
      createSection("Reordered:", allReorders, createDirectionalReorderItem),
    );
  } else {
    reordersDiv.remove();
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
