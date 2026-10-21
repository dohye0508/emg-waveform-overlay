'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const h = (_e, data) => fn(data);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  patch: (p) => ipcRenderer.invoke('settings:patch', p),
  setRunning: (on_) => ipcRenderer.invoke('run:set', on_),
  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  setTest: (on_) => ipcRenderer.invoke('test:set', on_),
  setDrag: (on_) => ipcRenderer.invoke('drag:set', on_),
  keyTest: () => ipcRenderer.invoke('key:test'),
  selectPreset: (i) => ipcRenderer.invoke('preset:select', i),
  reconnect: () => ipcRenderer.invoke('device:reconnect'),
  calStart: () => ipcRenderer.invoke('cal:start'),
  calCancel: () => ipcRenderer.invoke('cal:cancel'),
  calSens: (v) => ipcRenderer.invoke('cal:sens', v),
  calApply: () => ipcRenderer.invoke('cal:apply'),
  accel: (ev) => ipcRenderer.invoke('accel:fromEvent', ev),
  onState: on('state'),
  onFrame: on('frame'),
  onDrag: on('drag'),
});
