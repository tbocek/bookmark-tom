import { expect } from 'chai';
import { getBookmarkChanges } from '../../src/background.js';

describe('Unit Tests for Bookmark Sync Logic', () => {
    it('should detect an insertion when a bookmark is present in otherBookmarks but not in myBookmarks', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }]);
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect a deletion when a bookmark is present in myBookmarks but not in otherBookmarks', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.deep.equal([{ title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder2'], index: 1 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect a URL change when a bookmark has the same title and path but a different URL', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.org/1', path: ['Folder1'], index: 0 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.org/1', path: ['Folder1'], index: 0, oldUrl: 'http://example.com/1' }]);
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect a title change when a bookmark has the same URL and path but a different title', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Updated Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateTitles).to.deep.equal([{ title: 'Updated Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0, oldTitle: 'Bookmark 1' }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect an index change when a bookmark has the same title, URL, and path but a different index', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 1 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateIndexes).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 1, oldIndex: 0 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
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

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect a path change when a bookmark is moved to a different folder', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 }]);
        expect(changes.deletions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect insertion when a bookmark with the same title and URL is added to a different path', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 1 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 1 }]);
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect both deletion and insertion when a bookmark is moved from one path to another', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 }]);
        expect(changes.deletions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
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

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.be.empty;
        expect(changes.deletions).to.be.empty;
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
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

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder2'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder3'], index: 1 }
        ]);
        expect(changes.deletions).to.deep.equal([
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1'], index: 0 },
            { title: 'Bookmark 2', url: 'http://example.com/2', path: ['Folder1'], index: 1 }
        ]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

    it('should detect changes when a bookmark is moved from one subfolder to another', () => {
        const localBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1', 'Subfolder1'], index: 0 }
        ];
        const remoteBookmarks = [
            { title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1', 'Subfolder2'], index: 0 }
        ];

        const changes = getBookmarkChanges(remoteBookmarks, localBookmarks);

        expect(changes.insertions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1', 'Subfolder2'], index: 0 }]);
        expect(changes.deletions).to.deep.equal([{ title: 'Bookmark 1', url: 'http://example.com/1', path: ['Folder1', 'Subfolder1'], index: 0 }]);
        expect(changes.updateUrls).to.be.empty;
        expect(changes.updateTitles).to.be.empty;
        expect(changes.updateIndexes).to.be.empty;
    });

});