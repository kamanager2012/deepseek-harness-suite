import { app } from 'electron';
import { ConfigStore } from './config-store.js';
import { WindowManager } from './window-manager.js';
import { TrayManager } from './tray.js';
import { DshSubprocessManager } from '@dsh-community/dsh-bridge';

let configStore: ConfigStore;
let runtimeManager: DshSubprocessManager;
let windowManager: WindowManager;
let trayManager: TrayManager;

async function bootstrap() {
  configStore = new ConfigStore();

  runtimeManager = new DshSubprocessManager({
    config: configStore.get(),
  });

  windowManager = new WindowManager(configStore, runtimeManager);

  trayManager = new TrayManager(runtimeManager, {
    onOpenWindow: () => windowManager.showMainWindow(),
    onOpenPreferences: () => windowManager.loadSetupWizard(),
    onRestartRuntime: async () => {
      await runtimeManager.restart();
      trayManager.updateMenu();
    },
    onOpenLogs: () => windowManager.showMainWindow(),
  });

  // If already configured, start runtime immediately
  if (!configStore.isFirstRun()) {
    try {
      await runtimeManager.start();
    } catch (err: any) {
      console.error('Failed to auto-start DSH runtime:', err?.message);
    }
  }

  trayManager.init();
  windowManager.showMainWindow();

  // Periodically refresh tray menu state
  setInterval(() => {
    trayManager.updateMenu();
  }, 3000);
}

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  // On desktop app, keep running in system tray unless on platform where quitting is desired
  if (process.platform === 'darwin') {
    // macOS dock behavior
  }
});

app.on('before-quit', async () => {
  trayManager?.destroy();
  if (runtimeManager) {
    await runtimeManager.stop();
  }
});
