/**
 * WebDAV operations for bookmark sync
 */

function createWebDAVHeaders(username, password, isWrite = false) {
  const headers = new Headers();
  headers.set("Authorization", "Basic " + btoa(username + ":" + password));
  headers.set("X-Extension-Request", "bookmark");
  if (isWrite) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function addCacheBuster(url) {
  const cacheBuster = `cb=${Date.now()}`;
  return url.includes("?") ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;
}

async function fetchWebDAV(url, username, password) {
  if (!url) {
    console.warn("fetchWebDAV: No URL configured");
    return null;
  }

  const headers = createWebDAVHeaders(username, password);

  try {
    const response = await fetch(addCacheBuster(url), {
      headers,
      credentials: "omit",
    });

    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const text = await response.text();

    if (!text || text.trim() === "") {
      return null;
    }

    const data = JSON.parse(text);
    return Array.isArray(data) ? data : null;
  } catch (error) {
    console.error("Error fetching from WebDAV:", error);
    return null;
  }
}

async function updateWebDAV(url, username, password, bookmarks) {
  const headers = createWebDAVHeaders(username, password, true);

  const response = await fetch(url, {
    method: "PUT",
    headers,
    credentials: "omit",
    body: JSON.stringify(bookmarks),
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
}

async function loadConfig() {
  const result = await browser.storage.sync.get([
    "webdavUrl",
    "webdavUsername",
    "webdavPassword",
    "checkIntervalMinutes",
  ]);

  return {
    url: result.webdavUrl || "",
    username: result.webdavUsername || "",
    password: result.webdavPassword || "",
    checkInterval: parseInt(result.checkIntervalMinutes, 10) || 5,
  };
}
