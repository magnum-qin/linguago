import fs from 'node:fs';
import path from 'node:path';

const distPath = 'dist';
const swPath = path.join(distPath, 'sw.js');

if (!fs.existsSync(swPath)) {
  console.error('dist/sw.js not found!');
  process.exit(1);
}

// Scan dist/assets for compiled css and js chunks
const assetsDir = path.join(distPath, 'assets');
let assetFiles = [];
if (fs.existsSync(assetsDir)) {
  assetFiles = fs
    .readdirSync(assetsDir)
    .filter((file) => !file.endsWith('.map'))
    .map((file) => `/assets/${file}`);
}

let swContent = fs.readFileSync(swPath, 'utf8');

// Inject assets into APP_SHELL array declaration in dist/sw.js
const shellRegex = /(const APP_SHELL = \[[^\]]*\];)/;
const match = swContent.match(shellRegex);
if (!match) {
  console.error('APP_SHELL declaration not found in sw.js');
  process.exit(1);
}

const baseShell = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

const fullShell = [...baseShell, ...assetFiles];
const newShellDeclaration = `const APP_SHELL = ${JSON.stringify(fullShell, null, 2)};`;

swContent = swContent.replace(shellRegex, newShellDeclaration);

// Auto-generate CACHE_NAME version based on package.json version + build timestamp
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const versionSuffix = `${packageJson.version}-${Date.now()}`;
const cacheNameRegex = /(const CACHE_NAME = ['"][^'"]*['"])/;
const newCacheName = `const CACHE_NAME = 'linguago-shell-v${versionSuffix}'`;

swContent = swContent.replace(cacheNameRegex, newCacheName);

fs.writeFileSync(swPath, swContent, 'utf8');
console.log(
  `[PWA-BUILD] Successfully injected ${assetFiles.length} assets and updated CACHE_NAME to: linguago-shell-v${versionSuffix}`
);
