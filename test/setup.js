import sinon from "sinon";
import fs from "fs";
import path from "path";

// Mock the global `browser` object
global.browser = {
  bookmarks: {
    get: sinon.stub(),
    getTree: sinon.stub(),
    getChildren: sinon.stub(),
    search: sinon.stub(),
    remove: sinon.stub(),
    removeTree: sinon.stub(),
    create: sinon.stub(),
    update: sinon.stub(),
    move: sinon.stub(),
    onChanged: {
      addListener: sinon.stub(),
    },
    onCreated: {
      addListener: sinon.stub(),
    },
    onMoved: {
      addListener: sinon.stub(),
    },
    onRemoved: {
      addListener: sinon.stub(),
    },
  },
  storage: {
    local: {
      set: sinon.stub(),
      get: sinon.stub(),
      remove: sinon.stub(),
    },
    sync: {
      get: sinon.stub(),
    },
  },
  runtime: {
    getURL: sinon.stub().returns("mockedURL"),
    onMessage: {
      addListener: sinon.stub(),
    },
  },
  tabs: {
    create: sinon.stub().resolves({ id: 1 }),
    update: sinon.stub().resolves(),
    query: sinon.stub().resolves([]),
    remove: sinon.stub().resolves(),
    get: sinon.stub().resolves(null),
    onRemoved: {
      addListener: sinon.stub(),
    },
  },
  notifications: {
    create: sinon.stub().resolves(),
    onClicked: {
      addListener: sinon.stub(),
    },
    clear: sinon.stub().resolves(),
  },
};

// Mock globals needed by webdav.js
global.Headers = class Headers {
  constructor() {
    this._map = new Map();
  }
  set(key, value) {
    this._map.set(key.toLowerCase(), value);
  }
  get(key) {
    return this._map.get(key.toLowerCase());
  }
  has(key) {
    return this._map.has(key.toLowerCase());
  }
};

global.btoa = (str) => Buffer.from(str, "binary").toString("base64");
global.fetch = sinon.stub();

// Global console stub for suppressing expected warnings in tests
global.originalConsoleWarn = console.warn;
global.originalConsoleError = console.error;
global.originalConsoleLog = console.log;

/**
 * Load a source file via eval and return its exports.
 * Replicates the pattern used in sync.test.js.
 * @param {string} relativePath - Path relative to project root (e.g. "src/sync.js")
 * @returns {Object} The exported functions
 */
export function loadModule(relativePath) {
  const filePath = path.join(process.cwd(), relativePath);
  const code = fs.readFileSync(filePath, "utf-8");
  return eval(code);
}
