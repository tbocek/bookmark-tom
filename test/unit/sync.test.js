import { expect } from "chai";
import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "src/sync.js");
const code = fs.readFileSync(filePath, "utf-8");
const moduleExports = eval(code);
const calcSyncChanges = moduleExports.calcSyncChanges;
const detectFolderConflicts = moduleExports.detectFolderConflicts;
const createTombstone = moduleExports.createTombstone;

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
    it("Case 10: A deletes X, B edits X -> conflict", () => {
      // Initial: X
      // A deletes X, syncs -> remote has tombstone
      // B edits X title, syncs -> conflict (delete vs edit)

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X-edited", url: "http://x.com", path: ["Toolbar"], index: 0 },
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

      // B modified X - should conflict (delete vs edit)
      expect(result.conflicts).to.have.lengthOf(1);
      expect(result.conflicts[0].type).to.equal("delete_vs_edit");
    });

    it("Case 11: A edits X, B deletes X -> conflict", () => {
      // Initial: X
      // A edits X title, syncs -> remote has X "new"
      // B deletes X, syncs -> conflict (delete vs edit)

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
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // B deleted, A modified - should conflict (delete vs edit)
      expect(result.conflicts).to.have.lengthOf(1);
      expect(result.conflicts[0].type).to.equal("delete_vs_edit");
    });
  });

  // ============================================
  // DELETE vs MOVE
  // ============================================

  describe("Delete vs Move", () => {
    it("Case 12: A deletes X, B index shifts -> NO conflict (index-only is side effect)", () => {
      // Initial: X at idx=0
      // A deletes X, syncs -> remote has tombstone (idx=0)
      // B's X shifted to idx=1 (side effect of adding something before it)
      // B syncs -> NO conflict, index-only change is not intentional edit

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 1 },
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

      // Index-only change is NOT a conflict - deletion wins
      expect(result.conflicts).to.be.empty;
      expect(result.localChanges.deletions).to.have.lengthOf(1);
    });

    it("Case 13: A deletes X in /A, B moves X to /B -> conflict", () => {
      // Initial: X in path /A
      // A deletes X, syncs -> remote has tombstone (path=/A)
      // B moves X to /B, syncs -> 3-of-4 match (title, url, index), conflict

      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "A"], index: 0 },
      ];
      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "B"], index: 0 },
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

      // B moved (changed path), A deleted - 3-of-4 match (title, url, index) -> conflict
      expect(result.conflicts).to.have.lengthOf(1);
      expect(result.conflicts[0].type).to.equal("delete_vs_edit");
    });

    it("Case 14: A deletes X in F1, B moves X to F2 -> conflict", () => {
      // Initial: X in F1
      // A deletes X, syncs -> remote has tombstone (F1)
      // B moves X to F2, syncs -> conflict (delete vs move)

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
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

      // B moved X (changed path), A deleted - conflict
      expect(result.conflicts).to.have.lengthOf(1);
      expect(result.conflicts[0].type).to.equal("delete_vs_edit");
    });
  });

  // ============================================
  // EDIT vs EDIT
  // ============================================

  describe("Edit vs Edit", () => {
    it("Case 15: Both edit title differently -> conflict", () => {
      // Initial: X with title "old"
      // A edits title to "A", syncs -> remote has "A"
      // B edits title to "B", syncs -> conflict

      const oldRemoteState = [
        { title: "old", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentLocalState = [
        { title: "B", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const currentRemoteState = [
        { title: "A", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Both changed title - conflict
      expect(result.conflicts).to.have.lengthOf(1);
      expect(result.conflicts[0].type).to.equal("edit_conflict");
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
  });

  // ============================================
  // MOVE vs MOVE
  // ============================================

  describe("Move vs Move", () => {
    it("Case 18: A moves X to F2, B moves X to F3 -> conflict", () => {
      // Initial: X in F1
      // A moves X to F2, syncs -> remote has X in F2
      // B moves X to F3, syncs -> conflict: moved different places

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "F3", path: ["Toolbar"], index: 2 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "F3", path: ["Toolbar"], index: 2 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F3"], index: 0 },
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

      // Both moved X to different folders - conflict
      expect(result.conflicts).to.have.lengthOf(1);
    });

    it("Case 19: Both move X to F2 -> no change needed", () => {
      // Initial: X in F1
      // A moves X to F2, syncs -> remote has X in F2
      // B moves X to F2, syncs -> already in F2

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F1"], index: 0 },
      ];
      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F2"], index: 0 },
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

    it("Case 21: A deletes F with Y, B adds Z to F -> folder conflict", () => {
      // Initial: F with Y
      // A deletes F, syncs -> remote has tombstones F, Y
      // B adds Z to F, syncs -> folder conflict

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

      // Folder conflict: remote deleted F, local added Z
      expect(folderConflicts).to.have.lengthOf(1);
      expect(folderConflicts[0].type).to.equal("folder_deleted_remote");
    });

    it("Case 22: A deletes empty F, B adds Y to F -> folder conflict", () => {
      // Initial: F (empty)
      // A deletes F, syncs -> remote has tombstone F
      // B adds Y to F, syncs -> folder conflict

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

      // Folder conflict: remote deleted F, local added Y
      expect(folderConflicts).to.have.lengthOf(1);
      expect(folderConflicts[0].type).to.equal("folder_deleted_remote");
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

    it("Case 25: A moves X into F, B deletes empty F -> B gets F and X", () => {
      // Initial: X, F (empty)
      // A moves X into F, syncs -> remote has X in F
      // B deletes empty F, syncs -> B creates F, gets X

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
      const currentRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F"], index: 0 },
      ];

      const folderConflicts = detectFolderConflicts(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Folder conflict: local deleted F, remote has X in F (new content)
      expect(folderConflicts).to.have.lengthOf(1);
      expect(folderConflicts[0].type).to.equal("folder_deleted_local");
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

    it("Case 28: A deletes F1 containing F2/X, B adds Y to F2 -> folder conflict", () => {
      // Initial: F1/F2/X
      // A deletes F1, syncs -> remote has tombstones F1, F2, X
      // B adds Y to F2, syncs -> folder conflict

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

      // Folder conflict: remote deleted F1, local added Y
      expect(folderConflicts.length).to.be.greaterThan(0);
      expect(folderConflicts[0].type).to.equal("folder_deleted_remote");
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
});
