// Builds the standalone app page (index.html) from the hub source one folder up.
// Usage: node build.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'one-hub.html'), 'utf8');
const cut = src.indexOf('<div class="app">');
if (cut < 0) throw new Error('Could not find the app shell in one-hub.html');
const head = src.slice(0, cut).trim(), body = src.slice(cut).trim();
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#F3F1ED" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0F0E0D" media="(prefers-color-scheme: dark)">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="One Hub">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:border-box}body{margin:0}[hidden]{display:none!important}img{max-width:100%}</style>
${head}
<script src="config.js"></script>
</head>
<body>
${body}
<script>if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));</script>
</body>
</html>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
// bump the offline cache name so phones pick up the new build
const swPath = path.join(__dirname, 'sw.js');
fs.writeFileSync(swPath, fs.readFileSync(swPath, 'utf8').replace(/const VERSION = '[^']*'/, `const VERSION = 'hub-${stamp}'`));
console.log('Built index.html (' + Math.round(html.length / 1024) + ' KB), cache hub-' + stamp);
