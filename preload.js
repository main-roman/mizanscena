// Мост между страницей и программой: то, что браузер сам сделать не может.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mizDesktop', {
  // Сохраняет то, что подготовлено для печати, в PDF-файл. Возвращает путь или null, если отменили.
  savePDF: name => ipcRenderer.invoke('save-pdf', name),
  // Открывает папку с проектами в проводнике или Finder.
  openData: () => ipcRenderer.invoke('open-data'),
  // Вход через Яндекс ID в отдельном окошке. Возвращает токен Яндекса или null, если окно закрыли.
  yandexLogin: clientId => ipcRenderer.invoke('yandex-login', clientId),
});
