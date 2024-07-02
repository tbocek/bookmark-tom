async function fetchBookmarksFromWebDAV(url, username, password) {
    const headers = new Headers();
    headers.set('Authorization', 'Basic ' + btoa(username + ":" + password));

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
    const statusDiv = document.getElementById('status');
    const testButton = document.getElementById('test-button');
    const spinner = document.getElementById('spinner');

    // Load existing config
    browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword', 'checkInterval']).then(config => {
        webdavUrlInput.value = config.webdavUrl || '';
        usernameInput.value = config.webdavUsername || '';
        passwordInput.value = config.webdavPassword || '';
    });

    saveButton.addEventListener('click', () => {
        const webdavUrl = webdavUrlInput.value;
        const username = usernameInput.value;
        const password = passwordInput.value;

        browser.storage.sync.set({
            webdavUrl,
            webdavUsername: username,
            webdavPassword: password,
        }).then(() => {
            statusDiv.textContent = 'Configuration saved.';
            statusDiv.classList.remove('status-error');
            statusDiv.classList.add('status-success');
        });
    });

    testButton.addEventListener('click', async () => {
        const webdavUrl = webdavUrlInput.value;
        const username = usernameInput.value;
        const password = passwordInput.value;

        try {
            spinner.style.display = 'inline-block';
            testButton.insertAdjacentElement('afterend', spinner);
            const success = await fetchBookmarksFromWebDAV(webdavUrl,username,password);
            if (success) {
                statusDiv.innerHTML = '<span class="icon-success">&#10004;</span> Connection successful.';
                statusDiv.classList.remove('status-error');
                statusDiv.classList.add('status-success');
            } else {
                throw new Error('Failed to connect to WebDAV server.');
            }
        } catch (error) {
            statusDiv.textContent = `Error: ${error.message}`;
            statusDiv.classList.remove('status-success');
            statusDiv.classList.add('status-error');
        } finally {
            spinner.style.display = 'none';
        }
    });
});