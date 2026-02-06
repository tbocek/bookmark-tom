import { expect } from "chai";
import sinon from "sinon";
import { loadModule } from "../setup.js";

// Load sync.js first to provide arraysEqual as a global
const syncMod = loadModule("src/sync.js");
global.arraysEqual = syncMod.arraysEqual;

const mod = loadModule("src/bookmarks.js");
const {
  getBookmarkPath,
  retrieveLocalBookmarks,
  getLocalBookmarksSnapshot,
  locateBookmarkId,
  locateParentId,
  createFolderPath,
  modifyLocalBookmarks,
  applyLocalUpdates,
} = mod;

describe("Bookmarks Module", () => {
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

    // Default resolves
    browser.bookmarks.create.resolves({ id: "new1" });
    browser.bookmarks.remove.resolves();
    browser.bookmarks.removeTree.resolves();
    browser.bookmarks.update.resolves();
    browser.bookmarks.move.resolves();
  });

  afterEach(() => {
    sinon.restore();
  });

  // ============================================
  // getBookmarkPath
  // ============================================

  describe("getBookmarkPath()", () => {
    it("returns path for nested bookmark", async () => {
      browser.bookmarks.get
        .withArgs("child1")
        .resolves([{ id: "child1", title: "News", parentId: "toolbar" }]);
      browser.bookmarks.get
        .withArgs("toolbar")
        .resolves([
          { id: "toolbar", title: "Bookmarks Toolbar", parentId: "root" },
        ]);
      browser.bookmarks.get
        .withArgs("root")
        .resolves([{ id: "root", title: "" }]);

      const path = await getBookmarkPath("child1");
      expect(path).to.deep.equal(["Bookmarks Toolbar", "News"]);
    });

    it("returns empty path for root", async () => {
      browser.bookmarks.get
        .withArgs("root")
        .resolves([{ id: "root", title: "" }]);

      const path = await getBookmarkPath("root");
      expect(path).to.deep.equal([]);
    });

    it("handles broken chain gracefully", async () => {
      browser.bookmarks.get.rejects(new Error("Not found"));
      const path = await getBookmarkPath("broken");
      expect(path).to.deep.equal([]);
    });
  });

  // ============================================
  // retrieveLocalBookmarks
  // ============================================

  describe("retrieveLocalBookmarks()", () => {
    it("flattens bookmark tree with paths", async () => {
      const tree = [
        {
          title: "Bookmarks Toolbar",
          index: 0,
          children: [
            { title: "Google", url: "http://google.com", index: 0 },
            {
              title: "News",
              index: 1,
              children: [{ title: "BBC", url: "http://bbc.com", index: 0 }],
            },
          ],
        },
      ];

      const result = await retrieveLocalBookmarks(tree);

      expect(result).to.have.lengthOf(4); // Toolbar, Google, News, BBC
      const bbc = result.find((b) => b.title === "BBC");
      expect(bbc.path).to.deep.equal(["Bookmarks Toolbar", "News"]);
      expect(bbc.url).to.equal("http://bbc.com");
    });

    it("handles root node with empty title", async () => {
      const tree = [
        {
          title: "",
          index: 0,
          children: [{ title: "X", url: "http://x.com", index: 0 }],
        },
      ];

      const result = await retrieveLocalBookmarks(tree);
      const x = result.find((b) => b.title === "X");
      expect(x.path).to.deep.equal([]); // root empty title = path stays empty
    });
  });

  // ============================================
  // locateBookmarkId
  // ============================================

  describe("locateBookmarkId()", () => {
    it("finds bookmark by URL search", async () => {
      browser.bookmarks.search.resolves([
        {
          id: "bm1",
          title: "X",
          url: "http://x.com",
          index: 0,
          parentId: "toolbar",
        },
      ]);
      browser.bookmarks.get
        .withArgs("toolbar")
        .resolves([{ id: "toolbar", title: "Toolbar", parentId: "root" }]);
      browser.bookmarks.get
        .withArgs("root")
        .resolves([{ id: "root", title: "" }]);

      const id = await locateBookmarkId("http://x.com", "X", null, ["Toolbar"]);
      expect(id).to.equal("bm1");
    });

    it("returns null when path does not match", async () => {
      browser.bookmarks.search.resolves([
        {
          id: "bm1",
          title: "X",
          url: "http://x.com",
          index: 0,
          parentId: "other",
        },
      ]);
      browser.bookmarks.get
        .withArgs("other")
        .resolves([{ id: "other", title: "Other", parentId: "root" }]);
      browser.bookmarks.get
        .withArgs("root")
        .resolves([{ id: "root", title: "" }]);

      const id = await locateBookmarkId("http://x.com", "X", null, ["Toolbar"]);
      expect(id).to.be.null;
    });

    it("falls back to title search when URL search fails", async () => {
      // First call for URL search throws
      browser.bookmarks.search
        .onFirstCall()
        .rejects(new Error("URL search failed"));
      // Second call for title search returns result
      browser.bookmarks.search
        .onSecondCall()
        .resolves([
          {
            id: "bm1",
            title: "X",
            url: "http://x.com",
            index: 0,
            parentId: "toolbar",
          },
        ]);
      browser.bookmarks.get
        .withArgs("toolbar")
        .resolves([{ id: "toolbar", title: "Toolbar", parentId: "root" }]);
      browser.bookmarks.get
        .withArgs("root")
        .resolves([{ id: "root", title: "" }]);

      const id = await locateBookmarkId("http://x.com", "X", null, ["Toolbar"]);
      expect(id).to.equal("bm1");
    });

    it("returns null when no results found", async () => {
      browser.bookmarks.search.resolves([]);

      const id = await locateBookmarkId("http://x.com", "X", null, ["Toolbar"]);
      expect(id).to.be.null;
    });

    it("throws when no url and no title provided", async () => {
      try {
        await locateBookmarkId(null, null, null, ["Toolbar"]);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e.message).to.include("No bookmark found");
      }
    });
  });

  // ============================================
  // locateParentId
  // ============================================

  describe("locateParentId()", () => {
    const mockTree = [
      {
        id: "root",
        title: "",
        children: [
          {
            id: "toolbar",
            title: "Bookmarks Toolbar",
            children: [
              {
                id: "folder1",
                title: "News",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    it("returns root id for empty path", async () => {
      browser.bookmarks.getTree.resolves(mockTree);
      const id = await locateParentId([]);
      expect(id).to.equal("root");
    });

    it("finds folder by path", async () => {
      browser.bookmarks.getTree.resolves(mockTree);
      const id = await locateParentId(["Bookmarks Toolbar", "News"]);
      expect(id).to.equal("folder1");
    });

    it("returns null when path not found", async () => {
      browser.bookmarks.getTree.resolves(mockTree);
      const id = await locateParentId(["Nonexistent"]);
      expect(id).to.be.null;
    });

    it("creates missing folders when createIfMissing=true", async () => {
      browser.bookmarks.getTree.resolves(mockTree);
      browser.bookmarks.getChildren.resolves([]);
      browser.bookmarks.create.resolves({ id: "newFolder" });

      const id = await locateParentId(["Bookmarks Toolbar", "NewFolder"], true);
      expect(id).to.exist;
    });
  });

  // ============================================
  // createFolderPath
  // ============================================

  describe("createFolderPath()", () => {
    it("creates missing folder in hierarchy", async () => {
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [
            {
              id: "toolbar",
              title: "Bookmarks Toolbar",
              children: [],
            },
          ],
        },
      ]);
      browser.bookmarks.getChildren.resolves([]); // No existing children
      browser.bookmarks.create.resolves({ id: "newFolder" });

      const id = await createFolderPath(["Bookmarks Toolbar", "NewFolder"]);
      expect(id).to.equal("newFolder");
      expect(browser.bookmarks.create.calledOnce).to.be.true;
    });

    it("skips existing folders", async () => {
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [
            { id: "toolbar", title: "Bookmarks Toolbar", children: [] },
          ],
        },
      ]);
      browser.bookmarks.getChildren.resolves([
        { id: "existingFolder", title: "ExistingFolder" },
      ]);

      const id = await createFolderPath([
        "Bookmarks Toolbar",
        "ExistingFolder",
      ]);
      expect(id).to.equal("existingFolder");
      expect(browser.bookmarks.create.called).to.be.false;
    });
  });

  // ============================================
  // modifyLocalBookmarks
  // ============================================

  describe("modifyLocalBookmarks()", () => {
    beforeEach(() => {
      // Setup for locateBookmarkId within modifyLocalBookmarks
      browser.bookmarks.search.resolves([]);
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [{ id: "toolbar", title: "Toolbar", children: [] }],
        },
      ]);
      browser.bookmarks.getChildren.resolves([]);
    });

    it("deletes bookmarks before folders (content first)", async () => {
      const deleteOrder = [];
      browser.bookmarks.search.callsFake(async (query) => {
        if (query.url === "http://x.com" || query.query === "http://x.com") {
          return [
            {
              id: "bm1",
              title: "X",
              url: "http://x.com",
              index: 0,
              parentId: "f1",
            },
          ];
        }
        if (query.title === "F") {
          return [{ id: "f1", title: "F", index: 0, parentId: "toolbar" }];
        }
        return [];
      });
      browser.bookmarks.get.callsFake(async (id) => {
        if (id === "f1") return [{ id: "f1", title: "F", parentId: "toolbar" }];
        if (id === "toolbar")
          return [{ id: "toolbar", title: "Toolbar", parentId: "root" }];
        if (id === "root") return [{ id: "root", title: "" }];
        return [{ id, title: "" }];
      });

      browser.bookmarks.remove.callsFake(async () => {
        deleteOrder.push("bookmark");
      });
      browser.bookmarks.removeTree.callsFake(async () => {
        deleteOrder.push("folder");
      });

      const deletions = [
        { title: "F", path: ["Toolbar"], index: 0 }, // folder
        { title: "X", url: "http://x.com", path: ["Toolbar", "F"], index: 0 }, // bookmark
      ];

      await modifyLocalBookmarks(deletions, [], []);

      // Bookmark X should be deleted before folder F
      expect(deleteOrder[0]).to.equal("bookmark");
      expect(deleteOrder[1]).to.equal("folder");
    });

    it("skips folder deletion when insertions target inside it", async () => {
      browser.bookmarks.search.resolves([
        { id: "f1", title: "F", index: 0, parentId: "toolbar" },
      ]);
      browser.bookmarks.get.callsFake(async (id) => {
        if (id === "toolbar")
          return [{ id: "toolbar", title: "Toolbar", parentId: "root" }];
        if (id === "root") return [{ id: "root", title: "" }];
        return [{ id, title: "" }];
      });

      const deletions = [{ title: "F", path: ["Toolbar"], index: 0 }]; // folder
      const insertions = [
        { title: "Y", url: "http://y.com", path: ["Toolbar", "F"], index: 0 },
      ];

      await modifyLocalBookmarks(deletions, insertions, []);

      // Folder F should NOT be deleted (has new insert inside it)
      expect(browser.bookmarks.removeTree.called).to.be.false;
    });

    it("inserts bookmarks at correct parent", async () => {
      browser.bookmarks.search.resolves([]); // Not already existing
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [{ id: "toolbar", title: "Toolbar", children: [] }],
        },
      ]);
      browser.bookmarks.getChildren.resolves([]);
      browser.bookmarks.create.resolves({ id: "new1" });

      const insertions = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      await modifyLocalBookmarks([], insertions, []);

      expect(browser.bookmarks.create.calledOnce).to.be.true;
      const createArgs = browser.bookmarks.create.firstCall.args[0];
      expect(createArgs.title).to.equal("X");
      expect(createArgs.url).to.equal("http://x.com");
    });

    it("skips insert when bookmark already exists", async () => {
      // locateBookmarkId finds existing
      browser.bookmarks.search.resolves([
        {
          id: "existing",
          title: "X",
          url: "http://x.com",
          index: 0,
          parentId: "toolbar",
        },
      ]);
      browser.bookmarks.get.callsFake(async (id) => {
        if (id === "toolbar")
          return [{ id: "toolbar", title: "Toolbar", parentId: "root" }];
        if (id === "root") return [{ id: "root", title: "" }];
        return [{ id, title: "" }];
      });

      const insertions = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];

      await modifyLocalBookmarks([], insertions, []);

      // Should NOT create (already exists)
      expect(browser.bookmarks.create.called).to.be.false;
    });

    it("inserts multiple bookmarks in correct index order", async () => {
      browser.bookmarks.search.resolves([]);
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [{ id: "toolbar", title: "Toolbar", children: [] }],
        },
      ]);
      browser.bookmarks.getChildren.resolves([]);
      browser.bookmarks.create.resolves({ id: "new1" });

      // Insertions are intentionally out of order by index
      const insertions = [
        { title: "C", url: "http://c.com", path: ["Toolbar"], index: 2 },
        { title: "A", url: "http://a.com", path: ["Toolbar"], index: 0 },
        { title: "B", url: "http://b.com", path: ["Toolbar"], index: 1 },
      ];

      await modifyLocalBookmarks([], insertions, []);

      // Should insert in ascending index order: A (index 0), B (index 1), C (index 2)
      const calls = browser.bookmarks.create.getCalls();
      expect(calls).to.have.lengthOf(3);
      expect(calls[0].args[0].title).to.equal("A");
      expect(calls[0].args[0].index).to.equal(0);
      expect(calls[1].args[0].title).to.equal("B");
      expect(calls[1].args[0].index).to.equal(1);
      expect(calls[2].args[0].title).to.equal("C");
      expect(calls[2].args[0].index).to.equal(2);
    });
  });

  // ============================================
  // applyLocalUpdates
  // ============================================

  describe("applyLocalUpdates()", () => {
    it("applies title change", async () => {
      browser.bookmarks.search.resolves([
        {
          id: "bm1",
          title: "Old",
          url: "http://x.com",
          index: 0,
          parentId: "toolbar",
        },
      ]);
      browser.bookmarks.get.callsFake(async (id) => {
        if (id === "toolbar")
          return [{ id: "toolbar", title: "Toolbar", parentId: "root" }];
        if (id === "root") return [{ id: "root", title: "" }];
        return [{ id, title: "" }];
      });

      await applyLocalUpdates([
        {
          oldBookmark: {
            title: "Old",
            url: "http://x.com",
            index: 0,
            path: ["Toolbar"],
          },
          newBookmark: {
            title: "New",
            url: "http://x.com",
            index: 0,
            path: ["Toolbar"],
          },
          changedAttribute: "title",
        },
      ]);

      expect(browser.bookmarks.update.calledOnce).to.be.true;
      expect(browser.bookmarks.update.firstCall.args[1].title).to.equal("New");
    });

    it("applies index change via move", async () => {
      browser.bookmarks.search.resolves([
        {
          id: "bm1",
          title: "X",
          url: "http://x.com",
          index: 0,
          parentId: "toolbar",
        },
      ]);
      browser.bookmarks.get.callsFake(async (id) => {
        if (id === "toolbar")
          return [{ id: "toolbar", title: "Toolbar", parentId: "root" }];
        if (id === "root") return [{ id: "root", title: "" }];
        return [{ id, title: "" }];
      });

      await applyLocalUpdates([
        {
          oldBookmark: {
            title: "X",
            url: "http://x.com",
            index: 0,
            path: ["Toolbar"],
          },
          newBookmark: {
            title: "X",
            url: "http://x.com",
            index: 5,
            path: ["Toolbar"],
          },
          changedAttribute: "index",
        },
      ]);

      expect(browser.bookmarks.move.calledOnce).to.be.true;
      expect(browser.bookmarks.move.firstCall.args[1].index).to.equal(5);
    });

    it("applies path change via move to new parent", async () => {
      browser.bookmarks.search.resolves([
        {
          id: "bm1",
          title: "X",
          url: "http://x.com",
          index: 0,
          parentId: "toolbar",
        },
      ]);
      browser.bookmarks.get.callsFake(async (id) => {
        if (id === "toolbar")
          return [{ id: "toolbar", title: "Toolbar", parentId: "root" }];
        if (id === "root") return [{ id: "root", title: "" }];
        return [{ id, title: "" }];
      });
      browser.bookmarks.getTree.resolves([
        {
          id: "root",
          title: "",
          children: [
            {
              id: "toolbar",
              title: "Toolbar",
              children: [{ id: "folder2", title: "F2", children: [] }],
            },
          ],
        },
      ]);

      await applyLocalUpdates([
        {
          oldBookmark: {
            title: "X",
            url: "http://x.com",
            index: 0,
            path: ["Toolbar"],
          },
          newBookmark: {
            title: "X",
            url: "http://x.com",
            index: 0,
            path: ["Toolbar", "F2"],
          },
          changedAttribute: "path",
        },
      ]);

      expect(browser.bookmarks.move.calledOnce).to.be.true;
      expect(browser.bookmarks.move.firstCall.args[1].parentId).to.equal(
        "folder2",
      );
    });

    it("warns and continues when bookmark not found", async () => {
      browser.bookmarks.search.resolves([]);

      // Should not throw
      await applyLocalUpdates([
        {
          oldBookmark: {
            title: "Missing",
            url: "http://missing.com",
            index: 0,
            path: ["Toolbar"],
          },
          newBookmark: {
            title: "New",
            url: "http://missing.com",
            index: 0,
            path: ["Toolbar"],
          },
          changedAttribute: "title",
        },
      ]);

      expect(browser.bookmarks.update.called).to.be.false;
    });
  });
});
