import { expect } from "chai";
import sinon from "sinon";
import { loadModule } from "../setup.js";

const mod = loadModule("src/webdav.js");
const {
  createWebDAVHeaders,
  addCacheBuster,
  fetchWebDAV,
  updateWebDAV,
  loadConfig,
} = mod;

describe("WebDAV Module", () => {
  beforeEach(() => {
    sinon.resetBehavior();
    global.fetch.reset();
    browser.storage.sync.get.resolves({});
  });

  afterEach(() => {
    sinon.restore();
  });

  // ============================================
  // createWebDAVHeaders
  // ============================================

  describe("createWebDAVHeaders()", () => {
    it("sets Basic Authorization header", () => {
      const headers = createWebDAVHeaders("user", "pass");
      const expected = "Basic " + btoa("user:pass");
      expect(headers.get("authorization")).to.equal(expected);
    });

    it("sets X-Extension-Request header", () => {
      const headers = createWebDAVHeaders("user", "pass");
      expect(headers.get("x-extension-request")).to.equal("bookmark");
    });

    it("does not set Content-Type for read requests", () => {
      const headers = createWebDAVHeaders("user", "pass", false);
      expect(headers.has("content-type")).to.be.false;
    });

    it("sets Content-Type for write requests", () => {
      const headers = createWebDAVHeaders("user", "pass", true);
      expect(headers.get("content-type")).to.equal("application/json");
    });
  });

  // ============================================
  // addCacheBuster
  // ============================================

  describe("addCacheBuster()", () => {
    it("adds ?cb= to URL without query string", () => {
      const result = addCacheBuster("http://example.com/bookmarks.json");
      expect(result).to.match(/^http:\/\/example\.com\/bookmarks\.json\?cb=\d+$/);
    });

    it("adds &cb= to URL with existing query string", () => {
      const result = addCacheBuster("http://example.com/bookmarks.json?v=1");
      expect(result).to.match(/^http:\/\/example\.com\/bookmarks\.json\?v=1&cb=\d+$/);
    });
  });

  // ============================================
  // fetchWebDAV
  // ============================================

  describe("fetchWebDAV()", () => {
    it("returns null for null URL", async () => {
      const result = await fetchWebDAV(null, "user", "pass");
      expect(result).to.be.null;
    });

    it("returns null for empty URL", async () => {
      const result = await fetchWebDAV("", "user", "pass");
      expect(result).to.be.null;
    });

    it("returns null for 404 response", async () => {
      global.fetch.resolves({ status: 404, ok: false });
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.be.null;
    });

    it("returns null for empty body", async () => {
      global.fetch.resolves({
        status: 200,
        ok: true,
        text: sinon.stub().resolves(""),
      });
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.be.null;
    });

    it("returns null for whitespace-only body", async () => {
      global.fetch.resolves({
        status: 200,
        ok: true,
        text: sinon.stub().resolves("   \n  "),
      });
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.be.null;
    });

    it("returns parsed array from valid JSON", async () => {
      const data = [{ title: "X", url: "http://x.com", path: ["Toolbar"], index: 0 }];
      global.fetch.resolves({
        status: 200,
        ok: true,
        text: sinon.stub().resolves(JSON.stringify(data)),
      });
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.deep.equal(data);
    });

    it("returns null for non-array JSON", async () => {
      global.fetch.resolves({
        status: 200,
        ok: true,
        text: sinon.stub().resolves('{"key": "value"}'),
      });
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.be.null;
    });

    it("returns null on network error", async () => {
      global.fetch.rejects(new Error("Network failure"));
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.be.null;
    });

    it("returns null on non-ok status (not 404)", async () => {
      // Non-404 errors throw, which is caught and returns null
      global.fetch.resolves({
        status: 500,
        ok: false,
      });
      const result = await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(result).to.be.null;
    });

    it("sends credentials: omit", async () => {
      global.fetch.resolves({
        status: 200,
        ok: true,
        text: sinon.stub().resolves("[]"),
      });
      await fetchWebDAV("http://example.com/bm.json", "user", "pass");
      expect(global.fetch.firstCall.args[1].credentials).to.equal("omit");
    });
  });

  // ============================================
  // updateWebDAV
  // ============================================

  describe("updateWebDAV()", () => {
    it("sends PUT request with JSON body", async () => {
      global.fetch.resolves({ ok: true });
      const bookmarks = [{ title: "X" }];

      await updateWebDAV("http://example.com/bm.json", "user", "pass", bookmarks);

      expect(global.fetch.calledOnce).to.be.true;
      const [url, options] = global.fetch.firstCall.args;
      expect(url).to.equal("http://example.com/bm.json");
      expect(options.method).to.equal("PUT");
      expect(options.body).to.equal(JSON.stringify(bookmarks));
      expect(options.credentials).to.equal("omit");
    });

    it("throws on error response", async () => {
      global.fetch.resolves({ ok: false, status: 403 });

      try {
        await updateWebDAV("http://example.com/bm.json", "user", "pass", []);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e.message).to.include("403");
      }
    });
  });

  // ============================================
  // loadConfig
  // ============================================

  describe("loadConfig()", () => {
    it("returns defaults when storage is empty", async () => {
      browser.storage.sync.get.resolves({});
      const config = await loadConfig();
      expect(config).to.deep.equal({
        url: "",
        username: "",
        password: "",
        checkInterval: 5,
      });
    });

    it("returns stored values", async () => {
      browser.storage.sync.get.resolves({
        webdavUrl: "http://dav.example.com/bm.json",
        webdavUsername: "alice",
        webdavPassword: "secret",
        checkIntervalMinutes: "10",
      });
      const config = await loadConfig();
      expect(config).to.deep.equal({
        url: "http://dav.example.com/bm.json",
        username: "alice",
        password: "secret",
        checkInterval: 10,
      });
    });

    it("handles non-numeric checkInterval gracefully", async () => {
      browser.storage.sync.get.resolves({
        checkIntervalMinutes: "abc",
      });
      const config = await loadConfig();
      expect(config.checkInterval).to.equal(5); // NaN || 5 = 5
    });
  });
});
