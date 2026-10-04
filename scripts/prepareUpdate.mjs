import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
import path from 'node:path';

export function createUpdateManifest({
  version,
  signature,
  installerName,
  notes,
  date,
  preview = false,
}) {
  const versionPattern = preview ? /^2\.0\.0-preview\.\d+$/ : /^\d+\.\d+\.\d+$/;
  if (!versionPattern.test(version)) throw new Error('Version does not match the release channel.');
  const productName = preview ? 'Obsidian Hub 2 Preview' : 'Obsidian Hub';
  if (installerName !== `${productName}_${version}_x64-setup.exe`) {
    throw new Error('Installer name does not match the release version.');
  }
  const encodedSignature = signature.trim();
  if (
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSignature) ||
    !Buffer.from(encodedSignature, 'base64').toString('utf8').startsWith('untrusted comment:')
  ) {
    throw new Error('Missing or invalid updater signature.');
  }
  if (!notes.trim()) throw new Error('Release notes are required.');
  return {
    version,
    notes: notes.trim(),
    pub_date: new Date(date).toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: encodedSignature,
        url: `https://github.com/LeeDaud/Obsidian-Hub/releases/download/v${version}/${encodeURIComponent(installerName.replaceAll(' ', '.'))}`,
      },
    },
  };
}

async function prepare() {
  const profile = process.argv[2] ?? 'release';
  if (!['debug', 'release'].includes(profile))
    throw new Error('Expected debug or release profile.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const packageConfig = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const cargoConfig = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = cargoConfig.match(/^version = "([^"]+)"/m)?.[1];
  if (config.version !== packageConfig.version || config.version !== cargoVersion) {
    throw new Error('Hub versions must match before publishing.');
  }
  const preview = config.version.startsWith('2.0.0-preview.');
  const productName = preview ? 'Obsidian Hub 2 Preview' : 'Obsidian Hub';
  const identifier = preview ? 'io.github.obsidian-hub.v2preview' : 'io.github.obsidian-hub';
  const endpoint = preview
    ? 'https://github.com/LeeDaud/Obsidian-Hub/releases/download/v2-preview-channel/latest.json'
    : 'https://github.com/LeeDaud/Obsidian-Hub/releases/latest/download/latest.json';
  if (
    config.productName !== productName ||
    config.identifier !== identifier ||
    config.plugins?.updater?.endpoints?.length !== 1 ||
    config.plugins.updater.endpoints[0] !== endpoint ||
    config.bundle?.createUpdaterArtifacts !== true
  ) {
    throw new Error(
      'Application identity, updater artifacts or endpoint does not match the channel.',
    );
  }
  const installerName = `${productName}_${config.version}_x64-setup.exe`;
  const directory = path.join(root, 'src-tauri/target', profile, 'bundle/nsis');
  const installer = path.join(directory, installerName);
  const installerStat = await stat(installer);
  if (!installerStat.isFile() || installerStat.size === 0)
    throw new Error('Installer is missing or empty.');
  const signature = await readFile(`${installer}.sig`, 'utf8');
  const notes = (await readFile(path.join(root, 'docs/release-notes.md'), 'utf8')).replace(
    /\r\n/g,
    '\n',
  );
  if (!notes.startsWith(`# Obsidian Hub ${config.version}\n`)) {
    throw new Error('Release notes version does not match.');
  }
  const manifest = createUpdateManifest({
    version: config.version,
    signature,
    installerName,
    notes,
    date: new Date(),
    preview,
  });
  const output = path.join(directory, 'latest.json');
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared ${output}. Nothing has been published.`);
  if (profile === 'debug')
    console.log('Debug build: use only for local validation, not the public update feed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
