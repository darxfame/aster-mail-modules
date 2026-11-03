const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
async function build({ server, output, identityOrigins = [], version }) {
  const root = path.resolve(__dirname, '..');
  const { serverOrigin } = await import(pathToFileURL(path.join(root, 'ktalk/core.js')).href);
  const origin = serverOrigin(server), identities = [...new Set(['https://passport.skbkontur.ru', 'https://identity.kontur.ru', ...identityOrigins.map(serverOrigin)])];
  if (identities.length > 8) throw new Error('At most eight identity origins are allowed');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'ktalk/module.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version) || version === manifest.version) throw new Error('Specify a new package version, for example --version 0.1.1');
  manifest.version = version; manifest.networkOrigins = [origin]; manifest.meetingLinks.origins = [origin]; manifest.authentication.origins = [origin]; manifest.authentication.identityOrigins = identities;
  const destination = path.resolve(output);
  // Never overwrite sources or silently replace an existing immutable package.
  if (destination === root || root.startsWith(`${destination}${path.sep}`) || destination === path.join(root, 'ktalk') || destination.startsWith(`${path.join(root, 'ktalk')}${path.sep}`)) throw new Error('Choose a separate output folder');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
  for (const file of manifest.files) await fs.copyFile(path.join(root, 'ktalk', file), path.join(destination, file));
  await fs.writeFile(path.join(destination, 'config.js'), `export const servers = ${JSON.stringify([origin])};\n`);
  await fs.writeFile(path.join(destination, 'module.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return destination;
}
module.exports = { build };
if (require.main === module) {
  const args = process.argv.slice(2), options = { identityOrigins: [] };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!value || !['--server', '--out', '--identity-origin', '--version'].includes(key)) throw new Error('Usage: --server https://company.ktalk.ru --out dist/company --version 0.1.1 [--identity-origin https://sso.company.ru]');
    if (key === '--identity-origin') options.identityOrigins.push(value);
    else options[{ '--server': 'server', '--out': 'output', '--version': 'version' }[key]] = value;
  }
  if (!options.server || !options.output || !options.version) throw new Error('Required: --server, --out, --version');
  build(options).then(value => console.log(`Package: ${value}`), error => { console.error(error.message); process.exitCode = 1; });
}
