import { expect } from 'chai';
//import { calcBookmarkChanges } from '../../src/background.js';
import fs from 'fs';
import path from 'path';

const filePath = path.join(process.cwd(), 'src/background.js');
const code = fs.readFileSync(filePath, 'utf-8');
const moduleExports = eval(code);
const calcBookmarkChanges = moduleExports.calcBookmarkChanges;


describe('Unit Tests for Bookmark Sync Logic', () => {
    it('should detect an insertion when a bookmark is present in otherBookmarks but not in myBookmarks', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }]);
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect a deletion when a bookmark is present in myBookmarks but not in otherBookmarks', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.deep.equal([{ title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect a URL change when a bookmark has the same title and path but a different URL', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.org/1', path: ['Folder1'], index: 0 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.org/1', path: ['Folder1'], index: 0, oldUrl: 'http://example.com/1' }]);
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect a title change when a bookmark has the same URL and path but a different title', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Updated Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateTitles).to.deep.equal([{ title: 'Updated Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0, oldTitle: 'Bookmark 1' }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect an index change when a bookmark has the same title, URL, and path but a different index', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 1 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateIndexes).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 1, oldIndex: 0 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect no changes when myBookmarks and otherBookmarks are the same', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect a path change when a bookmark is moved to a different folder', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0, oldPath: ['Folder1'] }]);
    });

    it('should detect insertion when a bookmark with the same title and URL is added to a different path', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 1 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 1 }]);
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect no changes when the same bookmark is present in different folders in both lists', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 1 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 1 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('should detect multiple path changes when bookmarks are moved across different paths', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder1'], index: 1 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder3'], index: 1 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.deep.equal([
            {
                title: 'Bookmark 2',
                url: 'http://example.com/2',
                path: ['Folder3'],
                index: 1,
                oldPath: ['Folder1']
            },{
                title: 'Bookmark 1',
                url: 'http://example.com/1',
                path: ['Folder2'],
                index: 0,
                oldPath: ['Folder1']
            }
        ]);
    });

    it('should detect changes when a bookmark is moved from one subfolder to another', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1', 'Subfolder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1', 'Subfolder2'], index: 0 }
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.deep.equal([
            {
                title: 'Bookmark 1',
                url: 'http://example.com/1',
                path: ['Folder1', 'Subfolder2'],
                index: 0,
                oldPath: ['Folder1', 'Subfolder1']
            }
        ]);
    });

    it('real world test', () => {
        const localBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"}
        ];
        const remoteBookmarks = [
            {title:"News2",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News2"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News2"],url:"https://www.heise.de/newsticker/"}
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.deep.equal([{ title: 'News2', path: ['Bookmarks Toolbar'], index: 0, oldTitle: 'News' }]);
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.deep.equal([
            {
                title: '7-Tage-News | heise online',
                url: 'https://www.heise.de/newsticker/',
                path: ["Bookmarks Toolbar","News2"],
                index: 2,
                oldPath: ["Bookmarks Toolbar","News"]
            },{
                title: 'Hacker News',
                url: 'https://news.ycombinator.com/',
                path: ["Bookmarks Toolbar","News2"],
                index: 0,
                oldPath: ["Bookmarks Toolbar","News"]
            }
        ]);
    });

    it('real world test with duplicates', () => {
        const localBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"News2",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News2"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News2"],url:"https://www.heise.de/newsticker/"}
        ];
        const remoteBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"News2",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News2"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News2"],url:"https://www.heise.de/newsticker/"}
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

    it('real world test with duplicates with change', () => {
        const localBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"News2",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News2"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News2"],url:"https://www.heise.de/newsticker/"}
        ];
        const remoteBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"News3",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News3"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News3"],url:"https://www.heise.de/newsticker/"}
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.deep.equal([{ title: 'News3', path: ['Bookmarks Toolbar'], index: 0, oldTitle: 'News2' }]);
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.deep.equal([
            {
                title: '7-Tage-News | heise online',
                url: 'https://www.heise.de/newsticker/',
                path: ["Bookmarks Toolbar","News3"],
                index: 2,
                oldPath: ["Bookmarks Toolbar","News2"]
            },{
                title: 'Hacker News',
                url: 'https://news.ycombinator.com/',
                path: ["Bookmarks Toolbar","News3"],
                index: 0,
                oldPath: ["Bookmarks Toolbar","News2"]
            }
        ]);
    });

    it('real world test with duplicates with deletion', () => {
        const localBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"News2",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News2"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News2"],url:"https://www.heise.de/newsticker/"}
        ];
        const remoteBookmarks = [
            {title:"News",index:0,path:["Bookmarks Toolbar"]},
            {title:"News3",index:0,path:["Bookmarks Toolbar"]},
            {title:"Hacker News",index:0,path:["Bookmarks Toolbar","News"],url:"https://news.ycombinator.com/"},
            {title:"Hacker News3",index:0,path:["Bookmarks Toolbar","News3"],url:"https://news.ycombinator.com/"},
            {title:"7-Tage-News | heise online",index:2,path:["Bookmarks Toolbar","News"],url:"https://www.heise.de/newsticker/"},
            {title:"7-Tage-News3 | heise online",index:2,path:["Bookmarks Toolbar","News3"],url:"https://www.heise.de/newsticker/"}
        ];

        const changes = calcBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([
            {title: "Hacker News3", index: 0, path: ["Bookmarks Toolbar", "News3"], url: "https://news.ycombinator.com/"},
            {title: "7-Tage-News3 | heise online", index: 2, path: ["Bookmarks Toolbar", "News3"], url: "https://www.heise.de/newsticker/"}
        ]);
        expect(changes.deletions).to.deep.equal([
            {title: "Hacker News", index: 0, path: ["Bookmarks Toolbar", "News2"], url: "https://news.ycombinator.com/"},
            {title: "7-Tage-News | heise online", index: 2, path: ["Bookmarks Toolbar", "News2"], url: "https://www.heise.de/newsticker/"}
        ]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.deep.equal([{ title: 'News3', path: ['Bookmarks Toolbar'], index: 0, oldTitle: 'News2' }]);
        expect(changes.updateIndexes).to.be.empty;
        expect(changes.updatePaths).to.be.empty;
    });

});