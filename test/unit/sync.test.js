import { expect } from "chai";
import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "src/background.js");
const code = fs.readFileSync(filePath, "utf-8");
const moduleExports = eval(code);
const calcTombstoneChanges = moduleExports.calcTombstoneChanges;
const bookmarksEqual = moduleExports.bookmarksEqual;
const matchBookmarks3of4 = moduleExports.matchBookmarks3of4;
const findChangedAttribute = moduleExports.findChangedAttribute;
const createTombstone = moduleExports.createTombstone;
const matchesTombstone = moduleExports.matchesTombstone;
const getActiveBookmarks = moduleExports.getActiveBookmarks;
const getTombstones = moduleExports.getTombstones;
const bookmarkIdentityKey = moduleExports.bookmarkIdentityKey;

describe("Tombstone Helper Functions", () => {
  it("should create a tombstone with deleted flag and timestamp", () => {
    const bookmark = {
      title: "Test",
      url: "http://test.com",
      path: ["Folder"],
      index: 0,
    };
    const tombstone = createTombstone(bookmark);

    expect(tombstone.deleted).to.be.true;
    expect(tombstone.deletedAt).to.be.a("number");
    expect(tombstone.title).to.equal("Test");
    expect(tombstone.url).to.equal("http://test.com");
    expect(tombstone.path).to.deep.equal(["Folder"]);
  });

  it("should match bookmark to tombstone by identity (ignoring index)", () => {
    const bookmark = {
      title: "Test",
      url: "http://test.com",
      path: ["Folder"],
      index: 5,
    };
    const tombstone = {
      title: "Test",
      url: "http://test.com",
      path: ["Folder"],
      deleted: true,
      deletedAt: 123,
    };

    expect(matchesTombstone(bookmark, tombstone)).to.be.true;
  });

  it("should not match bookmark to tombstone with different title", () => {
    const bookmark = {
      title: "Test",
      url: "http://test.com",
      path: ["Folder"],
      index: 0,
    };
    const tombstone = {
      title: "Other",
      url: "http://test.com",
      path: ["Folder"],
      deleted: true,
      deletedAt: 123,
    };

    expect(matchesTombstone(bookmark, tombstone)).to.be.false;
  });

  it("should filter active bookmarks from mixed list", () => {
    const mixed = [
      { title: "Active", url: "http://active.com", path: [], index: 0 },
      {
        title: "Deleted",
        url: "http://deleted.com",
        path: [],
        deleted: true,
        deletedAt: 123,
      },
    ];

    const active = getActiveBookmarks(mixed);

    expect(active).to.have.lengthOf(1);
    expect(active[0].title).to.equal("Active");
  });

  it("should filter tombstones from mixed list", () => {
    const mixed = [
      { title: "Active", url: "http://active.com", path: [], index: 0 },
      {
        title: "Deleted",
        url: "http://deleted.com",
        path: [],
        deleted: true,
        deletedAt: 123,
      },
    ];

    const tombstones = getTombstones(mixed);

    expect(tombstones).to.have.lengthOf(1);
    expect(tombstones[0].title).to.equal("Deleted");
  });

  it("should create correct identity key", () => {
    const bookmark = {
      title: "Test",
      url: "http://test.com",
      path: ["Folder", "Sub"],
      index: 5,
    };
    const key = bookmarkIdentityKey(bookmark);

    expect(key).to.equal("Test#Folder/Sub#http://test.com");
  });
});

describe("Tombstone Sync Logic", () => {
  it("should detect insertion when bookmark only in remote (no tombstones)", () => {
    const local = [];
    const remote = [
      { title: "New", url: "http://new.com", path: ["Folder"], index: 0 },
    ];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.localChanges.insertions).to.have.lengthOf(1);
    expect(result.localChanges.insertions[0].title).to.equal("New");
    expect(result.remoteChanges.insertions).to.be.empty;
  });

  it("should detect push when bookmark only in local (no tombstones)", () => {
    const local = [
      { title: "New", url: "http://new.com", path: ["Folder"], index: 0 },
    ];
    const remote = [];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].title).to.equal("New");
    expect(result.localChanges.insertions).to.be.empty;
  });

  it("should delete locally when remote has tombstone", () => {
    const local = [
      {
        title: "Deleted",
        url: "http://deleted.com",
        path: ["Folder"],
        index: 0,
      },
    ];
    const remote = [
      {
        title: "Deleted",
        url: "http://deleted.com",
        path: ["Folder"],
        deleted: true,
        deletedAt: 123,
      },
    ];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.localChanges.deletions).to.have.lengthOf(1);
    expect(result.localChanges.deletions[0].title).to.equal("Deleted");
  });

  it("should push deletion when local has tombstone", () => {
    const local = [];
    const remote = [
      {
        title: "Deleted",
        url: "http://deleted.com",
        path: ["Folder"],
        index: 0,
      },
    ];
    const localTombstones = [
      {
        title: "Deleted",
        url: "http://deleted.com",
        path: ["Folder"],
        deleted: true,
        deletedAt: 123,
      },
    ];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.remoteChanges.deletions).to.have.lengthOf(1);
    expect(result.remoteChanges.deletions[0].title).to.equal("Deleted");
  });

  it("should detect no changes when bookmarks match", () => {
    const bookmark = {
      title: "Same",
      url: "http://same.com",
      path: ["Folder"],
      index: 0,
    };
    const local = [bookmark];
    const remote = [bookmark];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.localChanges.insertions).to.be.empty;
    expect(result.localChanges.deletions).to.be.empty;
    expect(result.localChanges.updates).to.be.empty;
    expect(result.remoteChanges.insertions).to.be.empty;
    expect(result.remoteChanges.deletions).to.be.empty;
  });

  it("should handle mixed scenario with insertions and deletions", () => {
    const local = [
      { title: "LocalOnly", url: "http://local.com", path: [], index: 0 },
      { title: "Both", url: "http://both.com", path: [], index: 1 },
    ];
    const remote = [
      { title: "Both", url: "http://both.com", path: [], index: 0 },
      { title: "RemoteOnly", url: "http://remote.com", path: [], index: 1 },
    ];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].title).to.equal("LocalOnly");
    expect(result.localChanges.insertions).to.have.lengthOf(1);
    expect(result.localChanges.insertions[0].title).to.equal("RemoteOnly");
  });

  it("should handle three machines scenario correctly", () => {
    // Machine A adds bookmark, syncs
    // Machine B syncs, sees new bookmark
    // Machine C syncs after B, also sees new bookmark

    // Simulating Machine C's sync - remote has bookmark, local doesn't, no tombstones
    const local = [];
    const remote = [
      { title: "NewFromA", url: "http://new.com", path: ["Folder"], index: 0 },
    ];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    // Should pull the new bookmark, not try to delete it
    expect(result.localChanges.insertions).to.have.lengthOf(1);
    expect(result.localChanges.insertions[0].title).to.equal("NewFromA");
    expect(result.remoteChanges.deletions).to.be.empty;
  });

  it("should handle deletion propagation across machines", () => {
    // Machine A deletes bookmark, syncs (tombstone in remote)
    // Machine B has the bookmark, syncs, should delete locally

    const local = [
      {
        title: "ToDelete",
        url: "http://delete.com",
        path: ["Folder"],
        index: 0,
      },
    ];
    const remote = [
      {
        title: "ToDelete",
        url: "http://delete.com",
        path: ["Folder"],
        deleted: true,
        deletedAt: 123,
      },
    ];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.localChanges.deletions).to.have.lengthOf(1);
    expect(result.localChanges.deletions[0].title).to.equal("ToDelete");
  });
});

describe("bookmarksEqual Tests", () => {
  it("should return true for identical bookmarks", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(bookmarksEqual(a, b)).to.be.true;
  });

  it("should return false for different titles", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "B", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(bookmarksEqual(a, b)).to.be.false;
  });

  it("should return false for different indexes", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "A", url: "http://a.com", path: ["Folder"], index: 1 };
    expect(bookmarksEqual(a, b)).to.be.false;
  });

  it("should return true for both null/undefined", () => {
    expect(bookmarksEqual(null, null)).to.be.true;
    expect(bookmarksEqual(undefined, undefined)).to.be.true;
  });

  it("should return false when one is null/undefined", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(bookmarksEqual(a, null)).to.be.false;
    expect(bookmarksEqual(null, a)).to.be.false;
  });
});

describe("3-of-4 Matching Tests", () => {
  it("should match when all 4 attributes are equal", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(matchBookmarks3of4(a, b)).to.be.true;
  });

  it("should match when only title differs (3 of 4 match)", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "B", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(matchBookmarks3of4(a, b)).to.be.true;
  });

  it("should match when only url differs (3 of 4 match)", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "A", url: "http://b.com", path: ["Folder"], index: 0 };
    expect(matchBookmarks3of4(a, b)).to.be.true;
  });

  it("should match when only path differs (3 of 4 match)", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 };
    const b = { title: "A", url: "http://a.com", path: ["Folder2"], index: 0 };
    expect(matchBookmarks3of4(a, b)).to.be.true;
  });

  it("should match when only index differs (3 of 4 match)", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "A", url: "http://a.com", path: ["Folder"], index: 5 };
    expect(matchBookmarks3of4(a, b)).to.be.true;
  });

  it("should NOT match when 2 attributes differ", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const b = { title: "B", url: "http://b.com", path: ["Folder"], index: 0 };
    expect(matchBookmarks3of4(a, b)).to.be.false;
  });

  it("should NOT match when 3 attributes differ", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 };
    const b = { title: "B", url: "http://b.com", path: ["Folder2"], index: 0 };
    expect(matchBookmarks3of4(a, b)).to.be.false;
  });

  it("should return false when either bookmark is null", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(matchBookmarks3of4(a, null)).to.be.false;
    expect(matchBookmarks3of4(null, a)).to.be.false;
    expect(matchBookmarks3of4(null, null)).to.be.false;
  });
});

describe("findChangedAttribute Tests", () => {
  it("should return 'title' when title changed", () => {
    const old = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const new_ = {
      title: "B",
      url: "http://a.com",
      path: ["Folder"],
      index: 0,
    };
    expect(findChangedAttribute(old, new_)).to.equal("title");
  });

  it("should return 'url' when url changed", () => {
    const old = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const new_ = {
      title: "A",
      url: "http://b.com",
      path: ["Folder"],
      index: 0,
    };
    expect(findChangedAttribute(old, new_)).to.equal("url");
  });

  it("should return 'path' when path changed", () => {
    const old = {
      title: "A",
      url: "http://a.com",
      path: ["Folder1"],
      index: 0,
    };
    const new_ = {
      title: "A",
      url: "http://a.com",
      path: ["Folder2"],
      index: 0,
    };
    expect(findChangedAttribute(old, new_)).to.equal("path");
  });

  it("should return 'index' when index changed", () => {
    const old = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const new_ = {
      title: "A",
      url: "http://a.com",
      path: ["Folder"],
      index: 5,
    };
    expect(findChangedAttribute(old, new_)).to.equal("index");
  });

  it("should return null when nothing changed", () => {
    const old = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    const new_ = {
      title: "A",
      url: "http://a.com",
      path: ["Folder"],
      index: 0,
    };
    expect(findChangedAttribute(old, new_)).to.be.null;
  });

  it("should return null when either bookmark is null", () => {
    const a = { title: "A", url: "http://a.com", path: ["Folder"], index: 0 };
    expect(findChangedAttribute(a, null)).to.be.null;
    expect(findChangedAttribute(null, a)).to.be.null;
  });
});

describe("Multi-Machine Scenarios (3 machines)", () => {
  it("should propagate new bookmark from Machine A to Machine B and C", () => {
    // Machine A adds bookmark, syncs to remote
    // Machine B syncs - should pull the new bookmark
    // Machine C syncs - should also pull the new bookmark

    const newBookmark = {
      title: "NewFromA",
      url: "http://new.com",
      path: ["Folder"],
      index: 0,
    };

    // Machine B's perspective: empty local, remote has new bookmark
    const localB = [];
    const remoteAfterA = [newBookmark];
    const tombstonesB = [];

    const resultB = calcTombstoneChanges(localB, remoteAfterA, tombstonesB);
    expect(resultB.localChanges.insertions).to.have.lengthOf(1);
    expect(resultB.localChanges.insertions[0].title).to.equal("NewFromA");
    expect(resultB.remoteChanges.deletions).to.be.empty;

    // Machine C's perspective: same situation
    const localC = [];
    const tombstonesC = [];

    const resultC = calcTombstoneChanges(localC, remoteAfterA, tombstonesC);
    expect(resultC.localChanges.insertions).to.have.lengthOf(1);
    expect(resultC.localChanges.insertions[0].title).to.equal("NewFromA");
    expect(resultC.remoteChanges.deletions).to.be.empty;
  });

  it("should propagate deletion from Machine A to Machine B and C", () => {
    // All machines start with same bookmark
    // Machine A deletes bookmark, syncs tombstone to remote
    // Machine B syncs - should delete locally
    // Machine C syncs - should also delete locally

    const bookmark = {
      title: "ToDelete",
      url: "http://delete.com",
      path: ["Folder"],
      index: 0,
    };
    const tombstone = {
      title: "ToDelete",
      url: "http://delete.com",
      path: ["Folder"],
      deleted: true,
      deletedAt: Date.now(),
    };

    // Machine B's perspective: has bookmark locally, remote has tombstone
    const localB = [bookmark];
    const remoteAfterA = [tombstone];
    const tombstonesB = [];

    const resultB = calcTombstoneChanges(localB, remoteAfterA, tombstonesB);
    expect(resultB.localChanges.deletions).to.have.lengthOf(1);
    expect(resultB.localChanges.deletions[0].title).to.equal("ToDelete");

    // Machine C's perspective: same situation
    const localC = [bookmark];
    const tombstonesC = [];

    const resultC = calcTombstoneChanges(localC, remoteAfterA, tombstonesC);
    expect(resultC.localChanges.deletions).to.have.lengthOf(1);
    expect(resultC.localChanges.deletions[0].title).to.equal("ToDelete");
  });

  it("should handle simultaneous additions from Machine A and B", () => {
    // Machine A adds bookmark X, Machine B adds bookmark Y (before syncing)
    // When B syncs: should pull X from remote, push Y to remote

    const bookmarkX = {
      title: "FromA",
      url: "http://a.com",
      path: ["Folder"],
      index: 0,
    };
    const bookmarkY = {
      title: "FromB",
      url: "http://b.com",
      path: ["Folder"],
      index: 1,
    };

    // Machine B's perspective after A synced
    const localB = [bookmarkY];
    const remoteAfterA = [bookmarkX];
    const tombstonesB = [];

    const resultB = calcTombstoneChanges(localB, remoteAfterA, tombstonesB);

    // B should pull X
    expect(resultB.localChanges.insertions).to.have.lengthOf(1);
    expect(resultB.localChanges.insertions[0].title).to.equal("FromA");

    // B should push Y
    expect(resultB.remoteChanges.insertions).to.have.lengthOf(1);
    expect(resultB.remoteChanges.insertions[0].title).to.equal("FromB");
  });

  it("should handle Machine A deletes while Machine B adds same bookmark", () => {
    // Machine A has bookmark, deletes it, syncs tombstone
    // Machine B (offline) adds same bookmark, then syncs
    // Tombstone should win - B should delete locally

    const bookmark = {
      title: "Contested",
      url: "http://contested.com",
      path: ["Folder"],
      index: 0,
    };
    const tombstone = {
      title: "Contested",
      url: "http://contested.com",
      path: ["Folder"],
      deleted: true,
      deletedAt: Date.now(),
    };

    // Machine B's perspective: has bookmark, remote has tombstone
    const localB = [bookmark];
    const remoteAfterA = [tombstone];
    const tombstonesB = [];

    const resultB = calcTombstoneChanges(localB, remoteAfterA, tombstonesB);

    // Tombstone wins - B should delete locally
    expect(resultB.localChanges.deletions).to.have.lengthOf(1);
    expect(resultB.localChanges.deletions[0].title).to.equal("Contested");
    expect(resultB.remoteChanges.insertions).to.be.empty;
  });

  it("should handle both Machine A and B deleting same bookmark", () => {
    // Both machines delete the same bookmark independently
    // When B syncs: should see remote tombstone, have local tombstone, no conflict

    const tombstone = {
      title: "BothDeleted",
      url: "http://both.com",
      path: ["Folder"],
      deleted: true,
      deletedAt: Date.now(),
    };

    // Machine B's perspective: empty local (deleted), remote has tombstone, local has tombstone
    const localB = [];
    const remoteAfterA = [tombstone];
    const tombstonesB = [tombstone];

    const resultB = calcTombstoneChanges(localB, remoteAfterA, tombstonesB);

    // No changes needed - both sides agree it's deleted
    expect(resultB.localChanges.insertions).to.be.empty;
    expect(resultB.localChanges.deletions).to.be.empty;
    expect(resultB.remoteChanges.insertions).to.be.empty;
    expect(resultB.remoteChanges.deletions).to.be.empty;
  });

  it("should handle Machine C syncing after A adds and B deletes", () => {
    // Machine A adds bookmark, syncs
    // Machine B syncs (gets bookmark), then deletes it, syncs tombstone
    // Machine C syncs - should see tombstone, not have bookmark locally

    const tombstone = {
      title: "AddedThenDeleted",
      url: "http://addeddeleted.com",
      path: ["Folder"],
      deleted: true,
      deletedAt: Date.now(),
    };

    // Machine C's perspective: empty local, remote has tombstone
    const localC = [];
    const remoteAfterB = [tombstone];
    const tombstonesC = [];

    const resultC = calcTombstoneChanges(localC, remoteAfterB, tombstonesC);

    // No insertions (tombstone present), no deletions (nothing to delete)
    expect(resultC.localChanges.insertions).to.be.empty;
    expect(resultC.localChanges.deletions).to.be.empty;
    expect(resultC.remoteChanges.insertions).to.be.empty;
  });

  it("should handle complex scenario: A adds, B modifies different bookmark, C deletes third", () => {
    // Starting state: all have bookmark1 and bookmark2
    // Machine A adds bookmark3
    // Machine B has bookmark1, bookmark2 (no change)
    // Machine C deletes bookmark2

    const bookmark1 = {
      title: "Bookmark1",
      url: "http://b1.com",
      path: [],
      index: 0,
    };
    const bookmark2 = {
      title: "Bookmark2",
      url: "http://b2.com",
      path: [],
      index: 1,
    };
    const bookmark3 = {
      title: "Bookmark3",
      url: "http://b3.com",
      path: [],
      index: 2,
    };
    const tombstone2 = {
      title: "Bookmark2",
      url: "http://b2.com",
      path: [],
      deleted: true,
      deletedAt: Date.now(),
    };

    // After A syncs: remote has bookmark1, bookmark2, bookmark3
    // After C syncs: remote has bookmark1, bookmark3, tombstone2

    // Machine B syncs last - perspective:
    const localB = [bookmark1, bookmark2]; // B still has bookmark2
    const remoteAfterAC = [bookmark1, bookmark3, tombstone2];
    const tombstonesB = [];

    const resultB = calcTombstoneChanges(localB, remoteAfterAC, tombstonesB);

    // B should delete bookmark2 (tombstone from C)
    expect(resultB.localChanges.deletions).to.have.lengthOf(1);
    expect(resultB.localChanges.deletions[0].title).to.equal("Bookmark2");

    // B should pull bookmark3 (added by A)
    expect(resultB.localChanges.insertions).to.have.lengthOf(1);
    expect(resultB.localChanges.insertions[0].title).to.equal("Bookmark3");

    // B has nothing new to push
    expect(resultB.remoteChanges.insertions).to.be.empty;
  });

  it("should handle rapid sync cycles without duplication", () => {
    // Simulate multiple sync cycles - bookmarks should not duplicate

    const bookmark = {
      title: "Stable",
      url: "http://stable.com",
      path: ["Folder"],
      index: 0,
    };

    // First sync cycle - both have same bookmark
    const local1 = [bookmark];
    const remote1 = [bookmark];
    const tombstones1 = [];

    const result1 = calcTombstoneChanges(local1, remote1, tombstones1);
    expect(result1.localChanges.insertions).to.be.empty;
    expect(result1.remoteChanges.insertions).to.be.empty;

    // Second sync cycle - same state
    const result2 = calcTombstoneChanges(local1, remote1, tombstones1);
    expect(result2.localChanges.insertions).to.be.empty;
    expect(result2.remoteChanges.insertions).to.be.empty;

    // Third sync cycle - same state
    const result3 = calcTombstoneChanges(local1, remote1, tombstones1);
    expect(result3.localChanges.insertions).to.be.empty;
    expect(result3.remoteChanges.insertions).to.be.empty;
  });
});

describe("Change Log Based Conflict Detection", () => {
  it("should treat 3-of-4 difference as remote update when no change log", () => {
    // No change log = local didn't change = remote changed, pull to local
    const localBookmark = {
      title: "X",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };
    const remoteBookmark = {
      title: "X2",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };

    const result = calcTombstoneChanges(
      [localBookmark],
      [remoteBookmark],
      [],
      [],
    );

    // No change log = remote update, not conflict
    expect(result.localChanges.updates).to.have.lengthOf(1);
    expect(result.localChanges.updates[0].oldBookmark.title).to.equal("X");
    expect(result.localChanges.updates[0].newBookmark.title).to.equal("X2");
    expect(result.localChanges.updates[0].changedAttribute).to.equal("title");

    expect(result.conflicts).to.be.empty;
    expect(result.localChanges.insertions).to.be.empty;
    expect(result.remoteChanges.insertions).to.be.empty;
  });

  it("should treat 3-of-4 difference as local update when change log shows local changed", () => {
    const localBookmark = {
      title: "X2",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };
    const remoteBookmark = {
      title: "X",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };

    // Change log shows local changed from X to X2
    const changeLog = [
      {
        type: "changed",
        bookmark: {
          title: "X2",
          url: "http://example.com",
          path: ["Folder"],
          index: 0,
        },
        oldValues: {
          title: "X",
          url: "http://example.com",
          path: ["Folder"],
          index: 0,
        },
      },
    ];

    const result = calcTombstoneChanges(
      [localBookmark],
      [remoteBookmark],
      [],
      changeLog,
    );

    // Change log shows we changed from remote state = push to remote
    expect(result.remoteChanges.updates).to.have.lengthOf(1);
    expect(result.remoteChanges.updates[0].oldBookmark.title).to.equal("X");
    expect(result.remoteChanges.updates[0].newBookmark.title).to.equal("X2");

    expect(result.conflicts).to.be.empty;
  });

  it("should detect conflict when both local and remote changed", () => {
    // Local changed from X to X2, but remote is now X3 (someone else changed it)
    const localBookmark = {
      title: "X2",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };
    const remoteBookmark = {
      title: "X3",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };

    // Change log shows local changed from X to X2
    const changeLog = [
      {
        type: "changed",
        bookmark: {
          title: "X2",
          url: "http://example.com",
          path: ["Folder"],
          index: 0,
        },
        oldValues: {
          title: "X",
          url: "http://example.com",
          path: ["Folder"],
          index: 0,
        },
      },
    ];

    const result = calcTombstoneChanges(
      [localBookmark],
      [remoteBookmark],
      [],
      changeLog,
    );

    // Remote is X3, not X (our old state), so it's a real conflict
    expect(result.conflicts).to.have.lengthOf(1);
    expect(result.conflicts[0].local.title).to.equal("X2");
    expect(result.conflicts[0].remote.title).to.equal("X3");
  });

  it("should detect index-only change as update to remote (not conflict)", () => {
    // When identity matches but only index differs, local wins (not a conflict)
    const localBookmark = {
      title: "Test",
      url: "http://example.com",
      path: ["Folder"],
      index: 5,
    };
    const remoteBookmark = {
      title: "Test",
      url: "http://example.com",
      path: ["Folder"],
      index: 0,
    };

    const result = calcTombstoneChanges(
      [localBookmark],
      [remoteBookmark],
      [],
      [],
    );

    // Index-only changes are updates, not conflicts
    expect(result.remoteChanges.updates).to.have.lengthOf(1);
    expect(result.remoteChanges.updates[0].changedAttribute).to.equal("index");
    expect(result.remoteChanges.updates[0].newBookmark.index).to.equal(5);

    expect(result.conflicts).to.be.empty;
    expect(result.localChanges.updates).to.be.empty;
  });

  it("should NOT match as conflict when 2 or more attributes differ", () => {
    // Title and URL both changed - no 3-of-4 match, treat as insert/delete
    const localBookmark = {
      title: "NewTitle",
      url: "http://new-url.com",
      path: ["Folder"],
      index: 0,
    };
    const remoteBookmark = {
      title: "OldTitle",
      url: "http://old-url.com",
      path: ["Folder"],
      index: 0,
    };

    const result = calcTombstoneChanges(
      [localBookmark],
      [remoteBookmark],
      [],
      [],
    );

    // Should be separate insert and delete, not conflict
    expect(result.conflicts).to.be.empty;
    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.localChanges.insertions).to.have.lengthOf(1);
  });

  it("should handle multiple remote updates when no change log", () => {
    const local = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];
    const remote = [
      { title: "A-updated", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b-updated.com", path: ["Folder"], index: 1 },
    ];

    const result = calcTombstoneChanges(local, remote, [], []);

    // No change log = all are remote updates
    expect(result.localChanges.updates).to.have.lengthOf(2);
    expect(result.conflicts).to.be.empty;
  });

  it("should handle remote update alongside new local insertions", () => {
    const local = [
      {
        title: "Existing",
        url: "http://example.com",
        path: ["Folder"],
        index: 0,
      },
      {
        title: "NewBookmark",
        url: "http://new.com",
        path: ["Folder"],
        index: 1,
      },
    ];
    const remote = [
      {
        title: "Existing-updated",
        url: "http://example.com",
        path: ["Folder"],
        index: 0,
      },
    ];

    // Change log shows NewBookmark was locally created
    const changeLog = [
      {
        type: "created",
        bookmark: {
          title: "NewBookmark",
          url: "http://new.com",
          path: ["Folder"],
          index: 1,
        },
      },
    ];

    const result = calcTombstoneChanges(local, remote, [], changeLog);

    // Remote update (Existing -> Existing-updated) and local insertion (NewBookmark)
    expect(result.localChanges.updates).to.have.lengthOf(1);
    expect(result.localChanges.updates[0].newBookmark.title).to.equal(
      "Existing-updated",
    );
    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].title).to.equal("NewBookmark");
  });
});

describe("Edge Cases", () => {
  it("should handle empty bookmarks on all sides", () => {
    const result = calcTombstoneChanges([], [], []);
    expect(result.localChanges.insertions).to.be.empty;
    expect(result.localChanges.deletions).to.be.empty;
    expect(result.remoteChanges.insertions).to.be.empty;
    expect(result.remoteChanges.deletions).to.be.empty;
  });

  it("should handle folders (no URL)", () => {
    const local = [{ title: "Folder", path: ["Parent"], index: 0 }];
    const remote = [];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].title).to.equal("Folder");
  });

  it("should handle special characters in titles and URLs", () => {
    const bookmark = {
      title: "Test & <Script>",
      url: "http://example.com/path?a=1&b=2",
      path: ["Folder"],
      index: 0,
    };
    const local = [bookmark];
    const remote = [];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].title).to.equal(
      "Test & <Script>",
    );
  });

  it("should handle deeply nested paths", () => {
    const bookmark = {
      title: "Deep",
      url: "http://deep.com",
      path: ["L1", "L2", "L3", "L4", "L5"],
      index: 0,
    };
    const local = [bookmark];
    const remote = [];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].path).to.deep.equal([
      "L1",
      "L2",
      "L3",
      "L4",
      "L5",
    ]);
  });

  it("should handle duplicate bookmarks in different folders", () => {
    const local = [
      { title: "Same", url: "http://same.com", path: ["Folder1"], index: 0 },
      { title: "Same", url: "http://same.com", path: ["Folder2"], index: 0 },
    ];
    const remote = [
      { title: "Same", url: "http://same.com", path: ["Folder1"], index: 0 },
    ];
    const localTombstones = [];

    const result = calcTombstoneChanges(local, remote, localTombstones);

    // Should push the second copy
    expect(result.remoteChanges.insertions).to.have.lengthOf(1);
    expect(result.remoteChanges.insertions[0].path).to.deep.equal(["Folder2"]);
  });
});
