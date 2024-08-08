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
    const checkIntervalMinutesInput = document.getElementById('checkIntervalMinutes');
    const statusDiv = document.getElementById('status');
    const errorDiv = document.getElementById('error');
    const testButton = document.getElementById('test-button');
    const spinner = document.getElementById('spinner');
    const saveConfigButton = document.getElementById('save-config-button');
    const loadConfigButton = document.getElementById('load-config-button');

    // Load existing config
    browser.storage.sync.get(['webdavUrl', 'webdavUsername', 'webdavPassword', 'checkIntervalMinutes']).then(config => {
        webdavUrlInput.value = config.webdavUrl || '';
        usernameInput.value = config.webdavUsername || '';
        passwordInput.value = config.webdavPassword || '';
        checkIntervalMinutesInput.value= config.checkIntervalMinutes || '';
    });

    saveButton.addEventListener('click', () => {
        storeConfiguration();
    });

    function storeConfiguration() {
        statusDiv.innerText = ''

        const webdavUrl = webdavUrlInput.value;
        const username = usernameInput.value;
        const password = passwordInput.value;
        const checkIntervalMinutes = checkIntervalMinutesInput.value;

        browser.storage.sync.set({
            webdavUrl,
            webdavUsername: username,
            webdavPassword: password,
            checkIntervalMinutes: checkIntervalMinutes
        }).then(() => {
            statusDiv.innerText += 'Configuration saved.';
        });
        return {webdavUrl, username, password}
    }

    testButton.addEventListener('click', async () => {
        statusDiv.innerText = ''

        const webdavUrl = webdavUrlInput.value;
        const username = usernameInput.value;
        const password = passwordInput.value;

        try {
            spinner.style.visibility = 'visible';
            const success = await fetchBookmarksFromWebDAV(webdavUrl,username,password);
            if (success) {
                storeConfiguration();
                statusDiv.innerText = 'Connection successfully tested. ';
            } else {
                throw new Error('Failed to connect to WebDAV server.');
            }
        } catch (error) {
            console.error(error);
            errorDiv.textContent = `Error: ${error.message}`;
        } finally {
            spinner.style.visibility = 'hidden';
        }
    });

    saveConfigButton.addEventListener('click', () => {
        const config = {
            webdavUrl: webdavUrlInput.value,
            webdavUsername: usernameInput.value,
            webdavPassword: passwordInput.value,
            checkIntervalMinutes: checkIntervalMinutesInput.value
        };
        const configStr = JSON.stringify(config);
        const blob = new Blob([configStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "bookmark-config.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    loadConfigButton.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        input.onchange = event => {
            const file = event.target.files[0];
            const reader = new FileReader();
            reader.onload = () => {
                const config = JSON.parse(reader.result);
                webdavUrlInput.value = config.webdavUrl || '';
                usernameInput.value = config.webdavUsername || '';
                passwordInput.value = config.webdavPassword || '';
                checkIntervalMinutesInput.value = config.checkIntervalMinutes || '';
                browser.storage.sync.set(config).then(() => {
                    statusDiv.innerText = 'Configuration loaded and saved.';
                });
            };
            reader.readAsText(file);
        };
        input.click();
    });
});