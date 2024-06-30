document.addEventListener('DOMContentLoaded', () => {
    const saveButton = document.getElementById('save-button');
    const webdavUrlInput = document.getElementById('webdav-url');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const statusDiv = document.getElementById('status');

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
            setTimeout(() => statusDiv.textContent = '', 2000);
        });
    });
});