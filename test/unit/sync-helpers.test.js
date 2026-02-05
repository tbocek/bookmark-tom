import { expect } from "chai";
import { loadModule } from "../setup.js";

const mod = loadModule("src/sync.js");
const {
  arraysEqual,
  bookmarkKey,
  bookmarksEqual,
  bookmarksEqualExact,
  match3of4,
  findExact,
  find3of4,
  findDifferingAttribute,
  isTombstone,
  isFolder,
  getActive,
  getTombstones,
  createTombstone,
  pathStartsWith,
  getBookmarksInFolder,
  folderHasContent,
  protectFoldersWithContent,
  diffStates,
  categorizeChanges,
} = mod;

describe("Sync Helper Functions", () => {
  // ============================================
  // arraysEqual
  // ============================================
  describe("arraysEqual()", () => {
    it("returns true for both null", () => {
      expect(arraysEqual(null, null)).to.be.true;
    });

    it("returns false for null vs array", () => {
      expect(arraysEqual(null, [1])).to.be.false;
    });

    it("returns false for array vs null", () => {
      expect(arraysEqual([1], null)).to.be.false;
    });

    it("returns false for different lengths", () => {
      expect(arraysEqual([1, 2], [1])).to.be.false;
    });

    it("returns true for same arrays", () => {
      expect(arraysEqual(["a", "b"], ["a", "b"])).to.be.true;
    });

    it("returns true for empty arrays", () => {
      expect(arraysEqual([], [])).to.be.true;
    });

    it("returns false for different content", () => {
      expect(arraysEqual(["a"], ["b"])).to.be.false;
    });
  });

  // ============================================
  // bookmarkKey
  // ============================================
  describe("bookmarkKey()", () => {
    it("generates key from title, path, url", () => {
      const key = bookmarkKey({
        title: "Test",
        url: "http://test.com",
        path: ["Toolbar"],
      });
      expect(key).to.equal("Test|Toolbar|http://test.com");
    });

    it("handles empty url", () => {
      const key = bookmarkKey({ title: "Folder", url: "", path: ["Toolbar"] });
      expect(key).to.equal("Folder|Toolbar|");
    });

    it("handles undefined url (folder)", () => {
      const key = bookmarkKey({ title: "Folder", path: ["Toolbar"] });
      expect(key).to.equal("Folder|Toolbar|");
    });

    it("handles empty path", () => {
      const key = bookmarkKey({
        title: "X",
        url: "http://x.com",
        path: [],
      });
      expect(key).to.equal("X||http://x.com");
    });

    it("joins multi-segment paths with /", () => {
      const key = bookmarkKey({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar", "Sub", "Deep"],
      });
      expect(key).to.equal("X|Toolbar/Sub/Deep|http://x.com");
    });

    it("pipe in title causes key collision (documents known limitation)", () => {
      // Title "a|b" with path [] and url "" produces "a|b||"
      const key1 = bookmarkKey({ title: "a|b", url: "", path: [] });
      // Title "a" with path ["b"] and url "" produces "a|b|"
      const key2 = bookmarkKey({ title: "a", url: "", path: ["b"] });
      // These happen to collide due to pipe delimiter
      expect(key1).to.equal("a|b||");
      expect(key2).to.equal("a|b|");
      // They're different strings in this case, but a crafted example could collide
    });

    it("slash in path segment name is embedded in key", () => {
      const key = bookmarkKey({
        title: "X",
        url: "",
        path: ["a/b"],
      });
      expect(key).to.equal("X|a/b|");
    });
  });

  // ============================================
  // bookmarksEqual (3-of-3: title, url, path)
  // ============================================
  describe("bookmarksEqual()", () => {
    it("returns true for matching bookmarks", () => {
      const a = { title: "X", url: "http://x.com", path: ["Toolbar"] };
      const b = { title: "X", url: "http://x.com", path: ["Toolbar"] };
      expect(bookmarksEqual(a, b)).to.be.true;
    });

    it("returns true when url is undefined vs empty string", () => {
      const a = { title: "F", path: ["Toolbar"] }; // url undefined
      const b = { title: "F", url: "", path: ["Toolbar"] };
      expect(bookmarksEqual(a, b)).to.be.true;
    });

    it("ignores index differences", () => {
      const a = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 0,
      };
      const b = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 5,
      };
      expect(bookmarksEqual(a, b)).to.be.true;
    });

    it("returns false for different titles", () => {
      const a = { title: "X", url: "http://x.com", path: ["Toolbar"] };
      const b = { title: "Y", url: "http://x.com", path: ["Toolbar"] };
      expect(bookmarksEqual(a, b)).to.be.false;
    });

    it("returns false for different paths", () => {
      const a = { title: "X", url: "http://x.com", path: ["A"] };
      const b = { title: "X", url: "http://x.com", path: ["B"] };
      expect(bookmarksEqual(a, b)).to.be.false;
    });

    it("returns false for different urls", () => {
      const a = { title: "X", url: "http://a.com", path: ["Toolbar"] };
      const b = { title: "X", url: "http://b.com", path: ["Toolbar"] };
      expect(bookmarksEqual(a, b)).to.be.false;
    });
  });

  // ============================================
  // bookmarksEqualExact (4-of-4: title, url, path, index)
  // ============================================
  describe("bookmarksEqualExact()", () => {
    it("returns true for exact match including index", () => {
      const a = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 3,
      };
      const b = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 3,
      };
      expect(bookmarksEqualExact(a, b)).to.be.true;
    });

    it("returns false when index differs", () => {
      const a = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 0,
      };
      const b = {
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 1,
      };
      expect(bookmarksEqualExact(a, b)).to.be.false;
    });
  });

  // ============================================
  // match3of4
  // ============================================
  describe("match3of4()", () => {
    const base = {
      title: "X",
      url: "http://x.com",
      path: ["Toolbar"],
      index: 0,
    };

    it("returns true when all 4 match", () => {
      expect(match3of4(base, { ...base })).to.be.true;
    });

    it("returns true when only title differs", () => {
      expect(match3of4(base, { ...base, title: "Y" })).to.be.true;
    });

    it("returns true when only url differs", () => {
      expect(match3of4(base, { ...base, url: "http://other.com" })).to.be.true;
    });

    it("returns true when only index differs", () => {
      expect(match3of4(base, { ...base, index: 99 })).to.be.true;
    });

    it("returns true when only path differs", () => {
      expect(match3of4(base, { ...base, path: ["Other"] })).to.be.true;
    });

    it("returns false when 2 differ", () => {
      expect(match3of4(base, { ...base, title: "Y", url: "http://y.com" })).to
        .be.false;
    });
  });

  // ============================================
  // findExact / find3of4
  // ============================================
  describe("findExact()", () => {
    const list = [
      { title: "A", url: "http://a.com", path: ["Toolbar"] },
      { title: "B", url: "http://b.com", path: ["Toolbar"] },
    ];

    it("finds matching bookmark in list", () => {
      const target = { title: "A", url: "http://a.com", path: ["Toolbar"] };
      expect(findExact(target, list)).to.deep.include({ title: "A" });
    });

    it("returns undefined when not found", () => {
      const target = { title: "Z", url: "http://z.com", path: ["Toolbar"] };
      expect(findExact(target, list)).to.be.undefined;
    });

    it("returns undefined for empty list", () => {
      const target = { title: "A", url: "http://a.com", path: ["Toolbar"] };
      expect(findExact(target, [])).to.be.undefined;
    });
  });

  describe("find3of4()", () => {
    const list = [
      {
        title: "A",
        url: "http://a.com",
        path: ["Toolbar"],
        index: 0,
      },
    ];

    it("finds bookmark with 3-of-4 match", () => {
      const target = {
        title: "A",
        url: "http://a.com",
        path: ["Toolbar"],
        index: 99,
      };
      expect(find3of4(target, list)).to.exist;
    });

    it("returns undefined when only 2 match", () => {
      const target = {
        title: "Z",
        url: "http://z.com",
        path: ["Toolbar"],
        index: 0,
      };
      expect(find3of4(target, list)).to.be.undefined;
    });
  });

  // ============================================
  // findDifferingAttribute
  // ============================================
  describe("findDifferingAttribute()", () => {
    const base = {
      title: "X",
      url: "http://x.com",
      path: ["Toolbar"],
      index: 0,
    };

    it("returns 'title' when title differs", () => {
      expect(findDifferingAttribute(base, { ...base, title: "Y" })).to.equal(
        "title",
      );
    });

    it("returns 'url' when url differs", () => {
      expect(
        findDifferingAttribute(base, { ...base, url: "http://other.com" }),
      ).to.equal("url");
    });

    it("returns 'path' when path differs", () => {
      expect(
        findDifferingAttribute(base, { ...base, path: ["Other"] }),
      ).to.equal("path");
    });

    it("returns 'index' when index differs", () => {
      expect(findDifferingAttribute(base, { ...base, index: 5 })).to.equal(
        "index",
      );
    });

    it("returns null when all same", () => {
      expect(findDifferingAttribute(base, { ...base })).to.be.null;
    });
  });

  // ============================================
  // isTombstone / isFolder
  // ============================================
  describe("isTombstone()", () => {
    it("returns true for deleted bookmark", () => {
      expect(isTombstone({ deleted: true })).to.be.true;
    });

    it("returns false for active bookmark", () => {
      expect(isTombstone({ title: "X" })).to.be.false;
    });

    it("returns false for deleted=false", () => {
      expect(isTombstone({ deleted: false })).to.be.false;
    });
  });

  describe("isFolder()", () => {
    it("returns true when no url", () => {
      expect(isFolder({ title: "F", path: ["Toolbar"] })).to.be.true;
    });

    it("returns false when url present", () => {
      expect(isFolder({ title: "X", url: "http://x.com" })).to.be.false;
    });

    it("returns true when url is empty string", () => {
      // Empty string is falsy, so isFolder returns true
      expect(isFolder({ title: "F", url: "" })).to.be.true;
    });
  });

  // ============================================
  // getActive / getTombstones
  // ============================================
  describe("getActive()", () => {
    it("filters out tombstones", () => {
      const list = [
        { title: "A", url: "http://a.com", path: ["Toolbar"] },
        { title: "B", deleted: true },
        { title: "C", url: "http://c.com", path: ["Toolbar"] },
      ];
      const active = getActive(list);
      expect(active).to.have.lengthOf(2);
      expect(active.map((b) => b.title)).to.deep.equal(["A", "C"]);
    });

    it("returns empty array for null input", () => {
      expect(getActive(null)).to.deep.equal([]);
    });

    it("returns empty array for empty list", () => {
      expect(getActive([])).to.deep.equal([]);
    });
  });

  describe("getTombstones()", () => {
    it("returns only tombstones", () => {
      const list = [
        { title: "A" },
        { title: "B", deleted: true },
        { title: "C", deleted: true },
      ];
      const tombs = getTombstones(list);
      expect(tombs).to.have.lengthOf(2);
    });

    it("returns empty array for null input", () => {
      expect(getTombstones(null)).to.deep.equal([]);
    });
  });

  // ============================================
  // pathStartsWith
  // ============================================
  describe("pathStartsWith()", () => {
    it("returns true for exact path match", () => {
      expect(pathStartsWith(["Toolbar", "F"], ["Toolbar", "F"])).to.be.true;
    });

    it("returns true for prefix match", () => {
      expect(pathStartsWith(["Toolbar", "F", "Sub"], ["Toolbar", "F"])).to.be
        .true;
    });

    it("returns false when not a prefix", () => {
      expect(pathStartsWith(["Toolbar", "G"], ["Toolbar", "F"])).to.be.false;
    });

    it("returns false for null path", () => {
      expect(pathStartsWith(null, ["Toolbar"])).to.be.false;
    });

    it("returns false for null folderPath", () => {
      expect(pathStartsWith(["Toolbar"], null)).to.be.false;
    });

    it("returns false when path is shorter than folderPath", () => {
      expect(pathStartsWith(["Toolbar"], ["Toolbar", "F"])).to.be.false;
    });

    it("returns true for empty folderPath (matches everything)", () => {
      expect(pathStartsWith(["Toolbar"], [])).to.be.true;
    });
  });

  // ============================================
  // getBookmarksInFolder
  // ============================================
  describe("getBookmarksInFolder()", () => {
    const bookmarks = [
      { title: "A", url: "http://a.com", path: ["Toolbar", "F"] },
      { title: "B", url: "http://b.com", path: ["Toolbar", "F", "Sub"] },
      { title: "C", url: "http://c.com", path: ["Toolbar", "G"] },
      { title: "D", url: "http://d.com", path: ["Toolbar"] },
    ];

    it("returns bookmarks inside folder", () => {
      const result = getBookmarksInFolder(bookmarks, ["Toolbar", "F"]);
      expect(result).to.have.lengthOf(2);
      expect(result.map((b) => b.title)).to.include.members(["A", "B"]);
    });

    it("returns nested bookmarks", () => {
      const result = getBookmarksInFolder(bookmarks, ["Toolbar"]);
      expect(result).to.have.lengthOf(4); // All have Toolbar as prefix
    });

    it("returns empty when no matches", () => {
      const result = getBookmarksInFolder(bookmarks, ["Other"]);
      expect(result).to.have.lengthOf(0);
    });
  });

  // ============================================
  // folderHasContent
  // ============================================
  describe("folderHasContent()", () => {
    it("returns true when folder has active content", () => {
      const folder = { title: "F", path: ["Toolbar"] };
      const bookmarks = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "F"] },
      ];
      expect(folderHasContent(folder, bookmarks)).to.be.true;
    });

    it("returns false when folder only has tombstone children", () => {
      const folder = { title: "F", path: ["Toolbar"] };
      const bookmarks = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar", "F"],
          deleted: true,
        },
      ];
      expect(folderHasContent(folder, bookmarks)).to.be.false;
    });

    it("returns true for nested content", () => {
      const folder = { title: "F", path: ["Toolbar"] };
      const bookmarks = [
        { title: "X", url: "http://x.com", path: ["Toolbar", "F", "Sub"] },
      ];
      expect(folderHasContent(folder, bookmarks)).to.be.true;
    });

    it("returns false for empty folder", () => {
      const folder = { title: "F", path: ["Toolbar"] };
      expect(folderHasContent(folder, [])).to.be.false;
    });
  });

  // ============================================
  // protectFoldersWithContent
  // ============================================
  describe("protectFoldersWithContent()", () => {
    it("converts folder tombstone back to active when it has content", () => {
      const newState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: 123,
        },
        { title: "X", url: "http://x.com", path: ["Toolbar", "F"], index: 0 },
      ];
      const result = protectFoldersWithContent(newState);
      const folder = result.find((b) => b.title === "F");
      expect(folder.deleted).to.be.undefined;
    });

    it("keeps folder tombstone when no content", () => {
      const newState = [
        {
          title: "F",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: 123,
        },
      ];
      const result = protectFoldersWithContent(newState);
      expect(result[0].deleted).to.be.true;
    });

    it("does not affect non-folder tombstones", () => {
      const newState = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
          deletedAt: 123,
        },
      ];
      const result = protectFoldersWithContent(newState);
      expect(result[0].deleted).to.be.true;
    });

    it("does not affect active bookmarks", () => {
      const newState = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const result = protectFoldersWithContent(newState);
      expect(result).to.deep.equal(newState);
    });
  });

  // ============================================
  // diffStates
  // ============================================
  describe("diffStates()", () => {
    it("detects insertions", () => {
      const current = [];
      const target = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const result = diffStates(current, target);
      expect(result.insertions).to.have.lengthOf(1);
      expect(result.deletions).to.be.empty;
    });

    it("detects deletions", () => {
      const current = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const target = [];
      const result = diffStates(current, target);
      expect(result.deletions).to.have.lengthOf(1);
      expect(result.insertions).to.be.empty;
    });

    it("detects index updates", () => {
      const current = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const target = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 5 },
      ];
      const result = diffStates(current, target);
      expect(result.updates).to.have.lengthOf(1);
      expect(result.updates[0].changedAttribute).to.equal("index");
    });

    it("returns empty for identical states", () => {
      const state = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const result = diffStates(state, state);
      expect(result.insertions).to.be.empty;
      expect(result.deletions).to.be.empty;
      expect(result.updates).to.be.empty;
    });

    it("handles mixed changes", () => {
      const current = [
        { title: "A", url: "http://a.com", path: ["Toolbar"], index: 0 },
        { title: "B", url: "http://b.com", path: ["Toolbar"], index: 1 },
      ];
      const target = [
        { title: "B", url: "http://b.com", path: ["Toolbar"], index: 0 },
        { title: "C", url: "http://c.com", path: ["Toolbar"], index: 1 },
      ];
      const result = diffStates(current, target);
      expect(result.insertions).to.have.lengthOf(1); // C
      expect(result.deletions).to.have.lengthOf(1); // A
      expect(result.updates).to.have.lengthOf(1); // B index change
    });

    it("ignores tombstones in both states", () => {
      const current = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
        },
      ];
      const target = [];
      const result = diffStates(current, target);
      expect(result.deletions).to.be.empty;
      expect(result.insertions).to.be.empty;
    });
  });

  // ============================================
  // categorizeChanges
  // ============================================
  describe("categorizeChanges()", () => {
    it("detects unchanged items", () => {
      const old = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const current = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const result = categorizeChanges(old, current, []);
      expect(result.unchanged).to.have.lengthOf(1);
      expect(result.deleted).to.be.empty;
      expect(result.added).to.be.empty;
    });

    it("detects deleted items with tombstone", () => {
      const old = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
      ];
      const current = [];
      const tombstones = [
        {
          title: "X",
          url: "http://x.com",
          path: ["Toolbar"],
          index: 0,
          deleted: true,
        },
      ];
      const result = categorizeChanges(old, current, tombstones);
      expect(result.deleted).to.have.lengthOf(1);
      expect(result.unchanged).to.be.empty;
    });

    it("detects added items", () => {
      const old = [];
      const current = [
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 0 },
      ];
      const result = categorizeChanges(old, current, []);
      expect(result.added).to.have.lengthOf(1);
      expect(result.added[0].title).to.equal("Y");
    });

    it("handles mixed categorization", () => {
      const old = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
        { title: "Y", url: "http://y.com", path: ["Toolbar"], index: 1 },
      ];
      const current = [
        { title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 },
        { title: "Z", url: "http://z.com", path: ["Toolbar"], index: 1 },
      ];
      const tombstones = [
        {
          title: "Y",
          url: "http://y.com",
          path: ["Toolbar"],
          index: 1,
          deleted: true,
        },
      ];
      const result = categorizeChanges(old, current, tombstones);
      expect(result.unchanged).to.have.lengthOf(1); // X
      expect(result.deleted).to.have.lengthOf(1); // Y
      expect(result.added).to.have.lengthOf(1); // Z
    });
  });

  // ============================================
  // createTombstone
  // ============================================
  describe("createTombstone()", () => {
    it("creates a tombstone with deleted flag and timestamp", () => {
      const before = Date.now();
      const tomb = createTombstone({
        title: "X",
        url: "http://x.com",
        path: ["Toolbar"],
        index: 3,
      });
      expect(tomb.deleted).to.be.true;
      expect(tomb.deletedAt).to.be.at.least(before);
      expect(tomb.title).to.equal("X");
      expect(tomb.url).to.equal("http://x.com");
      expect(tomb.path).to.deep.equal(["Toolbar"]);
      expect(tomb.index).to.equal(3);
    });

    it("normalizes undefined url to empty string", () => {
      const tomb = createTombstone({ title: "F", path: ["Toolbar"], index: 0 });
      expect(tomb.url).to.equal("");
    });
  });
});
