// Мизансцена как программа: окно Electron поверх того же локального сервера.
// Проекты лежат в «Документы/Мизансцена», телефон в той же сети Wi-Fi по-прежнему может их открыть.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');

// папка проектов: отдельно от программы, поэтому установка и обновления её не трогают
process.env.MIZ_DATA = process.env.MIZ_DATA || path.join(app.getPath('documents'), 'Мизансцена');
process.env.MIZ_VERSION = app.getVersion();
ipcMain.handle('open-data', () => shell.openPath(path.join(process.env.MIZ_DATA, 'projects')));

// ---------- обновления ----------
// Новые версии публикуются на GitHub (раздел Releases). Программа проверяет их при запуске и раз в 4 часа
// и спрашивает, обновиться ли. На Windows обновление скачивается и ставится само.
// На Mac без платной подписи Apple само обновление поставить нельзя, поэтому там открывается страница загрузки.
const RELEASES = 'https://github.com/main-roman/mizanscena/releases/latest';
function setupUpdates() {
  if (!app.isPackaged) return; // при запуске из папки с исходниками обновления не проверяются
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return; }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  let asked = '';
  autoUpdater.on('update-available', async info => {
    if (asked === info.version || !win) return;
    asked = info.version;
    const notes = typeof info.releaseNotes === 'string' ? info.releaseNotes.replace(/<[^>]+>/g, '').trim() : '';
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', title: 'Есть новая версия', buttons: ['Обновить', 'Позже'], defaultId: 0, cancelId: 1,
      message: `Доступна Мизансцена ${info.version} (у вас ${app.getVersion()}).`,
      detail: (notes ? notes.slice(0, 600) + '\n\n' : '') + 'Проекты не пострадают: они хранятся отдельно, в папке «Документы/Мизансцена».',
    });
    if (response !== 0) return;
    if (process.platform === 'darwin') { shell.openExternal(RELEASES); return; }
    win.setProgressBar(0.01);
    autoUpdater.downloadUpdate().catch(err => { win.setProgressBar(-1); dialog.showErrorBox('Обновление не скачалось', String(err.message || err)); });
  });
  autoUpdater.on('download-progress', p => win && win.setProgressBar(Math.max(0.01, p.percent / 100)));
  autoUpdater.on('update-downloaded', async info => {
    if (win) win.setProgressBar(-1);
    const { response } = await dialog.showMessageBox(win, {
      type: 'info', title: 'Обновление готово', buttons: ['Перезапустить сейчас', 'Когда закрою программу'], defaultId: 0, cancelId: 1,
      message: `Мизансцена ${info.version} загружена.`, detail: 'Все правки уже сохранены, перезапуск их не потеряет.',
    });
    if (response === 0) setImmediate(() => autoUpdater.quitAndInstall());
    else autoUpdater.autoInstallOnAppQuit = true;
  });
  autoUpdater.on('error', err => console.error('Проверка обновлений:', err.message || err));
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* нет интернета: проверим позже */ });
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

// PDF без окна печати: страница уже собрала документ в блоке для печати, здесь он сохраняется файлом и открывается.
ipcMain.handle('save-pdf', async (e, name) => {
  const wc = e.sender, owner = BrowserWindow.fromWebContents(wc);
  const safe = String(name || 'Мизансцена').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Мизансцена';
  const { canceled, filePath } = await dialog.showSaveDialog(owner, {
    title: 'Сохранить PDF', defaultPath: path.join(app.getPath('documents'), safe + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  const data = await wc.printToPDF({ printBackground: true, preferCSSPageSize: true });
  fs.writeFileSync(filePath, data);
  shell.openPath(filePath);
  return filePath;
});

const PORT = Number(process.env.PORT) || 5180;
const URL = `http://localhost:${PORT}`;

if (!app.requestSingleInstanceLock()) app.quit();

function waitForServer(tries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      http.get(URL + '/api/info', res => { res.resume(); resolve(); })
        .on('error', () => (n > 0 ? setTimeout(() => attempt(n - 1), 150) : reject(new Error('сервер не ответил'))));
    };
    attempt(tries);
  });
}

let win = null;
async function open() {
  // сервер живёт внутри программы; если порт занят другой копией, программа работает через неё и подхватит порт, когда та закроется
  require('./server.js').keepAlive();
  await waitForServer();
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600,
    backgroundColor: '#141F24', title: 'Мизансцена', autoHideMenuBar: true,
    icon: path.join(__dirname, 'public', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: true, preload: path.join(__dirname, 'preload.js') },
  });
  Menu.setApplicationMenu(null);
  win.webContents.session.setSpellCheckerLanguages(['ru', 'en-US']);
  // ссылки наружу открываются в обычном браузере, а не внутри программы
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(URL)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'F5') win.webContents.reload();
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
  // если страница не загрузилась (сервер на мгновение пропал), пробуем снова, пока не откроется
  win.webContents.on('did-fail-load', (_e, code, _desc, _url, mainFrame) => {
    if (mainFrame && code !== -3) setTimeout(() => win && !win.isDestroyed() && win.loadURL(URL), 1500);
  });
  win.loadURL(URL);
  setupUpdates();
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(open).catch(err => { console.error(err); app.quit(); });
app.on('window-all-closed', () => app.quit());
