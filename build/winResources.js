'use strict';

/**
 * Windows .exe'sine ikon ve surum bilgisini saf JavaScript ile yazar.
 *
 * Neden: electron-builder bu isi wine uzerinden rcedit.exe ile yapiyor.
 * Apple Silicon makinede wine x86_64 ikilisi Rosetta olmadan calismiyor
 * ("bad CPU type in executable") ve Windows paketi hic uretilemiyor.
 * resedit PE kaynaklarini dogrudan duzenledigi icin wine'a gerek kalmiyor.
 */

const fs = require('node:fs');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Resource, Data } = require('resedit');

/** .ico dosyasindaki tum boyutlari okur. */
function readIcon(icoPath) {
  return Data.IconFile.from(fs.readFileSync(icoPath)).icons.map((i) => i.data);
}

function applyWindowsResources({ exePath, icoPath, version, productName, description, company }) {
  const exe = NtExecutable.from(fs.readFileSync(exePath));
  const res = NtExecutableResource.from(exe);

  if (icoPath && fs.existsSync(icoPath)) {
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, readIcon(icoPath));
  }

  const vi = Resource.VersionInfo.fromEntries(res.entries)[0] || Resource.VersionInfo.createEmpty();
  const quad = version.split('.').map(Number);
  while (quad.length < 4) quad.push(0);
  vi.setFileVersion(quad[0], quad[1], quad[2], quad[3], 1033);
  vi.setProductVersion(quad[0], quad[1], quad[2], quad[3], 1033);
  vi.setStringValues({ lang: 1033, codepage: 1200 }, {
    FileDescription: description,
    ProductName: productName,
    LegalCopyright: company,
    InternalName: productName,
    OriginalFilename: path.basename(exePath),
    FileVersion: version,
    ProductVersion: version
  });
  vi.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

module.exports = { applyWindowsResources };
