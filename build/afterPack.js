'use strict';

/**
 * macOS paketlerini ad-hoc imzalar.
 *
 * Neden gerekli: electron-builder imzasiz birakinca pakette Electron'un kendi
 * eksik imzasi kaliyor (arm64) ya da hic imza olmuyor (x64). Her iki durumda da
 * codesign dogrulamasi patliyor ve macOS uygulamayi bozuk sayip
 * "SubKill hasar gormus olabilir" diyor.
 *
 * DIKKAT 1: hardened runtime bayragi (codesign --options runtime) KULLANILMAZ.
 * Ad-hoc imzayla birlesince dyld, ana ikili ile cerceveler arasinda Team ID
 * esitligi ariyor; ikisinde de Team ID olmadigi icin uygulama
 * "different Team IDs" hatasiyla hic acilmiyor.
 *
 * DIKKAT 2: --deep tek basina yeterli degil. Imzalama icten disa dogru
 * yapilmali: once en derindeki Mach-O ikilileri (crashpad handler gibi
 * yardimcilar dahil), sonra cerceve surumleri ve yardimci uygulamalar,
 * en son ana paket. Aksi halde "code object is not signed at all" aliniyor.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MACHO = new Set([0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe, 0xbebafeca]);

function isMachO(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    if (fs.readSync(fd, buf, 0, 4, 0) < 4) return false;
    return MACHO.has(buf.readUInt32BE(0)) || MACHO.has(buf.readUInt32LE(0));
  } catch (_) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sign(target) {
  execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], { stdio: 'inherit' });
}

/** Paketteki her seyi derinlikten yuzeye dogru siralar. */
function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(full, acc);
      if (full.endsWith('.app') || /\.framework\/Versions\/[^/]+$/.test(full) || full.endsWith('.framework')) {
        acc.push(full);
      }
    } else if (entry.isFile() && isMachO(full)) {
      acc.push(full);
    }
  }
  return acc;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, appName + '.app');

  const targets = walk(appPath, []).filter((t) => t !== appPath);
  targets.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const target of targets) sign(target);
  sign(appPath);

  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });

  const opts = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  let info = '';
  for (const t of [appPath, path.join(appPath, 'Contents', 'MacOS', appName)]) {
    try { info += execFileSync('codesign', ['-dv', '--verbose=2', t], opts); } catch (e) { info += String(e.stderr || ''); }
  }
  if (/runtime/.test(info)) throw new Error('afterPack: hardened runtime bayragi kalmis, uygulama acilmaz');

  console.log('afterPack: ' + appName + '.app imzalandi (' + targets.length + ' bilesen), dogrulandi, runtime bayragi yok');
};
