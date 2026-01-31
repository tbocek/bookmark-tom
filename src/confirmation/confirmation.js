document.addEventListener("DOMContentLoaded", async function () {
  const storageData = await browser.storage.local.get([
    "localChanges",
    "remoteChanges",
    "action",
    "conflicts",
  ]);
  const { localChanges, remoteChanges, action, conflicts } = storageData;

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
