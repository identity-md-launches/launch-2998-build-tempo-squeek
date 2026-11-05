import { readdir, readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve('.');
const ceiling = 8_388_608;
const excluded = new Set(['.git', '.github', '.imd', 'node_modules', '.cache', '.npm', '.vite', '.turbo', 'playwright-report', 'test-results']);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = relative(root, path).replaceAll('\\', '/');
    if (excluded.has(entry.name) || entry.name.startsWith('.env') || name === 'test/scratch' || entry.name.endsWith('.tsbuildinfo')) continue;
    assert.notEqual(entry.name, '.gitmodules', 'No Git submodule may be delivered.');
    assert.ok(!entry.isSymbolicLink(), `Do not submit symlinks: ${name}`);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile()) files.push({ path: name, bytes: (await lstat(path)).size });
  }
}
await walk(root);
const total = files.reduce((sum, f) => sum + f.bytes, 0);
assert.ok(total < ceiling, `Submission is ${total} bytes; maximum is ${ceiling}.`);
assert.ok(files.some(f => f.path === 'dist/index.html'));
assert.ok(files.some(f => f.path === 'package-lock.json'));
assert.ok(files.find(f => f.path === '.gitignore')?.bytes <= 512, '.gitignore has an explicit 512-byte path budget.');
assert.ok(files.every(f => !/\.(tgz|zip|tar|map)$/.test(f.path)), 'Unnecessary dependency archives or source maps found.');

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.deepEqual(lock.packages[''].devDependencies, manifest.devDependencies, 'Lockfile must match the manifest.');
assert.ok(Object.values(lock.packages).every(p => !p.resolved || p.resolved.startsWith('https://registry.npmjs.org/')), 'Dependency lock URLs must use the public registry.');

const html = await readFile('dist/index.html', 'utf8');
const localUrls = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)].map(m => m[1]);
const social = html.match(/property="og:image" content="([^"]+)"/)?.[1];
assert.ok(social, 'Share image missing.');
localUrls.push(social);
for (const url of localUrls) {
  assert.ok(url.startsWith('./'), `Static asset URL must be relative: ${url}`);
  assert.ok((await lstat(resolve('dist', url))).isFile(), `Missing export asset: ${url}`);
}
for (const file of files.filter(f => f.path.startsWith('dist/') && f.path.endsWith('.css'))) {
  const css = await readFile(file.path, 'utf8');
  for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const url = match[1];
    if (url.startsWith('data:')) continue;
    assert.ok(!/^(\/|https?:)/.test(url), `CSS asset must use a relative URL: ${url}`);
    assert.ok((await lstat(resolve(dirname(file.path), url))).isFile(), `Missing CSS asset: ${url}`);
  }
}
const exportBytes = files.filter(f => f.path.startsWith('dist/')).reduce((sum, f) => sum + f.bytes, 0);
const report = { totalBytes: total, ceilingBytes: ceiling, remainingBytes: ceiling - total, exportBytes, fileCount: files.length, relativeAssets: localUrls, files };
await mkdir('test/scratch', { recursive: true });
await writeFile('test/scratch/bundle-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ totalBytes: total, ceilingBytes: ceiling, remainingBytes: ceiling - total, exportBytes, fileCount: files.length, relativeAssetCheck: 'passed', publicRegistryLockfile: 'passed', symlinksAndArchives: 'none' }, null, 2));
