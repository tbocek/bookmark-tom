import { expect } from "chai";
//import { calcBookmarkChanges } from '../../src/background.js';
import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "src/background.js");
const code = fs.readFileSync(filePath, "utf-8");
const moduleExports = eval(code);
const calcBookmarkChanges = moduleExports.calcBookmarkChanges;
const filterCascadeChanges = moduleExports.filterCascadeChanges;
const calcThreeWayChanges = moduleExports.calcThreeWayChanges;
const bookmarksEqual = moduleExports.bookmarksEqual;
const matchBookmarks3of4 = moduleExports.matchBookmarks3of4;
const findChangedAttribute = moduleExports.findChangedAttribute;

describe("Unit Tests for Bookmark Sync Logic", () => {
  it("should detect an insertion when a bookmark is present in otherBookmarks but not in myBookmarks", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder2"],
        index: 1,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder2"],
        index: 1,
      },
    ]);
    expect(changes.deletions).to.be.empty;
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect a deletion when a bookmark is present in myBookmarks but not in otherBookmarks", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder2"],
        index: 1,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.deep.equal([
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder2"],
        index: 1,
      },
    ]);
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect a URL change when a bookmark has the same title and path but a different URL", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.org/1",
        path: ["Folder1"],
        index: 0,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.org/1",
        path: ["Folder1"],
        index: 0,
      },
    ]);
    expect(changes.deletions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ]);
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect a title change when a bookmark has the same URL and path but a different title", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Updated Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Updated Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ]);
    expect(changes.deletions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ]);
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect an index change when a bookmark has the same title, URL, and path but a different index", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 1,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    expect(changes.updateIndexes).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 1,
        oldIndex: 0,
      },
    ]);
  });

  it("should detect no changes when myBookmarks and otherBookmarks are the same", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder2"],
        index: 1,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder2"],
        index: 1,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect a path change when a bookmark is moved to a different folder", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 0,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 0,
      },
    ]);
    expect(changes.deletions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ]);
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect insertion when a bookmark with the same title and URL is added to a different path", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 1,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 1,
      },
    ]);
    expect(changes.deletions).to.be.empty;
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect no changes when the same bookmark is present in different folders in both lists", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 1,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 1,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect multiple path changes when bookmarks are moved across different paths", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder1"],
        index: 1,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder3"],
        index: 1,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder2"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder3"],
        index: 1,
      },
    ]);
    expect(changes.deletions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1"],
        index: 0,
      },
      {
        title: "Bookmark 2",
        url: "http://example.com/2",
        path: ["Folder1"],
        index: 1,
      },
    ]);
    expect(changes.updateIndexes).to.be.empty;
  });

  it("should detect changes when a bookmark is moved from one subfolder to another", () => {
    const localBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1", "Subfolder1"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1", "Subfolder2"],
        index: 0,
      },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1", "Subfolder2"],
        index: 0,
      },
    ]);
    expect(changes.deletions).to.deep.equal([
      {
        title: "Bookmark 1",
        url: "http://example.com/1",
        path: ["Folder1", "Subfolder1"],
        index: 0,
      },
    ]);
    expect(changes.updateIndexes).to.be.empty;
  });
});

describe("Cascade Detection Tests", () => {
  it("should detect only the real move when one bookmark moves to end (cascade scenario)", () => {
    // A(0), B(1), C(2), D(3) -> B(0), C(1), D(2), A(3)
    // Only A moved significantly, B/C/D just shifted -1
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 },
      { title: "D", url: "http://d.com", path: ["Folder"], index: 3 },
    ];
    const remoteBookmarks = [
      { title: "B", url: "http://b.com", path: ["Folder"], index: 0 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 1 },
      { title: "D", url: "http://d.com", path: ["Folder"], index: 2 },
      { title: "A", url: "http://a.com", path: ["Folder"], index: 3 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    // Only A's move should be reported (0 -> 3), not B/C/D cascade shifts
    expect(changes.updateIndexes).to.have.lengthOf(1);
    expect(changes.updateIndexes[0].title).to.equal("A");
    expect(changes.updateIndexes[0].oldIndex).to.equal(0);
    expect(changes.updateIndexes[0].index).to.equal(3);
  });

  it("should detect only the real move when one bookmark moves to beginning (cascade scenario)", () => {
    // A(0), B(1), C(2), D(3) -> D(0), A(1), B(2), C(3)
    // Only D moved significantly, A/B/C just shifted +1
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 },
      { title: "D", url: "http://d.com", path: ["Folder"], index: 3 },
    ];
    const remoteBookmarks = [
      { title: "D", url: "http://d.com", path: ["Folder"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder"], index: 1 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 2 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 3 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    // Only D's move should be reported (3 -> 0)
    expect(changes.updateIndexes).to.have.lengthOf(1);
    expect(changes.updateIndexes[0].title).to.equal("D");
    expect(changes.updateIndexes[0].oldIndex).to.equal(3);
    expect(changes.updateIndexes[0].index).to.equal(0);
  });

  it("should detect both moves when two bookmarks swap positions", () => {
    // A(0), B(1) -> B(0), A(1)
    // Both moved, no cascade pattern (one +1, one -1)
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];
    const remoteBookmarks = [
      { title: "B", url: "http://b.com", path: ["Folder"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder"], index: 1 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    // Both swaps should be reported
    expect(changes.updateIndexes).to.have.lengthOf(2);
  });

  it("should keep single index change (no cascade possible)", () => {
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 5 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.updateIndexes).to.have.lengthOf(1);
    expect(changes.updateIndexes[0].oldIndex).to.equal(0);
    expect(changes.updateIndexes[0].index).to.equal(5);
  });

  it("should handle index changes in different folders independently", () => {
    // Folder1: A moves, B/C cascade
    // Folder2: X moves independently
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder1"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder1"], index: 2 },
      { title: "X", url: "http://x.com", path: ["Folder2"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "B", url: "http://b.com", path: ["Folder1"], index: 0 },
      { title: "C", url: "http://c.com", path: ["Folder1"], index: 1 },
      { title: "A", url: "http://a.com", path: ["Folder1"], index: 2 },
      { title: "X", url: "http://x.com", path: ["Folder2"], index: 5 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    // A's move in Folder1 (cascade filtered) + X's move in Folder2 (no cascade, single item)
    expect(changes.updateIndexes).to.have.lengthOf(2);
    const titles = changes.updateIndexes.map((u) => u.title).sort();
    expect(titles).to.deep.equal(["A", "X"]);
  });

  it("should keep all changes when no cascade pattern exists", () => {
    // Random reordering, no clear cascade
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 },
      { title: "D", url: "http://d.com", path: ["Folder"], index: 3 },
    ];
    const remoteBookmarks = [
      { title: "C", url: "http://c.com", path: ["Folder"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder"], index: 1 },
      { title: "D", url: "http://d.com", path: ["Folder"], index: 2 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 3 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    // All 4 items changed significantly, no cascade pattern
    expect(changes.updateIndexes).to.have.lengthOf(4);
  });

  it("should handle folder index changes with cascade detection", () => {
    // Folders (no URL) should also have cascade detection
    const localBookmarks = [
      { title: "FolderA", path: [], index: 0 },
      { title: "FolderB", path: [], index: 1 },
      { title: "FolderC", path: [], index: 2 },
      { title: "FolderD", path: [], index: 3 },
    ];
    const remoteBookmarks = [
      { title: "FolderB", path: [], index: 0 },
      { title: "FolderC", path: [], index: 1 },
      { title: "FolderD", path: [], index: 2 },
      { title: "FolderA", path: [], index: 3 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.insertions).to.be.empty;
    expect(changes.deletions).to.be.empty;
    // Only FolderA's move should be reported
    expect(changes.updateIndexes).to.have.lengthOf(1);
    expect(changes.updateIndexes[0].title).to.equal("FolderA");
  });
});

describe("Three-Way Merge Tests", () => {
  it("should treat null oldBookmarks as empty baseline", () => {
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];

    const result = calcThreeWayChanges(localBookmarks, remoteBookmarks, null);

    // With empty baseline, both local and remote are seen as new additions
    // Since A exists in both, it becomes a conflict (both added same thing)
    // B only in remote, so it's a pull
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].bookmark.title).to.equal("B");
    expect(result.conflicts).to.be.empty;
  });

  it("should detect pull from remote when local unchanged and remote changed", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].type).to.equal("insert");
    expect(result.pullFromRemote[0].bookmark.title).to.equal("B");
    expect(result.pushToRemote).to.be.empty;
    expect(result.conflicts).to.be.empty;
  });

  it("should detect push to remote when local changed and remote unchanged", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.pushToRemote).to.have.lengthOf(1);
    expect(result.pushToRemote[0].type).to.equal("insert");
    expect(result.pushToRemote[0].bookmark.title).to.equal("B");
    expect(result.pullFromRemote).to.be.empty;
    expect(result.conflicts).to.be.empty;
  });

  it("should detect no conflict when both made same change", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.pullFromRemote).to.be.empty;
    expect(result.pushToRemote).to.be.empty;
    expect(result.conflicts).to.be.empty;
  });

  it("should detect conflict when both changed same bookmark differently", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a-local.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a-remote.com", path: ["Folder"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.conflicts).to.have.lengthOf(1);
    expect(result.conflicts[0].local.url).to.equal("http://a-local.com");
    expect(result.conflicts[0].remote.url).to.equal("http://a-remote.com");
    expect(result.conflicts[0].old.url).to.equal("http://a.com");
  });

  it("should detect conflict when local deleted and remote modified", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [];
    const remoteBookmarks = [
      { title: "A", url: "http://a-modified.com", path: ["Folder"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.conflicts).to.have.lengthOf(1);
    expect(result.conflicts[0].local).to.be.null;
    expect(result.conflicts[0].remote.url).to.equal("http://a-modified.com");
  });

  it("should detect conflict when local modified and remote deleted", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a-modified.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.conflicts).to.have.lengthOf(1);
    expect(result.conflicts[0].local.url).to.equal("http://a-modified.com");
    expect(result.conflicts[0].remote).to.be.null;
  });

  it("should handle mixed changes without conflicts", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 }, // local added
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
      { title: "D", url: "http://d.com", path: ["Folder"], index: 2 }, // remote added
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.pushToRemote).to.have.lengthOf(1);
    expect(result.pushToRemote[0].bookmark.title).to.equal("C");
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].bookmark.title).to.equal("D");
    expect(result.conflicts).to.be.empty;
  });

  it("should detect update type for index-only changes", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 5 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].type).to.equal("update");
    expect(result.pullFromRemote[0].bookmark.index).to.equal(5);
    expect(result.pullFromRemote[0].oldBookmark.index).to.equal(0);
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

describe("Three-Way Merge with Auto-Merge Tests", () => {
  it("should auto-merge when local changed url and remote changed index", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a-new.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 5 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.conflicts).to.be.empty;
    // Both changes should be captured
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].changedAttribute).to.equal("index");
    expect(result.pushToRemote).to.have.lengthOf(1);
    expect(result.pushToRemote[0].changedAttribute).to.equal("url");
  });

  it("should auto-merge when local moved and remote renamed", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder2"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "B", url: "http://a.com", path: ["Folder1"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.mode).to.equal("three-way");
    expect(result.conflicts).to.be.empty;
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].changedAttribute).to.equal("title");
    expect(result.pushToRemote).to.have.lengthOf(1);
    expect(result.pushToRemote[0].changedAttribute).to.equal("path");
  });
});

describe("Edge Case Tests", () => {
  it("should handle empty bookmarks on all sides", () => {
    const result = calcThreeWayChanges([], [], []);
    expect(result.pullFromRemote).to.be.empty;
    expect(result.pushToRemote).to.be.empty;
    expect(result.conflicts).to.be.empty;
  });

  it("should handle empty local with non-empty remote and old", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];

    const result = calcThreeWayChanges([], remoteBookmarks, oldBookmarks);

    // Local deleted, remote unchanged -> push deletion to remote
    expect(result.pushToRemote).to.have.lengthOf(1);
    expect(result.pushToRemote[0].type).to.equal("delete");
    expect(result.pullFromRemote).to.be.empty;
    expect(result.conflicts).to.be.empty;
  });

  it("should handle folders (no URL) in three-way merge", () => {
    const oldBookmarks = [{ title: "FolderA", path: ["Root"], index: 0 }];
    const localBookmarks = [{ title: "FolderA", path: ["Root"], index: 0 }];
    const remoteBookmarks = [
      { title: "FolderA-Renamed", path: ["Root"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].type).to.equal("update");
    expect(result.pullFromRemote[0].bookmark.title).to.equal("FolderA-Renamed");
    expect(result.conflicts).to.be.empty;
  });

  it("should handle both sides deleting the same bookmark (no conflict)", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
    ];
    const localBookmarks = [
      { title: "B", url: "http://b.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "B", url: "http://b.com", path: ["Folder"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    // Both deleted A - should be no conflict, no changes needed
    expect(result.pullFromRemote).to.be.empty;
    expect(result.pushToRemote).to.be.empty;
    expect(result.conflicts).to.be.empty;
  });

  it("should handle deeply nested path changes", () => {
    const oldBookmarks = [
      {
        title: "A",
        url: "http://a.com",
        path: ["L1", "L2", "L3", "L4"],
        index: 0,
      },
    ];
    const localBookmarks = [
      {
        title: "A",
        url: "http://a.com",
        path: ["L1", "L2", "L3", "L4"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "A",
        url: "http://a.com",
        path: ["L1", "L2", "L3-New", "L4"],
        index: 0,
      },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].changedAttribute).to.equal("path");
    expect(result.conflicts).to.be.empty;
  });

  it("should handle multiple conflicts in single sync", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 },
    ];
    const localBookmarks = [
      { title: "A-Local", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b-local.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 },
    ];
    const remoteBookmarks = [
      { title: "A-Remote", url: "http://a.com", path: ["Folder"], index: 0 },
      { title: "B", url: "http://b-remote.com", path: ["Folder"], index: 1 },
      { title: "C", url: "http://c.com", path: ["Folder"], index: 2 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    // A and B should conflict, C unchanged
    expect(result.conflicts).to.have.lengthOf(2);
    expect(result.pullFromRemote).to.be.empty;
    expect(result.pushToRemote).to.be.empty;
  });

  it("should handle duplicate bookmarks (same title+url in different folders)", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder2"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder2"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder1"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder2"], index: 0 },
      { title: "A", url: "http://a.com", path: ["Folder3"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    // Remote added another copy in Folder3
    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].bookmark.path).to.deep.equal(["Folder3"]);
    expect(result.conflicts).to.be.empty;
  });

  it("should handle special characters in titles and URLs", () => {
    const oldBookmarks = [
      {
        title: "Test & <Script>",
        url: "http://example.com/path?a=1&b=2",
        path: ["Folder"],
        index: 0,
      },
    ];
    const localBookmarks = [
      {
        title: "Test & <Script>",
        url: "http://example.com/path?a=1&b=2",
        path: ["Folder"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      {
        title: "Test & <Script> Modified",
        url: "http://example.com/path?a=1&b=2",
        path: ["Folder"],
        index: 0,
      },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].bookmark.title).to.equal(
      "Test & <Script> Modified",
    );
    expect(result.conflicts).to.be.empty;
  });

  it("should handle large index gaps", () => {
    const localBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 1000 },
    ];

    const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

    expect(changes.updateIndexes).to.have.lengthOf(1);
    expect(changes.updateIndexes[0].index).to.equal(1000);
    expect(changes.updateIndexes[0].oldIndex).to.equal(0);
  });

  it("should handle bookmark moved to root (empty path)", () => {
    const oldBookmarks = [
      {
        title: "A",
        url: "http://a.com",
        path: ["Folder", "Subfolder"],
        index: 0,
      },
    ];
    const localBookmarks = [
      {
        title: "A",
        url: "http://a.com",
        path: ["Folder", "Subfolder"],
        index: 0,
      },
    ];
    const remoteBookmarks = [
      { title: "A", url: "http://a.com", path: [], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    expect(result.pullFromRemote).to.have.lengthOf(1);
    expect(result.pullFromRemote[0].changedAttribute).to.equal("path");
    expect(result.pullFromRemote[0].bookmark.path).to.deep.equal([]);
  });

  it("should handle rapid successive changes (all attributes changed)", () => {
    const oldBookmarks = [
      { title: "Old", url: "http://old.com", path: ["OldFolder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "Old", url: "http://old.com", path: ["OldFolder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "New", url: "http://new.com", path: ["NewFolder"], index: 5 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    // More than 1 attribute changed, so 3-of-4 won't match
    // Treated as delete old + insert new
    expect(
      result.pullFromRemote.length + result.pushToRemote.length,
    ).to.be.greaterThan(0);
  });

  it("should not conflict when both sides make identical changes", () => {
    const oldBookmarks = [
      { title: "A", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const localBookmarks = [
      { title: "A-Same", url: "http://a.com", path: ["Folder"], index: 0 },
    ];
    const remoteBookmarks = [
      { title: "A-Same", url: "http://a.com", path: ["Folder"], index: 0 },
    ];

    const result = calcThreeWayChanges(
      localBookmarks,
      remoteBookmarks,
      oldBookmarks,
    );

    // Both made identical change - no conflict, no sync needed
    expect(result.conflicts).to.be.empty;
    expect(result.pullFromRemote).to.be.empty;
    expect(result.pushToRemote).to.be.empty;
  });
});
