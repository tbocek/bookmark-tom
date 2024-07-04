async function fetchBookmarksFromWebDAV(url, username, password) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));
    headers.set('X-Extension-Request', 'bookmark');

    const response = await fetch(url, {
        headers: headers,
        credentials: 'omit',
    });
    if (response.status === 404) { //its empty on the remote site
        return true;
    }

    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return true;
}

document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('save-button');
    const webdavUrlInput = document.getElementById('webdav-url');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const checkIntervalInput = document.getElementById('checkInterval');
    const statusDiv = document.getElementById('status');
    const testButton = document.getElementById('test-button');
    const spinner = document.getElementById('spinner');

    // Load existing config
    browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword', 'checkInterval']).then(config => {
        webdavUrlInput.value = config.webdavUrl || '';
        usernameInput.value = config.webdavUsername || '';
        passwordInput.value = config.webdavPassword || '';
        checkIntervalInput.value= config.checkInterval || '';
    });

    saveButton.addEventListener('click', () => {
        const webdavUrl = webdavUrlInput.value;
        const username = usernameInput.value;
        const password = passwordInput.value;
        const checkInterval = checkIntervalInput.value;

        browser.storage.sync.set({
            webdavUrl,
            webdavUsername: username,
            webdavPassword: password,
            checkInterval: checkInterval
        }).then(() => {
            statusDiv.innerHTML = '<span class="success">Configuration saved.</span>';
        });
    });

    testButton.addEventListener('click', async () => {
        const webdavUrl = webdavUrlInput.value;
        const username = usernameInput.value;
        const password = passwordInput.value;

        try {
            spinner.style.visibility = '';
            const success = await fetchBookmarksFromWebDAV(webdavUrl,username,password);
            if (success) {
                statusDiv.innerHTML = '<span class="success">&#10004; Connection successful.</span>';
            } else {
                throw new Error('Failed to connect to WebDAV server.');
            }
        } catch (error) {
            statusDiv.textContent = `<span class="error">Error: ${error.message}</span>`;
        } finally {
            spinner.style.visibility = 'hidden';
        }
    });
});