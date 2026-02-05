import { expect } from "chai";
import { loadModule } from "../setup.js";

const mod = loadModule("src/sync.js");
const { calcSyncChanges, calcMove, createTombstone, bookmarkKey } = mod;

describe("Sync Algorithm - Additional Scenarios", () => {
  // ============================================
  // EDGE CASES IN MATCHING
  // ============================================

  describe("Bookmark Key Edge Cases", () => {
    it("pipe character in title does not cause false 3-of-3 match", () => {
      // title "a|Toolbar" with url "" path [] -> key "a|Toolbar||"
      // title "a" with url "" path ["Toolbar"] -> key "a|Toolbar|"
      // These keys are different (trailing pipe), so no collision in this case
      const key1 = bookmarkKey({ title: "a|Toolbar", url: "", path: [] });
      const key2 = bookmarkKey({ title: "a", url: "", path: ["Toolbar"] });
      // Verify they don't accidentally collide
      expect(key1).to.not.equal(key2);
    });

    it("separator bookmarks (empty title and url) all map to same key", () => {
      const sep1 = bookmarkKey({ title: "", url: "", path: ["Toolbar"] });
      const sep2 = bookmarkKey({ title: "", url: "", path: ["Toolbar"] });
      expect(sep1).to.equal(sep2);
      // Two separators at same path are indistinguishable by key
    });
  });

  // ============================================
  // NULL / UNDEFINED INPUTS
  // ============================================

  describe("Null/Undefined Inputs", () => {
    it("handles null oldRemoteState", () => {
      const result = calcSyncChanges(
        null,
        [{ title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 }],
        [],
      );
      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
      expect(result.conflicts).to.be.empty;
    });

    it("handles undefined currentLocalState", () => {
      const result = calcSyncChanges(
        [],
        undefined,
        [{ title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 }],
      );
      expect(result.localChanges.insertions).to.have.lengthOf(1);
      expect(result.conflicts).to.be.empty;
    });

    it("handles all null inputs", () => {
      const result = calcSyncChanges(null, null, null);
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // EDIT + MOVE ON DIFFERENT MACHINES
  // ============================================

  describe("Edit + Move on Different Machines", () => {
    it("A renames X to Y, B moves X from F1 to F2 -> both Y and moved X exist", () => {
      // Initial: X in F1
      // A renames X to Y (creates tombstone for X), syncs
      // B moves X to F2 (creates tombstone for X at F1)
      // With 3-of-3: X@F1, Y@F1, X@F2 are all different bookmarks
      // Result: Y and X@F2 both survive, X@F1 deleted

      const oldRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
        },
      ];

      const movedTombstone = calcMove({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar", "F1"],
        index: 0,
      });

      const currentLocalState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F2"],
          index: 0,
        },
        movedTombstone,
      ];

      const currentRemoteState = [
        { title: "F1", path: ["Toolbar"], index: 0 },
        { title: "F2", path: ["Toolbar"], index: 1 },
        {
          title: "Y",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
        },
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

      expect(result.conflicts).to.be.empty;
      // Y should be inserted locally
      expect(result.localChanges.insertions.some((i) => i.title === "Y")).to.be
        .true;
      // X at F2 should be pushed to remote
      expect(
        result.remoteChanges.insertions.some(
          (i) => i.title === "X" && i.path.includes("F2"),
        ),
      ).to.be.true;
    });
  });

  // ============================================
  // BOTH ADD AND DELETE SAME ITEM (RECREATE)
  // ============================================

  describe("Both Add and Delete Same Item", () => {
    it("both sides have X + tombstone for X -> X survives", () => {
      // Both sides independently recreated X (add + tombstone from previous deletion)
      const oldRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const currentLocalState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now() - 1000,
        },
      ];

      const currentRemoteState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now() - 500,
        },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // X should survive - no deletions
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // VERY DEEP NESTING
  // ============================================

  describe("Very Deep Nesting", () => {
    it("handles 10 levels of nested folders", () => {
      const path = [
        "Toolbar",
        "L1",
        "L2",
        "L3",
        "L4",
        "L5",
        "L6",
        "L7",
        "L8",
        "L9",
      ];

      const oldRemoteState = [];
      const currentLocalState = [
        { title: "Deep", url: "http://deep.com", path: path, index: 0 },
      ];
      const currentRemoteState = [];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
      expect(result.remoteChanges.insertions[0].path).to.deep.equal(path);
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // LARGE-SCALE OPERATIONS
  // ============================================

  describe("Large-Scale Operations", () => {
    it("handles 50 bookmarks with bulk changes on both sides", () => {
      const baseline = [];
      for (let i = 0; i < 50; i++) {
        baseline.push({
          title: `bm${i}`,
          url: `http://bm${i}.com`,
          path: ["Toolbar"],
          index: i,
        });
      }

      // Local deletes first 25
      const localTombstones = baseline.slice(0, 25).map((bm) => ({
        ...bm,
        deleted: true,
        deletedAt: Date.now(),
      }));
      const localActive = baseline.slice(25);
      const currentLocalState = [...localActive, ...localTombstones];

      // Remote adds 10 new ones
      const remoteNew = [];
      for (let i = 50; i < 60; i++) {
        remoteNew.push({
          title: `bm${i}`,
          url: `http://bm${i}.com`,
          path: ["Toolbar"],
          index: i,
        });
      }
      const currentRemoteState = [...baseline, ...remoteNew];

      const result = calcSyncChanges(
        baseline,
        currentLocalState,
        currentRemoteState,
      );

      // 10 new remote bookmarks should be inserted locally
      expect(result.localChanges.insertions).to.have.lengthOf(10);
      // 25 deletions should be pushed to remote
      expect(result.remoteChanges.deletions).to.have.lengthOf(25);
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // FOLDER WITH ONLY TOMBSTONE CHILDREN
  // ============================================

  describe("Folder With Only Tombstone Children", () => {
    it("folder tombstone is NOT protected when children are all tombstones", () => {
      // Folder F deleted, all children also deleted - folder should stay deleted
      const oldRemoteState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F"],
          index: 0,
        },
      ];

      const currentLocalState = [
        { title: "F", path: ["Toolbar"], index: 0 },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F"],
          index: 0,
        },
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
          title: "X",
          url: "http://x.com",
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

      // Both F and X should be deleted locally
      expect(result.localChanges.deletions).to.have.lengthOf(2);
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // FOLDER NAME MATCHES PATH SEGMENT
  // ============================================

  describe("Folder Name vs Path Segment", () => {
    it("folder 'A' deletion does not affect bookmark with 'A' in unrelated path", () => {
      // Folder "A" at Toolbar and bookmark "X" at ["Other", "A"] are unrelated
      const oldRemoteState = [
        { title: "A", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Other", "A"], index: 0 },
      ];

      const currentLocalState = [
        { title: "A", path: ["Toolbar"], index: 0 },
        { title: "X", url: "http://x.com", path: ["Other", "A"], index: 0 },
      ];

      const currentRemoteState = [
        {
          title: "A",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: Date.now(),
        },
        { title: "X", url: "http://x.com", path: ["Other", "A"], index: 0 },
      ];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Folder A at Toolbar deleted, but X at Other/A is untouched
      expect(result.localChanges.deletions).to.have.lengthOf(1);
      expect(result.localChanges.deletions[0].title).to.equal("A");
      expect(result.localChanges.deletions[0].path).to.deep.equal(["Toolbar"]);
      // X should not be affected
      expect(
        result.localChanges.deletions.some(
          (d) => d.title === "X",
        ),
      ).to.be.false;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // MULTIPLE BOOKMARKS WITH SAME TITLE/URL IN DIFFERENT PATHS
  // ============================================

  describe("Same Bookmark in Multiple Folders", () => {
    it("same title/url in two different folders are treated as separate bookmarks", () => {
      const oldRemoteState = [];

      const currentLocalState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F1"],
          index: 0,
        },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F2"],
          index: 0,
        },
      ];

      const currentRemoteState = [];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // Both should be pushed to remote
      expect(result.remoteChanges.insertions).to.have.lengthOf(2);
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // STABILITY AFTER COMPLEX OPERATIONS
  // ============================================

  describe("Convergence", () => {
    it("second sync after complex merge produces no changes", () => {
      // First sync: A adds X, B adds Y
      const oldRemoteState1 = [];
      const local1 = [
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 0 },
      ];
      const remote1 = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      const result1 = calcSyncChanges(oldRemoteState1, local1, remote1);
      const newState1 = result1.newState.filter((b) => !b.deleted);

      // Second sync: both have X, Y (the merged state is the new baseline)
      const result2 = calcSyncChanges(newState1, newState1, newState1);

      expect(result2.localChanges.insertions).to.be.empty;
      expect(result2.localChanges.deletions).to.be.empty;
      expect(result2.remoteChanges.insertions).to.be.empty;
      expect(result2.remoteChanges.deletions).to.be.empty;
      expect(result2.conflicts).to.be.empty;
    });
  });

  // ============================================
  // EMPTY STATES
  // ============================================

  describe("Empty States", () => {
    it("all three states empty -> no changes", () => {
      const result = calcSyncChanges([], [], []);
      expect(result.localChanges.insertions).to.be.empty;
      expect(result.localChanges.deletions).to.be.empty;
      expect(result.remoteChanges.insertions).to.be.empty;
      expect(result.remoteChanges.deletions).to.be.empty;
      expect(result.conflicts).to.be.empty;
    });
  });

  // ============================================
  // DUPLICATE BOOKMARKS IN SAME PATH
  // ============================================

  describe("Duplicate Bookmarks", () => {
    it("two identical bookmarks (same title/url/path, different index) treated as one by 3-of-3", () => {
      // With 3-of-3 matching, duplicates at same path are considered same bookmark
      const oldRemoteState = [];
      const currentLocalState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
        },
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 1,
        },
      ];
      const currentRemoteState = [];

      const result = calcSyncChanges(
        oldRemoteState,
        currentLocalState,
        currentRemoteState,
      );

      // addedKeys deduplication means only one copy is pushed
      // The first match wins via the addedKeys Set
      expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    });
  });
});
