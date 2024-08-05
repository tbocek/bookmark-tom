import sinon from 'sinon';

// Mock the global `browser` object
global.browser = {
    bookmarks: {
        getTree: sinon.stub(),
        search: sinon.stub(),
        remove: sinon.stub(),
        create: sinon.stub(),
        update: sinon.stub(),
        move: sinon.stub(),
        onChanged: {
            addListener: sinon.stub()
        },
        onCreated: {
            addListener: sinon.stub()
        },
        onMoved: {
            addListener: sinon.stub()
        },
        onRemoved: {
            addListener: sinon.stub()
        }
    },
    storage: {
        local: {
            set: sinon.stub(),
            get: sinon.stub(),
            remove: sinon.stub()
        },
        sync: {
            get: sinon.stub()
        }
    },
    runtime: {
        getURL: sinon.stub().returns('mockedURL'),
        onMessage: {
            addListener: sinon.stub()
        }
    },
    tabs: {
        create: sinon.stub().resolves({ id: 1 }),
        update: sinon.stub().resolves(),
        query: sinon.stub().resolves([]),
        remove: sinon.stub().resolves()
    },
    notifications: {
        create: sinon.stub().resolves(),
        onClicked: {
            addListener: sinon.stub()
        },
        clear: sinon.stub().resolves()
    }
};