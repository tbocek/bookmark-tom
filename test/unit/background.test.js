import { expect } from "chai";
import sinon from "sinon";
import { loadModule } from "../setup.js";

// Load dependencies in order (matching manifest.json load order)
const syncMod = loadModule("src/sync.js");

// Make sync.js functions available globally (as they would be in the browser)
global.arraysEqual = syncMod.arraysEqual;
global.calcSyncChanges = syncMod.calcSyncChanges;
global.detectFolderConflicts = syncMod.detectFolderConflicts;
global.createTombstone = syncMod.createTombstone;
global.calcMove = syncMod.calcMove;
global.pathStartsWith = syncMod.pathStartsWith;
global.bookmarksEqual = syncMod.bookmarksEqual;
global.getActive = syncMod.getActive;
global.getTombstones = syncMod.getTombstones;
global.findExact = syncMod.findExact;
global.isTombstone = syncMod.isTombstone;
global.isFolder = syncMod.isFolder;

// Load storage.js and make functions global
const storageMod = loadModule("src/storage.js");
global.getBookmarkIdMap = storageMod.getBookmarkIdMap;
global.saveBookmarkIdMap = storageMod.saveBookmarkIdMap;
global.initializeBookmarkIdMap = storageMod.initializeBookmarkIdMap;
global.recordChange = storageMod.recordChange;
global.getLocalTombstones = storageMod.getLocalTombstones;
global.saveLocalTombstones = storageMod.saveLocalTombstones;
global.addLocalTombstone = storageMod.addLocalTombstone;
global.addLocalTombstoneDirectly = storageMod.addLocalTombstoneDirectly;
global.removeLocalTombstonesForPath = storageMod.removeLocalTombstonesForPath;
global.getLastSyncedState = storageMod.getLastSyncedState;
global.saveLastSyncedState = storageMod.saveLastSyncedState;
global.saveDebugLog = storageMod.saveDebugLog;
global.getDebugLogs = storageMod.getDebugLogs;

// Load webdav.js and make functions global
const webdavMod = loadModule("src/webdav.js");
global.fetchWebDAV = webdavMod.fetchWebDAV;
global.updateWebDAV = webdavMod.updateWebDAV;
global.loadConfig = webdavMod.loadConfig;

// Load bookmarks.js and make functions global
const bookmarksMod = loadModule("src/bookmarks.js");
global.getBookmarkPath = bookmarksMod.getBookmarkPath;
global.retrieveLocalBookmarks = bookmarksMod.retrieveLocalBookmarks;
global.getLocalBookmarksSnapshot = bookmarksMod.getLocalBookmarksSnapshot;
global.locateBookmarkId = bookmarksMod.locateBookmarkId;
global.locateParentId = bookmarksMod.locateParentId;
global.createFolderPath = bookmarksMod.createFolderPath;
global.modifyLocalBookmarks = bookmarksMod.modifyLocalBookmarks;
global.applyLocalUpdates = bookmarksMod.applyLocalUpdates;

// Now load background.js
const bgMod = loadModule("src/background.js");
const {
  shouldKeepTombstone,
  createTombstonesForFolderContents,
  removeDuplicateBookmarks,
  formatSyncTime,
  ACTIONS,
} = bgMod;

describe("Background Module", () => {
  beforeEach(() => {
    sinon.resetBehavior();
    browser.bookmarks.get.reset();
    browser.bookmarks.getTree.reset();
    browser.bookmarks.getChildren.reset();
    browser.bookmarks.search.reset();
    browser.bookmarks.create.reset();
    browser.bookmarks.remove.reset();
    browser.bookmarks.removeTree.reset();
    browser.bookmarks.update.reset();
    browser.bookmarks.move.reset();
    browser.storage.local.get.reset();
    browser.storage.local.set.reset();
    global.fetch.reset();

    // Default resolves
    browser.bookmarks.create.resolves({ id: "new1" });
    browser.bookmarks.remove.resolves();
    browser.bookmarks.removeTree.resolves();
    browser.bookmarks.update.resolves();
    browser.bookmarks.move.resolves();
    browser.storage.local.get.resolves({});
    browser.storage.local.set.resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  // ============================================
  // ACTIONS constant
  // ============================================

  describe("ACTIONS", () => {
    it("defines expected action constants", () => {
      expect(ACTIONS.SYNC).to.equal("Sync");
      expect(ACTIONS.CONFLICT).to.equal("Conflict");
      expect(ACTIONS.CONFLICT_LOCAL).to.equal("Conflict-local");
      expect(ACTIONS.CONFLICT_REMOTE).to.equal("Conflict-remote");
      expect(ACTIONS.CANCEL).to.equal("cancelChanges");
    });
  });

  // ============================================
  // formatSyncTime
  // ============================================

  describe("formatSyncTime()", () => {
    it("returns a date string", () => {
      const result = formatSyncTime();
      expect(result).to.be.a("string");
      expect(result.length).to.be.greaterThan(0);
    });
  });

  // ============================================
  // shouldKeepTombstone
  // ============================================

  describe("shouldKeepTombstone()", () => {
    it("removes folder tombstone when folder has active content", () => {
      const tombstone = {
        title: "F",
        path: ["Toolbar"],
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "F"], index: 0 },
      ];
      // Folder has content -> should NOT keep tombstone
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.false;
    });

    it("keeps folder tombstone when folder has no content", () => {
      const tombstone = {
        title: "F",
        path: ["Toolbar"],
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [
        { title: "X", url: "http://x.com", path: ["Other"], index: 0 },
      ];
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.true;
    });

    it("removes bookmark tombstone when revived (3-of-3 match)", () => {
      const tombstone = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 0,
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.false;
    });

    it("keeps bookmark tombstone when not revived", () => {
      const tombstone = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 0,
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 0 },
      ];
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.true;
    });

    it("removes bookmark tombstone when revived with different index", () => {
      // bookmarksEqual uses 3-of-3 (ignores index), so different index = still revived
      const tombstone = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 0,
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.false;
    });

    it("removes folder tombstone when content is deeply nested", () => {
      const tombstone = {
        title: "F",
        path: ["Toolbar"],
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F", "Sub", "Deep"],
          index: 0,
        },
      ];
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.false;
    });

    it("keeps empty folder tombstone (no content, not revived as folder)", () => {
      const tombstone = {
        title: "EmptyF",
        path: ["Toolbar"],
        deleted: true,
        deletedAt: Date.now(),
      };
      const activeBookmarks = [];
      expect(shouldKeepTombstone(tombstone, activeBookmarks)).to.be.true;
    });
  });

  // ============================================
  // createTombstonesForFolderContents
  // ============================================

  describe("createTombstonesForFolderContents()", () => {
    it("creates tombstones for flat folder contents", async () => {
      browser.bookmarks.getChildren.resolves([
        { id: "c1", title: "A", url: "http://a.com", index: 0 },
        { id: "c2", title: "B", url: "http://b.com", index: 1 },
      ]);
      browser.storage.local.get.resolves({ tombstones: [] });

      await createTombstonesForFolderContents("folder1", ["Toolbar", "F"]);

      // Should have saved tombstones (addLocalTombstoneDirectly called twice)
      const setCalls = browser.storage.local.set.getCalls();
      // Each addLocalTombstoneDirectly call saves, so we should have 2 saves
      expect(setCalls.length).to.be.at.least(2);
    });

    it("creates tombstones recursively for nested folders", async () => {
      // Folder has a subfolder with a bookmark
      browser.bookmarks.getChildren.withArgs("folder1").resolves([
        { id: "subfolder", title: "Sub", index: 0 }, // No url = folder
        { id: "c1", title: "A", url: "http://a.com", index: 1 },
      ]);
      browser.bookmarks.getChildren
        .withArgs("subfolder")
        .resolves([{ id: "c2", title: "B", url: "http://b.com", index: 0 }]);
      browser.storage.local.get.resolves({ tombstones: [] });

      await createTombstonesForFolderContents("folder1", ["Toolbar", "F"]);

      // Should create tombstones for: Sub, A, B = 3 saves
      const setCalls = browser.storage.local.set.getCalls();
      expect(setCalls.length).to.be.at.least(3);
    });

    it("handles empty folder (no children)", async () => {
      browser.bookmarks.getChildren.resolves([]);

      await createTombstonesForFolderContents("emptyFolder", ["Toolbar", "F"]);

      // No tombstones to create
      expect(browser.storage.local.set.called).to.be.false;
    });
  });

  // ============================================
  // removeDuplicateBookmarks
  // ============================================

  describe("removeDuplicateBookmarks()", () => {
    it("does nothing when no duplicates", async () => {
      browser.bookmarks.get.resolves([
        { id: "bm1", title: "X", url: "http://x.com", parentId: "toolbar" },
      ]);
      browser.bookmarks.getChildren.resolves([
        { id: "bm1", title: "X", url: "http://x.com" },
        { id: "bm2", title: "Y", url: "http://y.com" },
      ]);

      await removeDuplicateBookmarks("bm1");

      expect(browser.bookmarks.remove.called).to.be.false;
    });

    it("removes duplicate bookmark (same title/url, different id)", async () => {
      browser.bookmarks.get.resolves([
        { id: "bm1", title: "X", url: "http://x.com", parentId: "toolbar" },
      ]);
      browser.bookmarks.getChildren.resolves([
        { id: "bm1", title: "X", url: "http://x.com" },
        { id: "bm2", title: "X", url: "http://x.com" }, // duplicate
      ]);

      await removeDuplicateBookmarks("bm1");

      expect(browser.bookmarks.remove.calledOnce).to.be.true;
      expect(browser.bookmarks.remove.firstCall.args[0]).to.equal("bm2");
    });

    it("merges duplicate folder children before removing", async () => {
      browser.bookmarks.get.resolves([
        { id: "f1", title: "Folder", parentId: "toolbar" }, // No url = folder
      ]);
      browser.bookmarks.getChildren.withArgs("toolbar").resolves([
        { id: "f1", title: "Folder" },
        { id: "f2", title: "Folder" }, // duplicate folder
      ]);
      browser.bookmarks.getChildren
        .withArgs("f2")
        .resolves([
          { id: "child1", title: "A", url: "http://a.com", index: 0 },
        ]);
      browser.bookmarks.getChildren.withArgs("f1").resolves([]); // for recursive check

      // getBookmarkPath for dup folder
      browser.bookmarks.get
        .withArgs("f2")
        .resolves([{ id: "f2", title: "Folder", parentId: "toolbar" }]);
      browser.bookmarks.get
        .withArgs("toolbar")
        .resolves([{ id: "toolbar", title: "Toolbar", parentId: "root" }]);
      browser.bookmarks.get
        .withArgs("root")
        .resolves([{ id: "root", title: "" }]);

      browser.storage.local.get.resolves({ tombstones: [] });

      await removeDuplicateBookmarks("f1");

      // Child should be moved to f1
      expect(browser.bookmarks.move.calledWith("child1", { parentId: "f1" })).to
        .be.true;
      // Duplicate folder f2 should be removed
      expect(browser.bookmarks.remove.calledWith("f2")).to.be.true;
    });

    it("handles bookmark not found gracefully", async () => {
      browser.bookmarks.get.rejects(new Error("Not found"));

      // Should not throw
      await removeDuplicateBookmarks("nonexistent");
    });
  });
});
