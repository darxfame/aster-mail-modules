const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
function check(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) check(file);
    else if (/\.(?:m?js|cjs)$/.test(item.name)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    else if (item.name.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}
check(root);
const definition = require('../ktalk/module.json');
for (const file of definition.files) if (!fs.statSync(path.join(root, 'ktalk', file)).isFile()) throw new Error(`Missing resource: ${file}`);
if (process.env.ASTER_MAIL_HOST) {
  const { readPackage } = require(path.join(path.resolve(process.env.ASTER_MAIL_HOST), 'desktop/modules.cjs'));
  readPackage(path.join(root, 'ktalk')).then(bundle => console.log(`SDK accepted ${bundle.manifest.id}: ${bundle.digest}`), error => { console.error(error.message); process.exitCode = 1; });
}
console.log('Syntax, JSON and package resources checked.');
