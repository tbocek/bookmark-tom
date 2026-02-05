import { expect } from "chai";
import sinon from "sinon";
import { loadModule } from "../setup.js";

const mod = loadModule("src/storage.js");
const {
  getBookmarkIdMap,
  saveBookmarkIdMap,
  initializeBookmarkIdMap,
  recordChange,
  getLocalTombstones,
  saveLocalTombstones,
  addLocalTombstone,
  addLocalTombstoneDirectly,
  removeLocalTombstonesForPath,
  getLastSyncedState,
  saveLastSyncedState,
  saveDebugLog,
  getDebugLogs,
} = mod;

describe("Storage Module", () => {
  beforeEach(() => {
    // Reset stubs individually (keeps them as stubs, unlike sinon.restore())
    browser.storage.local.get.reset();
    browser.storage.local.set.reset();
    browser.storage.local.remove.reset();
    browser.bookmarks.getTree.reset();
    browser.bookmarks.get.reset();

    // Default behaviors
    browser.storage.local.get.resolves({});
    browser.storage.local.set.resolves();
    browser.storage.local.remove.resolves();
  });

  // ============================================
  // getBookmarkIdMap / saveBookmarkIdMap
  // ============================================

  describe("getBookmarkIdMap()", () => {
    it("returns empty object when no map stored", async () => {
      browser.storage.local.get.resolves({});
      const map = await getBookmarkIdMap();
      expect(map).to.deep.equal({});
    });

    it("returns stored map", async () => {
      const stored = {
        id1: { title: "X", path: ["Toolbar"], url: "http://x.com", index: 0 },
      };
      browser.storage.local.get.resolves({ bookmarkIdMap: stored });
      const map = await getBookmarkIdMap();
      expect(map).to.deep.equal(stored);
    });
  });

  describe("saveBookmarkIdMap()", () => {
    it("saves map to storage", async () => {
      const map = { id1: { title: "X" } };
      await saveBookmarkIdMap(map);
      expect(browser.storage.local.set.calledOnce).to.be.true;
      expect(browser.storage.local.set.firstCall.args[0]).to.deep.equal({
        bookmarkIdMap: map,
      });
    });
  });

  // ============================================
  // initializeBookmarkIdMap
  // ============================================

  describe("initializeBookmarkIdMap()", () => {
    it("walks bookmark tree and builds map", async () => {
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [
            {
              id: "toolbar",
              title: "Bookmarks Toolbar",
              index: 0,
              children: [
                {
                  id: "bm1",
                  title: "Google",
                  url: "http://google.com",
                  index: 0,
                },
                {
                  id: "folder1",
                  title: "News",
                  index: 1,
                  children: [
                    {
                      id: "bm2",
                      title: "BBC",
                      url: "http://bbc.com",
                      index: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);

      await initializeBookmarkIdMap();

      expect(browser.storage.local.set.calledOnce).to.be.true;
      const savedMap =
        browser.storage.local.set.firstCall.args[0].bookmarkIdMap;

      expect(savedMap["bm1"]).to.deep.include({
        title: "Google",
        url: "http://google.com",
        path: ["Bookmarks Toolbar"],
      });
      expect(savedMap["bm2"]).to.deep.include({
        title: "BBC",
        url: "http://bbc.com",
        path: ["Bookmarks Toolbar", "News"],
      });
      expect(savedMap["folder1"]).to.deep.include({
        title: "News",
        path: ["Bookmarks Toolbar"],
      });
    });
  });

  // ============================================
  // recordChange
  // ============================================

  describe("recordChange()", () => {
    const mockGetPath = sinon.stub().resolves(["Toolbar"]);

    beforeEach(() => {
      mockGetPath.resetHistory();
      mockGetPath.resolves(["Toolbar"]);
    });

    it("skips when syncInProgress is true", async () => {
      browser.storage.local.get.resolves({ bookmarkIdMap: {} });
      await recordChange(
        "created",
        "id1",
        { parentId: "p1", title: "X", url: "http://x.com", index: 0 },
        mockGetPath,
        true,
      );
      // Should not save
      expect(browser.storage.local.set.called).to.be.false;
    });

    it("records 'created' change", async () => {
      browser.storage.local.get.resolves({ bookmarkIdMap: {} });
      await recordChange(
        "created",
        "id1",
        { parentId: "p1", title: "X", url: "http://x.com", index: 0 },
        mockGetPath,
        false,
      );

      expect(browser.storage.local.set.calledOnce).to.be.true;
      const savedMap =
        browser.storage.local.set.firstCall.args[0].bookmarkIdMap;
      expect(savedMap["id1"]).to.deep.include({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 0,
      });
    });

    it("records 'changed' - updates existing entry", async () => {
      const existing = {
        id1: {
          title: "Old",
          path: ["Toolbar"],
          url: "http://old.com",
          index: 0,
        },
      };
      browser.storage.local.get.resolves({ bookmarkIdMap: existing });

      await recordChange(
        "changed",
        "id1",
        { title: "New", url: "http://new.com" },
        mockGetPath,
        false,
      );

      const savedMap =
        browser.storage.local.set.firstCall.args[0].bookmarkIdMap;
      expect(savedMap["id1"].title).to.equal("New");
      expect(savedMap["id1"].url).to.equal("http://new.com");
      expect(savedMap["id1"].path).to.deep.equal(["Toolbar"]); // path unchanged
    });

    it("records 'changed' - falls back to browser.bookmarks.get for unknown id", async () => {
      browser.storage.local.get.resolves({ bookmarkIdMap: {} });
      browser.bookmarks.get.resolves([
        {
          id: "id1",
          title: "X",
          url: "http://x.com",
          parentId: "p1",
          index: 0,
        },
      ]);
      mockGetPath.withArgs("p1").resolves(["Toolbar"]);

      await recordChange("changed", "id1", { title: "X" }, mockGetPath, false);

      const savedMap =
        browser.storage.local.set.firstCall.args[0].bookmarkIdMap;
      expect(savedMap["id1"]).to.deep.include({
        title: "X",
        url: "http://x.com",
      });
    });

    it("records 'moved' change", async () => {
      const existing = {
        id1: { title: "X", path: ["OldPath"], url: "http://x.com", index: 0 },
      };
      browser.storage.local.get.resolves({ bookmarkIdMap: existing });
      mockGetPath.resolves(["NewPath"]);

      await recordChange(
        "moved",
        "id1",
        { parentId: "p2", index: 3 },
        mockGetPath,
        false,
      );

      const savedMap =
        browser.storage.local.set.firstCall.args[0].bookmarkIdMap;
      expect(savedMap["id1"].path).to.deep.equal(["NewPath"]);
      expect(savedMap["id1"].index).to.equal(3);
    });

    it("records 'removed' change", async () => {
      const existing = {
        id1: { title: "X", path: ["Toolbar"], url: "http://x.com", index: 0 },
        id2: { title: "Y", path: ["Toolbar"], url: "http://y.com", index: 1 },
      };
      browser.storage.local.get.resolves({ bookmarkIdMap: existing });

      await recordChange("removed", "id1", {}, mockGetPath, false);

      const savedMap =
        browser.storage.local.set.firstCall.args[0].bookmarkIdMap;
      expect(savedMap["id1"]).to.be.undefined;
      expect(savedMap["id2"]).to.exist;
    });
  });

  // ============================================
  // Tombstones
  // ============================================

  describe("getLocalTombstones()", () => {
    it("returns empty array when none stored", async () => {
      browser.storage.local.get.resolves({});
      const tombs = await getLocalTombstones();
      expect(tombs).to.deep.equal([]);
    });

    it("returns stored tombstones", async () => {
      const stored = [{ title: "X", deleted: true }];
      browser.storage.local.get.resolves({ tombstones: stored });
      const tombs = await getLocalTombstones();
      expect(tombs).to.deep.equal(stored);
    });
  });

  describe("saveLocalTombstones()", () => {
    it("saves tombstones to storage", async () => {
      const tombs = [{ title: "X", deleted: true }];
      await saveLocalTombstones(tombs);
      expect(browser.storage.local.set.calledWith({ tombstones: tombs })).to.be
        .true;
    });
  });

  describe("addLocalTombstone()", () => {
    it("adds new tombstone when not duplicate", async () => {
      browser.storage.local.get.resolves({ tombstones: [] });
      const mockCreate = (bm) => ({
        ...bm,
        deleted: true,
        deletedAt: Date.now(),
      });
      const mockMatch = () => false; // no match = not duplicate

      await addLocalTombstone(
        { title: "X", url: "http://x.com", path: ["Toolbar"] },
        mockCreate,
        mockMatch,
      );

      expect(browser.storage.local.set.calledOnce).to.be.true;
      const saved = browser.storage.local.set.firstCall.args[0].tombstones;
      expect(saved).to.have.lengthOf(1);
      expect(saved[0].deleted).to.be.true;
    });

    it("skips duplicate tombstone", async () => {
      const existing = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], deleted: true },
      ];
      browser.storage.local.get.resolves({ tombstones: existing });
      const mockCreate = (bm) => ({ ...bm, deleted: true });
      const mockMatch = () => true; // match = duplicate

      await addLocalTombstone(
        { title: "X", url: "http://x.com", path: ["Toolbar"] },
        mockCreate,
        mockMatch,
      );

      // Should not save (duplicate skipped)
      expect(browser.storage.local.set.called).to.be.false;
    });
  });

  describe("addLocalTombstoneDirectly()", () => {
    it("adds tombstone when not duplicate", async () => {
      browser.storage.local.get.resolves({ tombstones: [] });
      const mockMatch = () => false;

      await addLocalTombstoneDirectly(
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          deleted: true,
          deletedAt: 123,
        },
        mockMatch,
      );

      const saved = browser.storage.local.set.firstCall.args[0].tombstones;
      expect(saved).to.have.lengthOf(1);
    });

    it("skips existing tombstone", async () => {
      browser.storage.local.get.resolves({
        tombstones: [{ title: "X", deleted: true }],
      });
      const mockMatch = () => true;

      await addLocalTombstoneDirectly({ title: "X", deleted: true }, mockMatch);

      expect(browser.storage.local.set.called).to.be.false;
    });
  });

  // ============================================
  // removeLocalTombstonesForPath
  // ============================================

  describe("removeLocalTombstonesForPath()", () => {
    const arrEqual = (a, b) => {
      if (!a && !b) return true;
      if (!a || !b) return false;
      if (a.length !== b.length) return false;
      return a.every((v, i) => v === b[i]);
    };

    it("removes tombstones with exact path match", async () => {
      browser.storage.local.get.resolves({
        tombstones: [
          { title: "X", path: ["Toolbar", "F"], deleted: true },
          { title: "Y", path: ["Toolbar"], deleted: true },
        ],
      });

      await removeLocalTombstonesForPath(["Toolbar", "F"], arrEqual);

      const saved = browser.storage.local.set.firstCall.args[0].tombstones;
      expect(saved).to.have.lengthOf(1);
      expect(saved[0].title).to.equal("Y");
    });

    it("removes tombstones inside the path (children)", async () => {
      browser.storage.local.get.resolves({
        tombstones: [
          { title: "X", path: ["Toolbar", "F", "Sub"], deleted: true },
          { title: "Y", path: ["Toolbar", "F"], deleted: true },
          { title: "Z", path: ["Other"], deleted: true },
        ],
      });

      await removeLocalTombstonesForPath(["Toolbar", "F"], arrEqual);

      const saved = browser.storage.local.set.firstCall.args[0].tombstones;
      expect(saved).to.have.lengthOf(1);
      expect(saved[0].title).to.equal("Z");
    });

    it("does nothing when no tombstones match", async () => {
      browser.storage.local.get.resolves({
        tombstones: [{ title: "X", path: ["Other"], deleted: true }],
      });

      await removeLocalTombstonesForPath(["Toolbar", "F"], arrEqual);

      // No save because nothing changed
      expect(browser.storage.local.set.called).to.be.false;
    });
  });

  // ============================================
  // Last Synced State
  // ============================================

  describe("getLastSyncedState()", () => {
    it("returns empty array when none stored", async () => {
      browser.storage.local.get.resolves({});
      const state = await getLastSyncedState();
      expect(state).to.deep.equal([]);
    });

    it("returns stored state", async () => {
      const stored = [{ title: "X" }];
      browser.storage.local.get.resolves({ lastSyncedState: stored });
      const state = await getLastSyncedState();
      expect(state).to.deep.equal(stored);
    });
  });

  describe("saveLastSyncedState()", () => {
    it("saves state with timestamp", async () => {
      const before = Date.now();
      await saveLastSyncedState([{ title: "X" }]);

      expect(browser.storage.local.set.calledOnce).to.be.true;
      const args = browser.storage.local.set.firstCall.args[0];
      expect(args.lastSyncedState).to.deep.equal([{ title: "X" }]);
      expect(args.lastSyncTimestamp).to.be.at.least(before);
    });
  });

  // ============================================
  // Debug Logs
  // ============================================

  describe("saveDebugLog()", () => {
    it("adds log entry to front", async () => {
      browser.storage.local.get.resolves({ debugLogs: [{ ts: 1 }] });

      await saveDebugLog({ ts: 2 });

      const saved = browser.storage.local.set.firstCall.args[0].debugLogs;
      expect(saved[0].ts).to.equal(2);
      expect(saved[1].ts).to.equal(1);
    });

    it("respects MAX_DEBUG_LOGS limit of 3", async () => {
      browser.storage.local.get.resolves({
        debugLogs: [{ ts: 3 }, { ts: 2 }, { ts: 1 }],
      });

      await saveDebugLog({ ts: 4 });

      const saved = browser.storage.local.set.firstCall.args[0].debugLogs;
      expect(saved).to.have.lengthOf(3);
      expect(saved[0].ts).to.equal(4);
      expect(saved[2].ts).to.equal(2); // ts:1 dropped
    });

    it("handles empty initial logs", async () => {
      browser.storage.local.get.resolves({});

      await saveDebugLog({ ts: 1 });

      const saved = browser.storage.local.set.firstCall.args[0].debugLogs;
      expect(saved).to.have.lengthOf(1);
    });
  });

  describe("getDebugLogs()", () => {
    it("returns empty array when none stored", async () => {
      browser.storage.local.get.resolves({});
      const logs = await getDebugLogs();
      expect(logs).to.deep.equal([]);
    });

    it("returns stored logs", async () => {
      const stored = [{ ts: 1 }];
      browser.storage.local.get.resolves({ debugLogs: stored });
      const logs = await getDebugLogs();
      expect(logs).to.deep.equal(stored);
    });
  });
});
