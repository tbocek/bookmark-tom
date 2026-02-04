import { expect } from "chai";
import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "src/sync.js");
const code = fs.readFileSync(filePath, "utf-8");
const moduleExports = eval(code);
const calcSyncChanges = moduleExports.calcSyncChanges;
const detectFolderConflicts = moduleExports.detectFolderConflicts;
const createTombstone = moduleExports.createTombstone;
const calcMove = moduleExports.calcMove;

/**
 * 3-State Sync Tests
 *
 * States:
 * - oldRemoteState: What both machines had at last sync
 * - currentLocalState: What local machine has now
 * - currentRemoteState: What remote has now (after other machine synced)
 */

describe("3-State Sync Algorithm", () => {
  // ============================================
  // BASIC OPERATIONS (A acts, B does nothing)
  // ============================================

  describe("Basic Operations - Single Machine Acts", () => {
    it("Case 1: A adds X, B gets X", () => {
      // Initial: empty
      // A adds X, syncs -> remote has X
      // B syncs -> B gets X

      const oldRemoteState = [];
      const currentLocalState = [];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.insertions).to.have.lengthOf(1);
      expect(result.localChanges.insertions[0].title).to.equal("X");
      expect(result.conflicts).to.be.empty;
    });

    it("Case 2: A deletes X, B deletes X", () => {
      // Initial: X
      // A deletes X, syncs -> remote has tombstone
      // B syncs -> B deletes X

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.deletions).to.have.lengthOf(1);
      expect(result.localChanges.deletions[0].title).to.equal("X");
      expect(result.conflicts).to.be.empty;
    });

    it("Case 3: A moves X from F1 to F2, B moves X to F2", () => {
      // Initial: X in F1
      // A moves X to F2, syncs -> remote has X in F2
      // B syncs -> B moves X to F2

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Should update local X to new path or delete+insert
      const hasUpdate = result.localChanges.updates.some((u) =>
        u.new.path.includes("F2"),
      );
      const hasDeleteAndInsert =
        result.localChanges.deletions.some((d) => d.path.includes("F1")) &&
        result.localChanges.insertions.some((i) => i.path.includes("F2"));
      expect(hasUpdate || hasDeleteAndInsert).to.be.true;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 4: A renames X to Y, B renames X to Y", () => {
      // Initial: X
      // A renames X to Y, syncs -> remote has Y
      // B syncs -> B renames X to Y

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "Y", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
      // Should have update to change title
      const hasUpdate = result.localChanges.updates.some(
        (u) => u.new.title === "Y",
      );
      const hasInsert = result.localChanges.insertions.some(
        (i) => i.title === "Y",
      );
      expect(hasUpdate || hasInsert).to.be.true;
    });

    it("Case 5: A edits X url, B updates url", () => {
      // Initial: X with url1
      // A changes url to url2, syncs -> remote has url2
      // B syncs -> B updates to url2

      const oldRemoteState = [
        { title: "X", url: "http://old.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://old.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://new.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // SINGLE-SIDED ADD (not in baseline)
  // ============================================

  describe("Single-Sided Add", () => {
    it("Case 45: Local has new item, baseline and remote empty -> push to remote", () => {
      // Initial: empty
      // B adds Y locally (not synced yet)
      // B syncs -> Y pushed to remote

      const oldRemoteState = [];
      const currentLocalState = [
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Y should be pushed to remote
      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
      expect(result.remoteChanges.insertions[0].title).to.equal("Y");
      // No local changes needed
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 46: Remote has new item, baseline and local empty -> insert locally", () => {
      // Initial: empty
      // A adds X, syncs -> remote has X
      // B syncs -> B gets X

      const oldRemoteState = [];
      const currentLocalState = [];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should be inserted locally
      expect(result.localChanges.insertions).to.have.lengthOf(1);
      expect(result.localChanges.insertions[0].title).to.equal("X");
      // No remote changes needed
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // BOTH ADD
  // ============================================

  describe("Both Add", () => {
    it("Case 6: Both add same X, no change needed", () => {
      // Initial: empty
      // A adds X, syncs -> remote has X
      // B adds X (same), syncs -> already has X

      const oldRemoteState = [];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 7: A adds X, B adds Y, both exist", () => {
      // Initial: empty
      // A adds X, syncs -> remote has X
      // B adds Y, syncs -> B gets X, pushes Y

      const oldRemoteState = [];
      const currentLocalState = [
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.insertions).to.have.lengthOf(1);
      expect(result.localChanges.insertions[0].title).to.equal("X");
      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
      expect(result.remoteChanges.insertions[0].title).to.equal("Y");
      expect(result.conflicts).to.be.empty;
    });

    it("Case 8: Both add X with different urls, conflict", () => {
      // Initial: empty
      // A adds X url1, syncs -> remote has X url1
      // B adds X url2, syncs -> conflict: same title, diff url

      const oldRemoteState = [];
      const currentLocalState = [
        { title: "X", url: "http://url2.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://url1.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Both added with different urls - could be conflict or both exist
      // For now, 3-of-4 matching means they're considered "same" bookmark
      // So this is actually an edit conflict (both changed url from nothing)
      expect(
        result.conflicts.length +
          result.localChanges.insertions.length +
          result.remoteChanges.insertions.length,
      ).to.be.greaterThan(0);
    });
  });

  // ============================================
  // BOTH DELETE
  // ============================================

  describe("Both Delete", () => {
    it("Case 9: Both delete X, no change", () => {
      // Initial: X
      // A deletes X, syncs -> remote has tombstone
      // B deletes X, syncs -> already deleted

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // DELETE vs EDIT
  // ============================================

  describe("Delete vs Edit", () => {
    it("Case 10: A deletes X, B edits X -> no conflict, X deleted, X-edited pushed", () => {
      // Initial: X
      // A deletes X, syncs -> remote has tombstone
      // B edits X title (creates tombstone for old X), syncs
      // Result: Both have tombstone for X, X-edited pushed to remote

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X-edited", url: "http://x.com", path: ["Toolbar"], index: 0 },
        // Tombstone for old X (created when B edited X)
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - both deleted X, X-edited is a local addition
      expect(result.conflicts).to.be.empty;
      // X-edited pushed to remote
      expect(
        result.remoteChanges.insertions.some((i) => i.title === "X-edited"),
      ).to.be.true;
    });

    it("Case 11: A edits X, B deletes X -> no conflict, X deleted, X-new inserted locally", () => {
      // Initial: X
      // A edits X title (creates tombstone for old X), syncs -> remote has X-new + tombstone
      // B deletes X, syncs
      // Result: Both have tombstone for X, X-new inserted locally

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        { title: "X-new", url: "http://x.com", path: ["Toolbar"], index: 0 },
        // Tombstone for old X (created when A edited X)
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - both deleted X, X-new is a remote addition
      expect(result.conflicts).to.be.empty;
      // X-new inserted locally
      expect(result.localChanges.insertions.some((i) => i.title === "X-new")).to
        .be.true;
    });
  });

  // ============================================
  // DELETE vs MOVE
  // ============================================

  describe("Delete vs Move", () => {
    it("Case 12: A deletes X, B index shifts -> NO conflict, X deleted locally", () => {
      // Initial: X at idx=0
      // A deletes X, syncs -> remote has tombstone
      // B's X shifted to idx=1 (side effect of adding something before it)
      // With 3-of-3 matching (ignoring index), X at idx=1 is the SAME as X at idx=0
      // Since remote has tombstone for X, X gets deleted locally

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
        // No tombstone needed - X just shifted index, same bookmark
      ];
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // With 3-of-3: local X (idx=1) matches baseline X and remote tombstone
      // Result: X is deleted (remote deletion wins)
      expect(result.conflicts).to.be.empty;
      // X deleted locally
      expect(result.localChanges.deletions.some((d) => d.title === "X")).to.be
        .true;
    });

    it("Case 13: A deletes X in /A, B moves X to /B -> no conflict, X survives in /B", () => {
      // Initial: X in path /A
      // A deletes X, syncs -> remote has tombstone (path=/A)
      // B moves X to /B (creates tombstone for X at /A)
      // With 3-of-3: X at /A and X at /B are DIFFERENT (path differs)
      // Result: X at /A deleted (both agree), X at /B pushed to remote

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "A"], index: 0 },
      ];
      // B moved X from /A to /B - use calcMove to generate tombstone
      const movedXTombstone = calcMove({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar", "A"],
        index: 0,
      });
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "B"], index: 0 },
        movedXTombstone, // tombstone for X at old location
      ];
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "A"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // With 3-of-3: X at /A deleted (both have tombstone), X at /B is new (pushed)
      expect(result.conflicts).to.be.empty;
      // X at /B pushed to remote
      expect(
        result.remoteChanges.insertions.some(
          (i) => i.title === "X" && i.path.includes("B"),
        ),
      ).to.be.true;
    });

    it("Case 14: A deletes X in F1, B moves X to F2 -> no conflict, X survives in F2", () => {
      // Initial: X in F1
      // A deletes X, syncs -> remote has tombstone (F1)
      // B moves X to F2 (creates tombstone for X at F1)
      // With 3-of-3: X at F1 and X at F2 are DIFFERENT (path differs)
      // Result: X at F1 deleted, X at F2 pushed to remote

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      // B moved X from F1 to F2 - use calcMove to generate tombstone
      const movedXTombstone = calcMove({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar", "F1"],
        index: 0,
      });
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
        movedXTombstone, // tombstone for X at old location
      ];
      const currentRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // With 3-of-3: X at F1 deleted, X at F2 is new (pushed)
      expect(result.conflicts).to.be.empty;
      // X at F2 pushed to remote
      expect(
        result.remoteChanges.insertions.some(
          (i) => i.title === "X" && i.path.includes("F2"),
        ),
      ).to.be.true;
    });
  });

  // ============================================
  // EDIT vs EDIT
  // ============================================

  describe("Edit vs Edit", () => {
    it("Case 15: Both edit title differently -> no conflict, both versions exist", () => {
      // Initial: X with title "old"
      // A edits title to "A" (creates tombstone for "old"), syncs
      // B edits title to "B" (creates tombstone for "old"), syncs
      // With 3-of-3: "old", "A", and "B" are all DIFFERENT (title differs)
      // Result: "old" deleted (both have tombstone), "A" inserted locally, "B" pushed to remote

      const oldRemoteState = [
        { title: "old", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "B", url: "http://x.com", path: ["Toolbar"], index: 0 },
        // Tombstone for "old" (created when B renamed)
        {
          title: "old",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        { title: "A", url: "http://x.com", path: ["Toolbar"], index: 0 },
        // Tombstone for "old" (created when A renamed)
        {
          title: "old",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // With 3-of-3: no conflict, both "A" and "B" exist as separate bookmarks
      expect(result.conflicts).to.be.empty;
      // "A" inserted locally
      expect(result.localChanges.insertions.some((i) => i.title === "A")).to.be
        .true;
      // "B" pushed to remote
      expect(result.remoteChanges.insertions.some((i) => i.title === "B")).to.be
        .true;
    });

    it("Case 16: A edits title, B edits url -> merge both", () => {
      // Initial: X
      // A edits title to "A", syncs -> remote has title "A"
      // B edits url to new, syncs -> no conflict, merge

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://new.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "A", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Different attributes changed - should merge without conflict
      expect(result.conflicts).to.be.empty;
    });

    it("Case 17: Both edit index -> local wins (no conflict for index)", () => {
      // Initial: X at idx=0
      // A edits index to 1, syncs -> remote has idx=1
      // B edits index to 2, syncs -> no conflict, local wins

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 2 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Both changed index - this is typically a conflict unless we special-case index
      // For simplicity, treat as conflict or let local win
      // Current implementation: conflict for same attribute
      expect(result.conflicts.length).to.be.lessThanOrEqual(1);
    });

    it("Case 39: Both edit title differently -> no conflict, both versions exist", () => {
      // Initial: f
      // Machine 2: f -> f5 (creates tombstone for "f"), sync
      // Machine 1: f -> f6 (creates tombstone for "f"), sync
      // With 3-of-3: "f", "f5", and "f6" are all DIFFERENT (title differs)
      // Result: "f" deleted, "f5" inserted locally, "f6" pushed to remote

      const oldRemoteState = [
        { title: "f", url: "http://f/", path: ["Toolbar", "Test2"], index: 0 },
      ];
      const currentLocalState = [
        { title: "f6", url: "http://f/", path: ["Toolbar", "Test2"], index: 0 },
        // Tombstone for "f"
        {
          title: "f",
          url: "http://f/",
          path: ["Toolbar", "Test2"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        { title: "f5", url: "http://f/", path: ["Toolbar", "Test2"], index: 0 },
        // Tombstone for "f"
        {
          title: "f",
          url: "http://f/",
          path: ["Toolbar", "Test2"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // With 3-of-3: no conflict, both exist as separate bookmarks
      expect(result.conflicts).to.be.empty;
      // "f5" inserted locally
      expect(result.localChanges.insertions.some((i) => i.title === "f5")).to.be
        .true;
      // "f6" pushed to remote
      expect(result.remoteChanges.insertions.some((i) => i.title === "f6")).to
        .be.true;
    });
  });

  // ============================================
  // MOVE vs MOVE
  // ============================================

  describe("Move vs Move", () => {
    it("Case 18: A moves X to F2, B moves X to F3 -> no conflict, both X exist", () => {
      // Initial: X in F1
      // A moves X to F2 (creates tombstone for X at F1), syncs
      // B moves X to F3 (creates tombstone for X at F1), syncs
      // With 3-of-3: X at F1, X at F2, X at F3 are all DIFFERENT (path differs)
      // Result: X at F1 deleted, X at F2 inserted locally, X at F3 pushed to remote

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "F3", path: ["Toolbar"], index: 2 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      // B moved X from F1 to F3 - use calcMove to generate tombstone
      const movedXTombstone = calcMove({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar", "F1"],
        index: 0,
      });
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "F3", path: ["Toolbar"], index: 2 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F3"], index: 0 },
        movedXTombstone, // tombstone for X at F1
      ];
      const currentRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "F3", path: ["Toolbar"], index: 2 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // With 3-of-3: no conflict, X exists in both F2 and F3
      expect(result.conflicts).to.be.empty;
      // X at F2 inserted locally
      expect(
        result.localChanges.insertions.some(
          (i) => i.title === "X" && i.path.includes("F2"),
        ),
      ).to.be.true;
      // X at F3 pushed to remote
      expect(
        result.remoteChanges.insertions.some(
          (i) => i.title === "X" && i.path.includes("F3"),
        ),
      ).to.be.true;
    });

    it("Case 19: Both move X to F2 -> no change needed", () => {
      // Initial: X in F1
      // A moves X to F2, syncs -> remote has X in F2
      // B moves X to F2, syncs -> local has X in F2 + tombstone for X at F1, already in F2

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      // B moved X from F1 to F2 - use calcMove to generate tombstone
      const movedXTombstone = calcMove({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar", "F1"],
        index: 0,
      });
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
        movedXTombstone, // tombstone for X at old location
      ];
      const currentRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Both moved to same place - no changes needed
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // FOLDER OPERATIONS
  // ============================================

  describe("Folder Operations", () => {
    it("Case 20: A deletes folder F with Y, B deletes F and Y", () => {
      // Initial: F with Y
      // A deletes F, syncs -> remote has tombstones F, Y
      // B syncs -> B deletes F and Y

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];
      const currentLocalState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];
      const currentRemoteState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "Y",
          url: "http://y.com",
          path: ["Toolbar", "F"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // B should delete F and Y
      expect(result.localChanges.deletions).to.have.lengthOf(2);
      expect(result.conflicts).to.be.empty;
    });

    it("Case 21: A deletes F with Y, B adds Z to F -> NOT conflict, Z pushed, Y deleted, F survives", () => {
      // Initial: F with Y
      // A deletes F and Y, syncs -> remote has tombstones F, Y
      // B adds Z to F, syncs -> NOT a conflict
      // With protectFoldersWithContent: F survives because Z is inside it
      // Result: Z pushed to remote, Y deleted locally, F survives (has content)

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];
      const currentLocalState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
        { title: "Z", url: "http://z.com", path: ["Toolbar", "F"], index: 1 },
      ];
      const currentRemoteState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "Y",
          url: "http://y.com",
          path: ["Toolbar", "F"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // Z pushed to remote
      expect(result.remoteChanges.insertions.some((i) => i.title === "Z")).to.be
        .true;
      // Y deleted locally (has tombstone)
      expect(result.localChanges.deletions.some((d) => d.title === "Y")).to.be
        .true;
      // F NOT deleted (has content Z inside)
      expect(result.localChanges.deletions.some((d) => d.title === "F")).to.be
        .false;
    });

    it("Case 22: A deletes empty F, B adds Y to F -> NOT conflict, Y pushed, F survives", () => {
      // Initial: F (empty)
      // A deletes F, syncs -> remote has tombstone F
      // B adds Y to F, syncs -> NOT a conflict
      // With protectFoldersWithContent: F survives because Y is inside it
      // Result: Y pushed to remote, F NOT deleted (has content)

      const oldRemoteState = [{ title: "F", path: ["Toolbar"], index: 0 }];
      const currentLocalState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];
      const currentRemoteState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // Y pushed to remote
      expect(result.remoteChanges.insertions.some((i) => i.title === "Y")).to.be
        .true;
      // F NOT deleted (has content Y inside)
      expect(result.localChanges.deletions.some((d) => d.title === "F")).to.be
        .false;
    });

    it("Case 23: A deletes empty F, B syncs -> B deletes F", () => {
      // Initial: F (empty)
      // A deletes F, syncs -> remote has tombstone F
      // B syncs -> B deletes F

      const oldRemoteState = [{ title: "F", path: ["Toolbar"], index: 0 }];
      const currentLocalState = [{ title: "F", path: ["Toolbar"], index: 0 }];
      const currentRemoteState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.deletions).to.have.lengthOf(1);
      expect(result.localChanges.deletions[0].title).to.equal("F");
      expect(result.conflicts).to.be.empty;
    });

    it("Case 24: B deletes empty F -> remote gets tombstone", () => {
      // Initial: F (empty)
      // A does nothing
      // B deletes F, syncs -> remote gets tombstone F

      const oldRemoteState = [{ title: "F", path: ["Toolbar"], index: 0 }];
      const currentLocalState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [{ title: "F", path: ["Toolbar"], index: 0 }];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // B deleted F, should push deletion to remote
      expect(result.remoteChanges.deletions).to.have.lengthOf(1);
      expect(result.remoteChanges.deletions[0].title).to.equal("F");
      expect(result.conflicts).to.be.empty;
    });

    it("Case 25: A moves X into F, B deletes empty F -> NOT conflict, B gets F and X", () => {
      // Initial: X, F (empty)
      // A moves X into F, syncs -> remote has X in F + tombstone for X at old location
      // B deletes empty F, syncs -> NOT a conflict
      // Result: B gets X inside F (background.js recreates F locally when inserting X)

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
      ];
      const currentLocalState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
      ];
      // A moved X from Toolbar to Toolbar/F - use calcMove to generate tombstone
      const movedXTombstone = calcMove({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 1,
      });
      const currentRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F"], index: 0 },
        movedXTombstone, // tombstone for X at old location
      ];

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No folder conflict - remote has X in F, B gets it
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // X inside F inserted locally (A moved X into F)
      expect(
        result.localChanges.insertions.some(
          (i) => i.title === "X" && i.path.join("/") === "Toolbar/F",
        ),
      ).to.be.true;
      // Old X at root deleted locally
      expect(
        result.localChanges.deletions.some(
          (d) => d.title === "X" && d.path.join("/") === "Toolbar",
        ),
      ).to.be.true;
    });

    it("Case 26: B deletes F with Y -> remote gets tombstones", () => {
      // Initial: F with Y
      // A does nothing
      // B deletes F, syncs -> remote gets tombstones F, Y

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];
      const currentLocalState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "Y",
          url: "http://y.com",
          path: ["Toolbar", "F"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // B deleted F+Y, should push tombstones to remote
      expect(result.remoteChanges.deletions).to.have.lengthOf(2);
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // NESTED FOLDERS
  // ============================================

  describe("Nested Folders", () => {
    it("Case 27: A deletes F1 containing F2/X, B deletes all", () => {
      // Initial: F1/F2/X
      // A deletes F1, syncs -> remote has tombstones F1, F2, X
      // B syncs -> B deletes all

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar", "F1"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1", "F2"],
          index: 0,
        },
      ];
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar", "F1"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1", "F2"],
          index: 0,
        },
      ];
      const currentRemoteState = [
        {
          title: "F1",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "F2",
          path: ["Toolbar", "F1"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1", "F2"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // B should delete all
      expect(result.localChanges.deletions).to.have.lengthOf(3);
      expect(result.conflicts).to.be.empty;
    });

    it("Case 28: A deletes F1 containing F2/X, B adds Y to F2 -> NOT conflict, Y pushed, X deleted, folders survive", () => {
      // Initial: F1/F2/X
      // A deletes F1, syncs -> remote has tombstones F1, F2, X
      // B adds Y to F2, syncs -> NOT a conflict
      // With protectFoldersWithContent: F1 and F2 survive because Y is inside
      // Result: Y pushed to remote, X deleted locally, F1 and F2 survive (have content)

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar", "F1"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1", "F2"],
          index: 0,
        },
      ];
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar", "F1"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1", "F2"],
          index: 0,
        },
        {
          title: "Y",
          url: "http://y.com",
          path: ["Toolbar", "F1", "F2"],
          index: 1,
        },
      ];
      const currentRemoteState = [
        {
          title: "F1",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "F2",
          path: ["Toolbar", "F1"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1", "F2"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // Y pushed to remote
      expect(result.remoteChanges.insertions.some((i) => i.title === "Y")).to.be
        .true;
      // X deleted locally (has tombstone)
      expect(result.localChanges.deletions.some((d) => d.title === "X")).to.be
        .true;
      // F1 and F2 NOT deleted (have content Y inside)
      expect(result.localChanges.deletions.some((d) => d.title === "F1")).to.be
        .false;
      expect(result.localChanges.deletions.some((d) => d.title === "F2")).to.be
        .false;
    });
  });

  // ============================================
  // FOLDER DELETE + NEW CONTENT (NOT a conflict)
  // ============================================

  describe("Folder Delete + New Content", () => {
    it("Case 33: A deletes folder with b,f - B adds c to folder -> NOT conflict, folder recreated with c", () => {
      // Initial: Test123 folder with b, f inside
      // A deletes Test123 (and b, f), syncs -> remote has tombstones
      // B adds c to Test123
      // B syncs -> NOT a conflict. Folder recreated, c pushed to remote

      const oldRemoteState = [
        { title: "Test123", path: ["Bookmarks Toolbar"], index: 10 },
        {
          title: "b",
          url: "http://b/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 0,
        },
        {
          title: "f",
          url: "http://f/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 1,
        },
      ];
      const currentLocalState = [
        { title: "Test123", path: ["Bookmarks Toolbar"], index: 10 },
        {
          title: "b",
          url: "http://b/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 0,
        },
        {
          title: "f",
          url: "http://f/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 1,
        },
        {
          title: "c",
          url: "http://c/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 2,
        }, // NEW
      ];
      const currentRemoteState = [
        {
          title: "Test123",
          path: ["Bookmarks Toolbar"],
          index: 10,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "b",
          url: "http://b/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "f",
          url: "http://f/",
          path: ["Bookmarks Toolbar", "Test123"],
          index: 1,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Should NOT be a conflict - new content means folder survives
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // c should be pushed to remote
      expect(result.remoteChanges.insertions.some((i) => i.title === "c")).to.be
        .true;
    });

    it("Case 34: A deletes folder - B adds NEW bookmark to folder -> NOT conflict", () => {
      // Initial: empty folder F
      // A deletes F, syncs -> remote has tombstone for F
      // B adds Y to F
      // B syncs -> NOT conflict, F recreated with Y

      const oldRemoteState = [{ title: "F", path: ["Toolbar"], index: 0 }];
      const currentLocalState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 }, // NEW
      ];
      const currentRemoteState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Should NOT be a conflict
      expect(folderConflicts).to.be.empty;
    });
  });

  // ============================================
  // FOLDER DELETE + REMOTE NEW CONTENT
  // ============================================

  describe("Folder Delete + Remote New Content", () => {
    it("Case 35: B has X/a, A adds X/c,d, B deletes X -> remove X/a, insert X/c,d, no conflict", () => {
      // Machine B has X/a - sync
      // Machine A adds X/c, X/d - sync
      // Machine B deletes X - sync
      // Result: remove X/a locally, insert X/c and X/d locally, no conflict

      const oldRemoteState = [
        { title: "X", path: ["Toolbar"], index: 0 },
        { title: "a", url: "http://a/", path: ["Toolbar", "X"], index: 0 },
      ];
      const currentLocalState = [
        // B deleted X, so has tombstones
        {
          title: "X",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "a",
          url: "http://a/",
          path: ["Toolbar", "X"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        // A added c and d to X
        { title: "X", path: ["Toolbar"], index: 0 },
        { title: "a", url: "http://a/", path: ["Toolbar", "X"], index: 0 },
        { title: "c", url: "http://c/", path: ["Toolbar", "X"], index: 1 },
        { title: "d", url: "http://d/", path: ["Toolbar", "X"], index: 2 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - new content c,d means folder survives
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // c and d should be inserted locally (new content from A)
      // (background.js will recreate X folder when inserting c,d)
      expect(result.localChanges.insertions.some((i) => i.title === "c")).to.be
        .true;
      expect(result.localChanges.insertions.some((i) => i.title === "d")).to.be
        .true;
    });

    it("Case 36: B deletes empty F, A moves c into F -> NOT conflict, c moved into F locally", () => {
      // Initial: F (empty folder), c at root
      // B deletes F, syncs -> remote has F tombstone
      // A moves c into F, syncs -> remote has c inside F + tombstone for c at old location
      // B syncs -> NOT a conflict, c gets moved into F locally, F recreated

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "c", url: "http://c/", path: ["Toolbar"], index: 1 },
      ];
      const currentLocalState = [
        // B deleted F
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        // c still at root
        { title: "c", url: "http://c/", path: ["Toolbar"], index: 1 },
      ];
      // A moved c from Toolbar to Toolbar/F - use calcMove to generate tombstone
      const movedCTombstone = calcMove({
        title: "c",
        url: "http://c/",
        path: ["Toolbar"],
        index: 1,
      });
      const currentRemoteState = [
        // A kept F and moved c into it
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "c", url: "http://c/", path: ["Toolbar", "F"], index: 0 },
        movedCTombstone, // tombstone for c at old location
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - A moved c into F, B should accept the move
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // c should be inserted at new path (inside F)
      expect(
        result.localChanges.insertions.some(
          (i) => i.title === "c" && i.path.join("/") === "Toolbar/F",
        ),
      ).to.be.true;
      // c should be deleted at old path (root)
      expect(
        result.localChanges.deletions.some(
          (d) => d.title === "c" && d.path.join("/") === "Toolbar",
        ),
      ).to.be.true;
    });

    it("Case 37: F and c both created/removed/created, B deletes F, A moves c into F -> NOT conflict (tombstone test)", () => {
      // Both F and c went through create/remove/create cycle (tombstones exist)
      // Initial: F (empty folder), c at root, old tombstones for both F and c
      // B deletes F, syncs -> remote has F tombstone
      // A moves c into F, syncs -> remote has c inside F + tombstone for c at old location
      // B syncs -> NOT a conflict, c gets moved into F locally

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "c", url: "http://c/", path: ["Toolbar"], index: 1 },
        // Old tombstone for F from previous delete
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now() - 100000,
        },
        // Old tombstone for c from previous delete
        {
          title: "c",
          url: "http://c/",
          path: ["Toolbar"],
          index: 1,
          deleted: true,
          deletedAt: Date.now() - 100000,
        },
      ];
      const currentLocalState = [
        // B deleted F (fresh tombstone)
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        // c still at root
        { title: "c", url: "http://c/", path: ["Toolbar"], index: 1 },
        // Old tombstone for F
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now() - 100000,
        },
        // Old tombstone for c
        {
          title: "c",
          url: "http://c/",
          path: ["Toolbar"],
          index: 1,
          deleted: true,
          deletedAt: Date.now() - 100000,
        },
      ];
      // A moved c from Toolbar to Toolbar/F - use calcMove to generate tombstone
      const movedCTombstone = calcMove({
        title: "c",
        url: "http://c/",
        path: ["Toolbar"],
        index: 1,
      });
      const currentRemoteState = [
        // A kept F and moved c into it
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "c", url: "http://c/", path: ["Toolbar", "F"], index: 0 },
        movedCTombstone, // tombstone for c at old location (from A's move)
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - A moved c into F, B should accept the move
      expect(folderConflicts).to.be.empty;
      expect(result.conflicts).to.be.empty;

      // c should be inserted at new path (inside F)
      expect(
        result.localChanges.insertions.some(
          (i) => i.title === "c" && i.path.join("/") === "Toolbar/F",
        ),
      ).to.be.true;
      // c should be deleted at old path (root)
      expect(
        result.localChanges.deletions.some(
          (d) => d.title === "c" && d.path.join("/") === "Toolbar",
        ),
      ).to.be.true;
    });

    it("Case 38: A moves d into F, B deletes F (d index shifts) -> NOT conflict, d stays in F", () => {
      // Initial: F with c inside, d at root
      // A moves d into F, syncs -> local has d in F + tombstone for d at old location
      // B deletes F (and c), syncs -> d index shifts as side effect
      // A syncs -> NOT a conflict
      // Result: d stays in F (A's move wins), F survives, c deleted

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 10 },
        { title: "c", url: "http://c/", path: ["Toolbar", "F"], index: 0 },
        { title: "d", url: "http://d/", path: ["Toolbar"], index: 11 },
      ];
      // A moved d from Toolbar to Toolbar/F - use calcMove to generate tombstone
      const movedDTombstone = calcMove({
        title: "d",
        url: "http://d/",
        path: ["Toolbar"],
        index: 11,
      });
      const currentLocalState = [
        // A moved d into F
        { title: "F", path: ["Toolbar"], index: 10 },
        { title: "c", url: "http://c/", path: ["Toolbar", "F"], index: 0 },
        { title: "d", url: "http://d/", path: ["Toolbar", "F"], index: 1 },
        movedDTombstone, // tombstone for d at old location
      ];
      const currentRemoteState = [
        // B deleted F and c, d shifted to index 10
        { title: "d", url: "http://d/", path: ["Toolbar"], index: 10 },
        {
          title: "F",
          path: ["Toolbar"],
          index: 10,
          deleted: true,
          deletedAt: Date.now(),
        },
        {
          title: "c",
          url: "http://c/",
          path: ["Toolbar", "F"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - A moved d into F, this is new content, F survives
      expect(result.conflicts).to.be.empty;

      // d should be pushed to remote inside F
      expect(
        result.remoteChanges.insertions.some(
          (i) => i.title === "d" && i.path.join("/") === "Toolbar/F",
        ),
      ).to.be.true;
      // c should be deleted locally (B deleted it)
      expect(result.localChanges.deletions.some((d) => d.title === "c")).to.be
        .true;
    });
  });

  // ============================================
  // INDEX SHIFT (not a real edit)
  // ============================================

  describe("Index Shift", () => {
    it("Case 31: A deletes folder F, B adds bookmark before F (shifts F index) -> NO conflict", () => {
      // Initial: F at index 10
      // A deletes F, syncs -> remote has tombstone for F at index 10
      // B adds bookmark "f" at index 10, which shifts F to index 11
      // B syncs -> should NOT conflict because B didn't intentionally edit F
      // The index change is just a side effect

      const oldRemoteState = [
        { title: "F", path: ["Bookmarks Toolbar"], index: 10 },
      ];
      const currentLocalState = [
        {
          title: "f",
          url: "http://f/",
          path: ["Bookmarks Toolbar"],
          index: 10,
        },
        { title: "F", path: ["Bookmarks Toolbar"], index: 11 }, // shifted by adding "f"
      ];
      const currentRemoteState = [
        {
          title: "F",
          path: ["Bookmarks Toolbar"],
          index: 10,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Should NOT be a conflict - B didn't edit F, just the index shifted
      // 3-of-4 match: title ✓, url ✓ (both empty), path ✓, index ✗
      // The folder should be deleted, and "f" should be pushed to remote
      expect(result.conflicts).to.be.empty;
      expect(result.localChanges.deletions).to.have.lengthOf(1);
      expect(result.localChanges.deletions[0].title).to.equal("F");
      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
      expect(result.remoteChanges.insertions[0].title).to.equal("f");
    });

    it("Case 32: A deletes bookmark X, B reorders bookmarks (shifts X index) -> NO conflict", () => {
      // Initial: X at index 5
      // A deletes X, syncs -> remote has tombstone for X at index 5
      // B reorders, X now at index 7
      // B syncs -> should NOT conflict, just delete X

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 7 },
      ];
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 5,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // 3-of-4 match: title ✓, url ✓, path ✓, index ✗ -> still a match
      // Should NOT conflict, just delete X
      expect(result.conflicts).to.be.empty;
      expect(result.localChanges.deletions).to.have.lengthOf(1);
      expect(result.localChanges.deletions[0].title).to.equal("X");
    });
  });

  // ============================================
  // MISSING WITHOUT TOMBSTONE (insert wins)
  // ============================================

  describe("Missing Without Tombstone", () => {
    it("Case 40: Item in baseline and local, missing from remote (no tombstone) -> local wins, push to remote", () => {
      // Initial: X exists
      // Remote somehow lost X (no tombstone, just missing)
      // Local still has X unchanged
      // Result: X should be pushed to remote (insert wins over missing)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = []; // X is missing, no tombstone

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should be pushed to remote (not deleted locally)
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
      expect(result.remoteChanges.insertions[0].title).to.equal("X");
      expect(result.conflicts).to.be.empty;
    });

    it("Case 41: Item in baseline and remote, missing from local (no tombstone) -> remote wins, insert locally", () => {
      // Initial: X exists
      // Local somehow lost X (no tombstone, just missing)
      // Remote still has X unchanged
      // Result: X should be inserted locally (insert wins over missing)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = []; // X is missing, no tombstone
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should be inserted locally (not deleted from remote)
      expect(result.localChanges.insertions).to.have.lengthOf(1);
      expect(result.localChanges.insertions[0].title).to.equal("X");
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 42: Item in baseline, missing from both local and remote (no tombstones) -> stays deleted", () => {
      // Initial: X exists
      // Both sides somehow lost X (no tombstones)
      // Result: X stays deleted (both sides agree it's gone)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = []; // X is missing, no tombstone
      const currentRemoteState = []; // X is missing, no tombstone

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should not appear anywhere (both sides lost it)
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 43: Local has tombstone, remote just missing (no tombstone) -> delete wins", () => {
      // Initial: X exists
      // Local deleted X (has tombstone)
      // Remote somehow lost X (no tombstone, just missing)
      // Result: X stays deleted, tombstone in newState (will be pushed to remote)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = []; // X is missing, no tombstone

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should stay deleted - no insertions
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      // Tombstone should be in newState (background.js will push it to remote)
      const tombstoneInNewState = result.newState.find(
        (bm) => bm.title === "X" && bm.deleted === true,
      );
      expect(tombstoneInNewState).to.exist;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 44: Remote has tombstone, local just missing (no tombstone) -> delete wins", () => {
      // Initial: X exists
      // Remote deleted X (has tombstone)
      // Local somehow lost X (no tombstone, just missing)
      // Result: X stays deleted, tombstone preserved in newState

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = []; // X is missing, no tombstone
      const currentRemoteState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should stay deleted - no insertions
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      // No deletions needed locally (X already missing)
      expect(result.localChanges.deletions).to.be.empty;
      // Tombstone should be preserved in newState
      const tombstoneInNewState = result.newState.find(
        (bm) => bm.title === "X" && bm.deleted === true,
      );
      expect(tombstoneInNewState).to.exist;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // STABILITY
  // ============================================

  describe("Stability", () => {
    it("Case 29: No changes -> stable", () => {
      // Initial: X
      // Neither machine changes anything
      // Sync -> no changes

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });

    it("Case 30: Second sync after any operation -> stable", () => {
      // After a sync, doing another sync should have no changes
      // Simulate: both have X, Y after first sync

      const state = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 1 },
      ];
      const oldRemoteState = [...state];
      const currentLocalState = [...state];
      const currentRemoteState = [...state];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // INDEX 3-WAY MERGE (no conflicts, pick winner)
  // ============================================

  describe("Index 3-Way Merge", () => {
    it("Index: only remote changed -> remote wins", () => {
      // Baseline: X@5
      // Local: X@5 (unchanged)
      // Remote: X@6 (changed)
      // Result: X@6 (remote wins)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 6 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
      // newState should have index 6 (remote wins)
      const xInNewState = result.newState.find((bm) => bm.title === "X");
      expect(xInNewState.index).to.equal(6);
      // localChanges should have update to move from 5 to 6
      expect(result.localChanges.updates).to.have.lengthOf(1);
      expect(result.localChanges.updates[0].oldBookmark.index).to.equal(5);
      expect(result.localChanges.updates[0].newBookmark.index).to.equal(6);
    });

    it("Index: only local changed -> local wins", () => {
      // Baseline: X@5
      // Local: X@4 (changed)
      // Remote: X@5 (unchanged)
      // Result: X@4 (local wins)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 4 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
      // newState should have index 4 (local wins)
      const xInNewState = result.newState.find((bm) => bm.title === "X");
      expect(xInNewState.index).to.equal(4);
      // remoteChanges should have update to move from 5 to 4
      expect(result.remoteChanges.updates).to.have.lengthOf(1);
      expect(result.remoteChanges.updates[0].oldBookmark.index).to.equal(5);
      expect(result.remoteChanges.updates[0].newBookmark.index).to.equal(4);
    });

    it("Index: both changed -> local wins (no conflict)", () => {
      // Baseline: X@5
      // Local: X@4 (changed)
      // Remote: X@6 (changed)
      // Result: X@4 (local wins, no conflict)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 4 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 6 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // No conflict - local wins when both changed
      expect(result.conflicts).to.be.empty;
      // newState should have index 4 (local wins)
      const xInNewState = result.newState.find((bm) => bm.title === "X");
      expect(xInNewState.index).to.equal(4);
    });

    it("Index: both same -> no change", () => {
      // Baseline: X@5
      // Local: X@6 (changed)
      // Remote: X@6 (changed to same)
      // Result: X@6 (both agree)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 6 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 6 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
      expect(result.localChanges.updates).to.be.empty;
      expect(result.remoteChanges.updates).to.be.empty;
      const xInNewState = result.newState.find((bm) => bm.title === "X");
      expect(xInNewState.index).to.equal(6);
    });

    it("Index: ping-pong prevention - Machine B accepts Machine A's index", () => {
      // Machine A changed index from 5 to 4, pushed to remote
      // Machine B syncs:
      //   - B's baseline: X@5 (old)
      //   - B's local: X@5 (B didn't change it)
      //   - Remote: X@4 (A's change)
      // Result: B accepts X@4 (remote wins because B didn't change)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 4 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
      // B should accept A's index (remote wins)
      const xInNewState = result.newState.find((bm) => bm.title === "X");
      expect(xInNewState.index).to.equal(4);
      // localChanges should have update
      expect(result.localChanges.updates).to.have.lengthOf(1);
    });

    it("Index: deletion causes shift - no false conflict", () => {
      // Baseline: F@0, X@1
      // Local: deleted F, X shifted to @0
      // Remote: F@0, X@1 (unchanged)
      // Result: F deleted, X@0 (local wins because local changed)

      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
      ];
      const currentRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.conflicts).to.be.empty;
      // F should be deleted on remote
      expect(result.remoteChanges.deletions).to.have.lengthOf(1);
      expect(result.remoteChanges.deletions[0].title).to.equal("F");
      // X should have index 0 in newState (local wins)
      const xInNewState = result.newState.find(
        (bm) => bm.title === "X" && !bm.deleted,
      );
      expect(xInNewState.index).to.equal(0);
    });
  });
});
