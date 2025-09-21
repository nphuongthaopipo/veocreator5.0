const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    fetch: (url, cookie, options) => 
        ipcRenderer.invoke('fetch-api', { url, cookie, options }),
    
    startBrowserAutomation: (prompts, cookie) => 
        ipcRenderer.send('browser:start-automation', { prompts, cookie }),
    
    // THÊM DÒNG NÀY
    stopBrowserAutomation: () => ipcRenderer.send('browser:stop-automation'),

    onBrowserLog: (callback) => {
        const listener = (_event, log) => callback(log);
        ipcRenderer.on('browser:log', listener);
        return () => ipcRenderer.removeListener('browser:log', listener);
    }
});