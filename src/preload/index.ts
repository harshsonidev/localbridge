import { contextBridge } from 'electron';
import { buildApi } from './api';

contextBridge.exposeInMainWorld('localBridge', buildApi());
