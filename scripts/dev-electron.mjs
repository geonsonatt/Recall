import { spawn } from 'node:child_process';
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const env = { ...process.env };
const devServerUrl = env.VITE_DEV_SERVER_URL || 'http://localhost:5180';

delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_NO_ATTACH_CONSOLE;
delete env.GIO_MODULE_DIR;
delete env.GIO_EXTRA_MODULES;
delete env.GTK_PATH;
delete env.SNAP;
delete env.SNAP_NAME;

env.VITE_DEV_SERVER_URL = devServerUrl;
env.ELECTRON_ENABLE_LOGGING = env.ELECTRON_ENABLE_LOGGING || '1';

if (process.platform !== 'win32') {
  env.LIBVA_DRIVER_NAME = env.LIBVA_DRIVER_NAME || 'none';
}

const child = spawn(
  electronBinary,
  [
    '.',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-accelerated-video-decode',
    '--disable-features=VaapiVideoDecoder,VaapiVideoEncoder,UseChromeOSDirectVideoDecoder',
  ],
  {
    stdio: 'inherit',
    env,
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 0;
});

child.on('error', (error) => {
  console.error(`dev-electron: failed to start electron: ${String(error?.message || error)}`);
  process.exitCode = 1;
});
