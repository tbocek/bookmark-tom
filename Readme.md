# Tom's Bookmark Saver

**What**: Tom's Bookmark Saver is a browser extension designed to synchronize bookmarks between your local browser and a remote WebDAV server. It handles authentication, fetching, updating, and synchronizing of bookmarks to ensure data consistency between local and remote sources. The extension also includes a confirmation interface for reviewing changes before they are applied.

**Why**: Since I have multiple machines which are synchronized with Nextcloud, I also wanted a simple solution for syncing bookmarks. Unfortunately, the export/import feature of Firefox creates files with modified content and a new timestamp, so I ended up with a lot of conflicts. Another option is to use FireFox sync, but this requires yet another account, or alternatively [self-host](https://github.com/mozilla-services/syncstorage-rs) it. Both options are not optimal and I wanted to have something that works with my existing setup. Also, I wanted to try GenAI, so this seems like a good real-world project ([read my findings](Background.md)).

**How**: Plain Javascript with HTML/CSS with ~650 lines of code.

**Limitations**: Since the id of the bookmarks are not exposed via API, detecting changes is a bit cumbersome. Thus, changes of those bookmarks updates are presented to the user for a final check.

[![Tom's Bookmark Saver](https://img.youtube.com/vi/Cs-66kEOFVY/0.jpg)](https://www.youtube.com/watch?v=Cs-66kEOFVY "Tom's Bookmark Saver")

## User Setup
To install the extension, follow these steps:

* Visit the [Tom's Bookmark Saver add-on page](https://addons.mozilla.org/en-US/firefox/addon/tom-s-bookmark-saver/).
* Click on the "Install" button to add the extension to your browser.

### Developer Setup
If you want to extend or run from source, then you can get the sources from GitHub:

```
git clone git@github.com:tbocek/bookmark-tom.git
```
Next, open Firefox and navigate to:
```
about:debugging#/runtime/this-firefox
```
Then, click on "Load Temporary Add-on..." and select the ```manifest.json``` file from the cloned repository. The extension should now be visible in your browser. To apply code changes:
   * Click "Reload".
   * To view logs, click "Inspect". A new window will open where you can see the console logs.

## Extension/Addon Setup
To make this extension/addon work, setup your webdav settings as shown in this screen:

![setup](setup.png)

You can test your configuration before saving it.

### Synchronization

As soon as the config is working (make sure you see no errors in the sync popup). On successful sync, it should look like this:

![popup](popup.png)

If something is wrong, the error message is shown in this popup. One possible issue is that if the file does not exist, it shows an error message. Thus, the file needs to be added manually.

Once, the webdav folder is setup and the fil exists, synchronization can start. Depending on if it is a local sync or remote sync the following screen is shown:

For local changes:

![local](local.png)

For remote changes:

![remote](remote.png)

## Synchronization Algorithm

### Evolution: From 2-Way to 3-Way Sync

#### The Problem with 2-Way Sync

The original implementation used a simple 2-way sync that compared **local bookmarks** with **remote bookmarks**. This worked fine for a single machine but caused problems with multiple machines:

```
2-WAY SYNC:
  Local State  <-->  Remote State
       ↓                  ↓
    Compare and apply changes
```

**Issues with 2-way sync:**
- **No change detection**: Cannot tell if a bookmark was added locally or deleted remotely
- **False conflicts**: Moving a bookmark on Machine A, then syncing Machine B would show a conflict (old position vs new position) even though there's no real conflict
- **Cascading sync loops**: Changes applied during sync would trigger new change events, causing infinite sync loops

#### The 3-Way Sync Solution

The current implementation uses a 3-way merge algorithm with three states:

```
3-WAY SYNC:
  oldRemoteState ──┬── currentLocalState
                   │
                   └── currentRemoteState
                            ↓
                   Calculate merged newState
                            ↓
         ┌──────────────────┴──────────────────┐
         ↓                                     ↓
  localChanges = diff(local, newState)   remoteChanges = diff(remote, newState)
```

**The three states:**
1. **oldRemoteState**: Snapshot of remote at last successful sync (baseline)
2. **currentLocalState**: Current local bookmarks (what the user has now)
3. **currentRemoteState**: Fresh remote state fetched at sync time

By comparing both local and remote against the **same baseline** (oldRemoteState), we can accurately determine:
- What changed locally since last sync
- What changed remotely since last sync
- Whether changes conflict or can be merged

### Bookmark Matching Strategy

The algorithm uses two matching strategies:

#### 4-of-4 Exact Matching (Internal Logic)
Two bookmarks are considered "the same" only if **all 4 attributes match**:
- `title`
- `url`
- `path` (folder hierarchy)
- `index` (position within folder)

This is used for internal state tracking. A "move" operation is detected as a delete at the old location + insert at the new location.

#### 3-of-4 Matching (Conflict Detection)
Two bookmarks are considered "the same bookmark" if **3 out of 4 attributes match**. This is used to detect when the same bookmark was modified differently on each side.

Example: If Machine A changes a bookmark's title and Machine B changes its URL, 3-of-4 matching identifies them as the same bookmark and merges both changes.

### Tombstones

When a bookmark or folder is deleted, a **tombstone** record is created instead of immediately removing it:

```javascript
{
  title: "Deleted Bookmark",
  url: "https://example.com",
  path: ["Toolbar", "Work"],
  deleted: true,
  deletedAt: 1706745600000
}
```

Tombstones serve several purposes:
- Propagate deletions to other machines during sync
- Distinguish "deleted" from "never existed"
- Enable conflict detection (deleted vs modified)

Tombstones are automatically cleaned up when:
- The bookmark is recreated (revived)
- A folder tombstone exists but the folder has content (folder survives)

### Conflict Types

#### Edit Conflict
Both sides modified the same attribute of the same bookmark differently.

```
Baseline:    { title: "News", url: "https://news.com" }
Local:       { title: "Daily News", url: "https://news.com" }
Remote:      { title: "Tech News", url: "https://news.com" }
                     ↓
             CONFLICT: title changed differently
```

**Resolution**: User chooses "Local Master" or "Remote Master"

#### Delete vs Edit Conflict
One side deleted the bookmark while the other modified it.

```
Baseline:    { title: "News", url: "https://news.com" }
Local:       (deleted)
Remote:      { title: "News", url: "https://news.com/updated" }
                     ↓
             CONFLICT: deleted vs modified
```

**Resolution**: User chooses to keep the deletion or restore the modified version

### Corner Cases and Edge Scenarios

#### Index-Only Changes Are Not Conflicts

When a bookmark's position changes as a **side effect** of another operation (adding/removing a sibling), this is not considered an intentional edit:

```
Machine A: Deletes bookmark X at index 2
Machine B: Adds bookmark Y at index 1 (shifts X to index 3)
                     ↓
           NO CONFLICT - deletion proceeds, Y stays at index 1
```

Rationale: The user on Machine B didn't intentionally "edit" X's index - it shifted automatically.

#### Folder Deletion with New Content

When a folder is deleted on one machine but new content is added to it on another:

```
Machine A: Has folder F with bookmarks a, b
Machine B: Has folder F with bookmarks a, b
           B deletes folder F (creates tombstones for F, a, b)
           A adds bookmark c to folder F
           A syncs first → remote has F with a, b, c
           B syncs → sees F was "deleted" locally but remote has c
                     ↓
           NOT A CONFLICT - folder F survives with only c
           (a and b are deleted as B intended, c is new so it stays)
```

**Key insight**: New content (c) was added AFTER B's knowledge, so B's deletion intent only applies to content B knew about (a, b).

#### Folder Deletion with Modified Content

When a folder is deleted on one machine but existing content is modified on another:

```
Machine A: Has folder F with bookmark X
Machine B: Has folder F with bookmark X
           B deletes folder F
           A modifies X's title
           Both sync
                     ↓
           CONFLICT - folder deleted vs content modified
```

**Resolution**: User chooses whether to restore folder with modified content or proceed with deletion.

#### Move Into Deleted Folder

When a bookmark is moved into a folder that was deleted on another machine:

```
Machine A: Has root bookmark c, empty folder F
Machine B: Has root bookmark c, empty folder F
           B deletes empty folder F
           A moves c into folder F
           Both sync
                     ↓
           NOT A CONFLICT - F survives with c inside
           (F was empty when deleted, now has content)
```

#### Nested Folder Deletion with Deep Content

```
Machine A: Has F1/F2/X
Machine B: Has F1/F2/X
           B deletes F1 (and everything inside)
           A adds Y to F2
           Both sync
                     ↓
           NOT A CONFLICT - F1 and F2 survive with only Y
           (X is deleted, Y is new content)
```

#### Concurrent Identical Changes

When both machines make the same change, no conflict or duplicate occurs:

```
Machine A: Renames X to Y
Machine B: Renames X to Y
           Both sync
                     ↓
           NO CONFLICT - both agree, result is Y
```

#### Merge of Non-Conflicting Edits

When both machines edit different attributes of the same bookmark:

```
Baseline:    { title: "Site", url: "https://old.com", path: ["Root"] }
Local:       { title: "New Site", url: "https://old.com", path: ["Root"] }
Remote:      { title: "Site", url: "https://new.com", path: ["Root"] }
                     ↓
           NO CONFLICT - merge both changes
Result:      { title: "New Site", url: "https://new.com", path: ["Root"] }
```

### Multi-Machine Sync Scenarios

The 3-way algorithm handles 3+ machines correctly:

```
Machine A, B, C all start with same bookmarks

1. A adds bookmark X, syncs → remote has X
2. B deletes folder F, syncs → remote has X + F tombstone
3. C syncs:
   - C's oldRemoteState: no X, has F
   - C's local: no X, has F
   - Remote: has X, F tombstone
   
   Result: C gets X, deletes F locally
   
4. A syncs again:
   - Sees F tombstone from B
   - A still has F locally
   - Result: A deletes F (if empty) or shows conflict (if A added content)
```

### Preventing Sync Loops

A `syncInProgress` flag prevents recording changes that are triggered by sync operations:

```javascript
async function applySyncChangesLocally() {
  syncInProgress = true;
  try {
    // Apply insertions, deletions, updates
    // Browser fires bookmark events, but they're ignored
  } finally {
    syncInProgress = false;
  }
}

function recordChange(type, bookmarkId, info) {
  if (syncInProgress) return; // Skip sync-triggered changes
  // Record actual user changes...
}
```

This prevents:
- Sync-applied changes being recorded as new local changes
- Cascading sync operations
- Duplicate conflict detection

## Synchronization Triggers

### Automatic Sync
- The extension can automatically synchronize bookmarks at regular intervals. This is controlled by a background timer that checks for changes based on the configured interval.

### Manual Sync
- Users can manually trigger a synchronization by sending a message to the extension.

### Event-Driven Sync
- The extension listens for changes in local bookmarks (e.g., creation, deletion, movement) and can trigger a synchronization process in response.

## Browser Compatibility
While the extension works with Firefox, it does not work with Fennec / Firefox for Android or Wolvic due to no supporting the [bookmark API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/bookmarks).
