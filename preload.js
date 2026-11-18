// Мост между страницей и программой: то, что браузер сам сделать не может.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mizDesktop', {
  // Сохраняет то, что подготовлено для печати, в PDF-файл. Возвращает путь или null, если отменили.
  savePDF: name => ipcRenderer.invoke('save-pdf', name),
  // Открывает папку с проектами в проводнике или Finder.
  openData: () => ipcRenderer.invoke('open-data'),
});
