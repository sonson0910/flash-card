import { deflateRawSync } from 'node:zlib';
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertZipMatchesFiles,
  collectExtensionFiles,
  readExtensionManifest,
} from './browser-extension-package.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'extensions', 'lingoflash');
const outputRoot = path.join(root, 'artifacts', 'browser-extension');
const unpackedRoot = path.join(outputRoot, 'lingoflash');
const manifest = await readExtensionManifest(sourceRoot);
const zipPath = path.join(outputRoot, `lingoflash-extension-v${manifest.version}.zip`);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});
const crc32 = buffer => {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};
const createZip = async files => {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  const dosTime = 0;
  const dosDate = 0x21;
  for (const file of files) {
    const source = await readFile(file.absolute);
    const compressed = deflateRawSync(source, { level: 9 });
    const name = Buffer.from(file.relative, 'utf8');
    const checksum = crc32(source);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034B50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, compressed);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014B50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
};

await rm(unpackedRoot, { recursive: true, force: true });
await mkdir(unpackedRoot, { recursive: true });
for (const file of await collectExtensionFiles(sourceRoot, manifest)) {
  const destination = path.join(unpackedRoot, file.relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(file.absolute, destination);
}
const packagedFiles = await collectExtensionFiles(unpackedRoot, manifest);
await mkdir(outputRoot, { recursive: true });
await writeFile(zipPath, await createZip(packagedFiles));
await assertZipMatchesFiles(zipPath, packagedFiles);
const zipStats = await stat(zipPath);
console.log(`Built unpacked extension: ${path.relative(root, unpackedRoot)}`);
console.log(`Built ZIP (${zipStats.size} bytes): ${path.relative(root, zipPath)}`);
