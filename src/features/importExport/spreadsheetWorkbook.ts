export const MAX_SPREADSHEET_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_SPREADSHEET_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const MAX_SPREADSHEET_ZIP_ENTRIES = 5_000;
export const MAX_SPREADSHEET_ROWS = 5_001;
export const MAX_SPREADSHEET_COLUMNS = 64;
export const MAX_SPREADSHEET_CELLS = 200_000;
export const MAX_SPREADSHEET_CELL_STRING_LENGTH = 4_096;
export const MAX_SPREADSHEET_SHEETS = 32;
export const MAX_SPREADSHEET_WORKSHEET_XML_BYTES = 16 * 1024 * 1024;

export interface SpreadsheetWorkbook {
  structuredRows: unknown[];
  flatRows: unknown[][];
}

export class SpreadsheetReadError extends Error {
  constructor(message = 'Failed to read the spreadsheet.') {
    super(message);
    this.name = 'SpreadsheetReadError';
  }
}

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_DESCRIPTOR_FLAG = 0x0008;
const ZIP_ENCRYPTED_FLAG = 0x0001;
const ZIP_SAFE_FLAGS = ZIP_UTF8_FLAG;
const ZIP_STORED_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;

const CFB_MAGIC = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

const readU16 = (view: DataView, offset: number): number => view.getUint16(offset, true);
const readU32 = (view: DataView, offset: number): number => view.getUint32(offset, true);

const zipFailure = (message: string): never => {
  throw new SpreadsheetReadError(`Invalid XLSX archive: ${message}`);
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean => (
  left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
);

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) === 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

const crc32 = (bytes: Uint8Array, initial = 0xffffffff): number => {
  let value = initial;
  for (const byte of bytes) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};

const containsMagic = (bytes: Uint8Array, magic: Uint8Array): boolean => (
  bytes.byteLength >= magic.byteLength && sameBytes(bytes.subarray(0, magic.byteLength), magic)
);

const findEndOfCentralDirectory = (view: DataView): number => {
  const minimum = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (readU32(view, offset) !== ZIP_EOCD_SIGNATURE || offset + 22 > view.byteLength) continue;
    const commentLength = readU16(view, offset + 20);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  return zipFailure('missing end-of-central-directory record.');
};

const rejectZip64Extra = (view: DataView, offset: number, length: number): void => {
  if (offset + length > view.byteLength) zipFailure('extra field is truncated.');
  let cursor = offset;
  const end = offset + length;
  while (cursor < end) {
    if (cursor + 4 > end) zipFailure('extra field header is truncated.');
    const id = readU16(view, cursor);
    const size = readU16(view, cursor + 2);
    cursor += 4;
    if (cursor + size > end) zipFailure('extra field payload is truncated.');
    if (id === ZIP64_EXTRA_FIELD) zipFailure('ZIP64 extra fields are not supported.');
    cursor += size;
  }
};

interface ZipEntry {
  name: Uint8Array;
  nameText: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  data: Uint8Array;
}

const decodeZipName = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return zipFailure('entry name is not valid UTF-8.');
  }
};

const asciiCaseFold = (value: string): string => value.replace(/[A-Z]/g, character => (
  String.fromCharCode(character.charCodeAt(0) + 32)
));

const parseZipEntries = (bytes: Uint8Array, view: DataView, eocdOffset: number): ZipEntry[] => {
  for (let offset = Math.max(0, eocdOffset - 128); offset <= eocdOffset - 4; offset += 1) {
    const signature = readU32(view, offset);
    if (signature === ZIP64_EOCD_SIGNATURE || signature === ZIP64_LOCATOR_SIGNATURE) {
      zipFailure('ZIP64 archives are not supported.');
    }
  }

  const diskNumber = readU16(view, eocdOffset + 4);
  const centralDisk = readU16(view, eocdOffset + 6);
  const entriesOnDisk = readU16(view, eocdOffset + 8);
  const entries = readU16(view, eocdOffset + 10);
  const centralSize = readU32(view, eocdOffset + 12);
  const centralOffset = readU32(view, eocdOffset + 16);
  const commentLength = readU16(view, eocdOffset + 20);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) {
    zipFailure('multi-disk archives are not supported.');
  }
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    zipFailure('ZIP64 archives are not supported.');
  }
  if (eocdOffset + 22 + commentLength !== view.byteLength) {
    zipFailure('truncated archive comment.');
  }
  const centralEnd = centralOffset + centralSize;
  if (centralOffset > eocdOffset || centralEnd !== eocdOffset) {
    zipFailure('central directory is truncated.');
  }
  if (entries > MAX_SPREADSHEET_ZIP_ENTRIES) {
    zipFailure(`archive contains more than ${MAX_SPREADSHEET_ZIP_ENTRIES} entries.`);
  }

  const entriesByCentralOrder: Array<Omit<ZipEntry, 'data' | 'nameText'>> = [];
  let cursor = centralOffset;
  let declaredExpandedBytes = 0;
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > centralEnd || readU32(view, cursor) !== ZIP_CENTRAL_SIGNATURE) {
      zipFailure('central directory entry is truncated.');
    }
    const flags = readU16(view, cursor + 8);
    const method = readU16(view, cursor + 10);
    const crc = readU32(view, cursor + 16);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentSize = readU16(view, cursor + 32);
    const diskStart = readU16(view, cursor + 34);
    const localOffset = readU32(view, cursor + 42);
    const nameOffset = cursor + 46;
    const extraOffset = nameOffset + nameLength;
    const next = extraOffset + extraLength + commentSize;
    if (next > centralEnd) zipFailure('central directory entry metadata is truncated.');
    if ((flags & ~ZIP_SAFE_FLAGS) !== 0 || (flags & ZIP_ENCRYPTED_FLAG) !== 0) {
      zipFailure('entry uses unsafe flags.');
    }
    if ((flags & ZIP_DESCRIPTOR_FLAG) !== 0) zipFailure('data descriptors are not supported.');
    if (method !== ZIP_STORED_METHOD && method !== ZIP_DEFLATE_METHOD) {
      zipFailure('entry compression method is not supported.');
    }
    if (diskStart !== 0) zipFailure('multi-disk entries are not supported.');
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      zipFailure('ZIP64 entry metadata is not supported.');
    }
    rejectZip64Extra(view, extraOffset, extraLength);
    const name = bytes.subarray(nameOffset, extraOffset);
    if (localOffset + 30 > centralOffset) zipFailure('local header is truncated.');
    declaredExpandedBytes += uncompressedSize;
    if (declaredExpandedBytes > MAX_SPREADSHEET_UNCOMPRESSED_BYTES) {
      zipFailure(`declared uncompressed bytes exceed ${MAX_SPREADSHEET_UNCOMPRESSED_BYTES}.`);
    }
    entriesByCentralOrder.push({
      name,
      method,
      flags,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor = next;
  }
  if (cursor !== centralEnd) zipFailure('central directory entry count does not match metadata.');

  const regions: Array<{ start: number; end: number }> = [];
  const entriesWithData: ZipEntry[] = [];
  const normalizedNames = new Set<string>();
  for (const entry of entriesByCentralOrder) {
    const offset = entry.localOffset;
    if (offset + 30 > centralOffset || readU32(view, offset) !== ZIP_LOCAL_SIGNATURE) {
      zipFailure('archive entry local header is missing.');
    }
    const localFlags = readU16(view, offset + 6);
    const localMethod = readU16(view, offset + 8);
    const localCrc = readU32(view, offset + 14);
    const localCompressedSize = readU32(view, offset + 18);
    const localUncompressedSize = readU32(view, offset + 22);
    const localNameLength = readU16(view, offset + 26);
    const localExtraLength = readU16(view, offset + 28);
    const localNameOffset = offset + 30;
    const localExtraOffset = localNameOffset + localNameLength;
    const dataOffset = localExtraOffset + localExtraLength;
    const dataEnd = dataOffset + entry.compressedSize;
    if (dataOffset > centralOffset || dataEnd > centralOffset || dataEnd < dataOffset) {
      zipFailure('archive entry data is truncated.');
    }
    rejectZip64Extra(view, localExtraOffset, localExtraLength);
    if (
      localFlags !== entry.flags
      || localMethod !== entry.method
      || localCrc !== entry.crc
      || localCompressedSize !== entry.compressedSize
      || localUncompressedSize !== entry.uncompressedSize
    ) zipFailure('local and central entry metadata differ.');
    const localName = bytes.subarray(localNameOffset, localExtraOffset);
    if (!sameBytes(localName, entry.name)) zipFailure('local and central entry names differ.');
    if (entry.method === ZIP_STORED_METHOD && entry.compressedSize !== entry.uncompressedSize) {
      zipFailure('stored entry sizes differ.');
    }
    const nameText = normalizePackagePath(decodeZipName(entry.name));
    const nameIdentity = asciiCaseFold(nameText);
    if (normalizedNames.has(nameIdentity)) zipFailure('archive entry names are not unique.');
    normalizedNames.add(nameIdentity);
    regions.push({ start: offset, end: dataEnd });
    entriesWithData.push({
      ...entry,
      nameText,
      data: bytes.subarray(dataOffset, dataEnd),
    });
  }
  regions.sort((left, right) => left.start - right.start);
  for (let index = 1; index < regions.length; index += 1) {
    if (regions[index - 1].end > regions[index].start) zipFailure('archive entry regions overlap.');
  }
  return entriesWithData;
};

const readDeflateEntry = async (
  compressed: Uint8Array,
  collect: boolean,
): Promise<{ size: number; crc: number; bytes?: Uint8Array }> => {
  if (typeof globalThis.DecompressionStream !== 'function') {
    zipFailure('deflate decompression is unavailable.');
  }
  try {
    const Decoder = globalThis.DecompressionStream as unknown as new (format: string) => DecompressionStream;
    const output = new Blob([compressed]).stream().pipeThrough(new Decoder('deflate-raw'));
    const reader = output.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let checksum = 0xffffffff;
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      checksum = crc32(result.value, checksum) ^ 0xffffffff;
      if (total > MAX_SPREADSHEET_UNCOMPRESSED_BYTES) {
        zipFailure(`actual uncompressed bytes exceed ${MAX_SPREADSHEET_UNCOMPRESSED_BYTES}.`);
      }
      if (collect && total > MAX_SPREADSHEET_WORKSHEET_XML_BYTES) {
        zipFailure(`worksheet XML exceeds ${MAX_SPREADSHEET_WORKSHEET_XML_BYTES} bytes.`);
      }
      if (collect) chunks.push(result.value);
    }
    if (!collect) return { size: total, crc: (checksum ^ 0xffffffff) >>> 0 };
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { size: total, crc: (checksum ^ 0xffffffff) >>> 0, bytes };
  } catch (error) {
    if (error instanceof SpreadsheetReadError) throw error;
    return zipFailure('deflate entry could not be decompressed.');
  }
};

const parseCellReference = (reference: string): { row: number; column: number } | null => {
  const match = /^\$?([A-Z]+)\$?([1-9][0-9]*)$/i.exec(reference.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) return null;
  return { row: row - 1, column: column - 1 };
};

const parseSheetRange = (reference: string): { row: number; column: number }[] | null => {
  const parts = reference.split(':');
  if (parts.length > 2) return null;
  const start = parseCellReference(parts[0]);
  const end = parseCellReference(parts[1] ?? parts[0]);
  return start && end ? [start, end] : null;
};

const XML_PREFIX = '(?:[A-Za-z_][\\w.-]*:)?';

const xmlRootName = (xml: string): string | null => {
  const document = xml.replace(
    /^\uFEFF?\s*(?:<\?[\s\S]*?\?>\s*)?(?:<!--[\s\S]*?-->\s*)*/,
    '',
  );
  return /^<(?:(?:[A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)\b[^>]*>/s.exec(document)?.[1]?.toLowerCase() ?? null;
};

const xmlOpeningTags = (xml: string, name: string): string[] => (
  Array.from(xml.matchAll(new RegExp(`<${XML_PREFIX}${name}\\b[^>]*>`, 'gi')), match => match[0])
);

const xmlAttribute = (tag: string, name: string): string | undefined => (
  new RegExp(`(?:^|\\s)${XML_PREFIX}${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1]
);

const xmlElementBodies = (xml: string, name: string): string[] => (
  Array.from(xml.matchAll(new RegExp(`<${XML_PREFIX}${name}\\b[^>]*>([\\s\\S]*?)</${XML_PREFIX}${name}\\s*>`, 'gi')), match => match[1])
);

const xmlTextLength = (xml: string): number => (
  xml
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>|<[^>]*>/g, (_match, cdata: string | undefined) => cdata ?? '')
    .replace(/&(?:amp|lt|gt|quot|apos|#\d+);/gi, 'x')
    .length
);

const preflightTextElements = (xml: string, label: string, names = ['t']): void => {
  let total = 0;
  for (const name of names) {
    for (const text of xmlElementBodies(xml, name)) {
      total += xmlTextLength(text);
      if (total > MAX_SPREADSHEET_CELL_STRING_LENGTH) {
        throw new SpreadsheetReadError(`${label} exceeds ${MAX_SPREADSHEET_CELL_STRING_LENGTH} characters.`);
      }
    }
  }
};

export const preflightSharedStringsXml = (bytes: Uint8Array): void => {
  if (bytes.byteLength > MAX_SPREADSHEET_WORKSHEET_XML_BYTES) {
    throw new SpreadsheetReadError(`Shared strings XML exceeds ${MAX_SPREADSHEET_WORKSHEET_XML_BYTES} bytes.`);
  }
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SpreadsheetReadError('Shared strings XML is not valid UTF-8.');
  }
  if (xmlRootName(xml) !== 'sst') throw new SpreadsheetReadError('Shared strings XML has an invalid root.');
  const itemTags = xmlOpeningTags(xml, 'si');
  if (itemTags.length > MAX_SPREADSHEET_CELLS) throw new SpreadsheetReadError('Shared strings exceed cell bounds.');
  const items = xmlElementBodies(xml, 'si');
  for (const item of items) preflightTextElements(item, 'Shared string');
};

const packageFailure = (message: string): never => {
  throw new SpreadsheetReadError(`Invalid OOXML package: ${message}`);
};

const normalizePackagePath = (value: string, base = '', allowAbsolute = false): string => {
  if (!value || value.includes('\\') || value.includes('\0') || /^[A-Za-z]:/.test(value)) {
    return packageFailure('entry path is unsafe.');
  }
  if (value.startsWith('/') && !allowAbsolute) return packageFailure('entry path is unsafe.');
  const combined = value.startsWith('/') ? value.slice(1) : (base ? `${base}/${value}` : value);
  const segments = combined.split('/');
  if (
    !segments.length
    || segments.some((segment, index) => segment === '.' || segment === '..' || (!segment && index !== segments.length - 1))
    || combined.startsWith('/')
  ) return packageFailure('entry path is unsafe.');
  return segments.join('/');
};

interface XmlPart {
  bytes: Uint8Array;
  name: string;
  root: string | null;
  text: string;
}

const decodeXmlPart = (name: string, bytes: Uint8Array): XmlPart => {
  if (bytes.byteLength > MAX_SPREADSHEET_WORKSHEET_XML_BYTES) {
    return packageFailure('XML part exceeds its size limit.');
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return packageFailure('XML part is not valid UTF-8.');
  }
  return { bytes, name, root: xmlRootName(text), text };
};

const validateOoxmlPackage = (entries: ZipEntry[], xmlParts: Map<string, XmlPart>): void => {
  if (entries.some(entry => {
    const identity = asciiCaseFold(entry.nameText);
    return identity === 'mimetype'
      || identity === 'xl/workbook.bin'
      || identity === 'meta-inf/manifest.xml'
      || identity === 'objectdata.xml'
      || identity === 'index/document.iwa';
  })) {
    packageFailure('non-OOXML package markers are not supported.');
  }
  const contentTypes = xmlParts.get(asciiCaseFold('[Content_Types].xml')) ?? packageFailure('required OOXML parts are missing.');
  const workbook = xmlParts.get(asciiCaseFold('xl/workbook.xml')) ?? packageFailure('required OOXML parts are missing.');
  const relationships = xmlParts.get(asciiCaseFold('xl/_rels/workbook.xml.rels')) ?? packageFailure('required OOXML parts are missing.');
  if (contentTypes.root !== 'types' || workbook.root !== 'workbook' || relationships.root !== 'relationships') {
    packageFailure('required OOXML parts have invalid roots.');
  }
  const overrides = xmlOpeningTags(contentTypes.text, 'Override').map(tag => ({
    part: asciiCaseFold(normalizePackagePath(xmlAttribute(tag, 'PartName') ?? '', '', true)),
    type: xmlAttribute(tag, 'ContentType') ?? '',
  }));
  const workbookType = overrides.find(item => item.part === asciiCaseFold('xl/workbook.xml'))?.type;
  if (overrides.some(item => /oasis|sheet\.binary/i.test(item.type))) {
    packageFailure('non-OOXML content types are not supported.');
  }
  if (workbookType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml') {
    packageFailure('workbook content type is not OOXML.');
  }

  const relationById = new Map<string, { target: string; type: string }>();
  for (const tag of xmlOpeningTags(relationships.text, 'Relationship')) {
    const id = xmlAttribute(tag, 'Id') ?? packageFailure('relationship metadata is incomplete.');
    const target = xmlAttribute(tag, 'Target') ?? packageFailure('relationship metadata is incomplete.');
    const type = xmlAttribute(tag, 'Type') ?? packageFailure('relationship metadata is incomplete.');
    relationById.set(id, { target, type });
  }

  let worksheetCount = 0;
  const sheets = xmlOpeningTags(workbook.text, 'sheet');
  if (!sheets.length) packageFailure('workbook has no sheets.');
  if (sheets.length > MAX_SPREADSHEET_SHEETS) {
    packageFailure(`workbook contains more than ${MAX_SPREADSHEET_SHEETS} sheets.`);
  }
  for (const sheet of sheets) {
    const relationId = xmlAttribute(sheet, 'id') ?? packageFailure('workbook sheet relationship is missing.');
    const relation = relationById.get(relationId) ?? packageFailure('worksheet relationship is missing.');
    if (!/\/worksheet$/i.test(relation.type)) packageFailure('worksheet relationship is missing.');
    const target = asciiCaseFold(normalizePackagePath(relation.target, 'xl', true));
    const worksheet = xmlParts.get(target);
    if (!worksheet || worksheet.root !== 'worksheet') packageFailure('worksheet relationship target is invalid.');
    const contentType = overrides.find(item => item.part === target)?.type;
    if (contentType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml') {
      packageFailure('worksheet content type is not OOXML.');
    }
    worksheetCount += 1;
  }
  if (!worksheetCount) packageFailure('workbook has no worksheet parts.');
};

export const preflightWorksheetXml = (bytes: Uint8Array): void => {
  if (bytes.byteLength > MAX_SPREADSHEET_WORKSHEET_XML_BYTES) {
    throw new SpreadsheetReadError(`Worksheet XML exceeds ${MAX_SPREADSHEET_WORKSHEET_XML_BYTES} bytes.`);
  }
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new SpreadsheetReadError('Worksheet XML is not valid UTF-8.');
  }
  if (xmlRootName(xml) !== 'worksheet') throw new SpreadsheetReadError('Worksheet XML has an invalid root.');
  const dimension = new RegExp(`<${XML_PREFIX}dimension\\b[^>]*\\bref\\s*=\\s*["']([^"']+)["']`, 'i').exec(xml)?.[1];
  if (dimension) {
    const range = parseSheetRange(dimension);
    if (!range) throw new SpreadsheetReadError('Worksheet XML has an invalid dimension.');
    const rowCount = range[1].row - range[0].row + 1;
    const columnCount = range[1].column - range[0].column + 1;
    if (rowCount < 1 || columnCount < 1) throw new SpreadsheetReadError('Worksheet XML has an invalid dimension.');
    if (rowCount > MAX_SPREADSHEET_ROWS) throw new SpreadsheetReadError('Worksheet XML exceeds row bounds.');
    if (columnCount > MAX_SPREADSHEET_COLUMNS) throw new SpreadsheetReadError('Worksheet XML exceeds column bounds.');
    if (rowCount * columnCount > MAX_SPREADSHEET_CELLS) throw new SpreadsheetReadError('Worksheet XML exceeds cell bounds.');
  }
  const cellTags = xml.match(new RegExp(`<${XML_PREFIX}c(?:\\s|>)`, 'gi')) ?? [];
  if (cellTags.length > MAX_SPREADSHEET_CELLS) throw new SpreadsheetReadError('Worksheet XML exceeds cell bounds.');
  const rowTags = xmlOpeningTags(xml, 'row');
  if (rowTags.length > MAX_SPREADSHEET_ROWS) throw new SpreadsheetReadError('Worksheet XML exceeds row bounds.');
  for (const rowTag of rowTags) {
    const rowReference = xmlAttribute(rowTag, 'r');
    if (!rowReference) continue;
    const row = Number(rowReference);
    if (!Number.isSafeInteger(row) || row < 1) throw new SpreadsheetReadError('Worksheet XML has an invalid row reference.');
    if (row > MAX_SPREADSHEET_ROWS) throw new SpreadsheetReadError('Worksheet XML exceeds row bounds.');
  }
  let implicitCells = 0;
  for (const rowBody of xmlElementBodies(xml, 'row')) {
    const rowCells = xmlOpeningTags(rowBody, 'c').length;
    if (rowCells > MAX_SPREADSHEET_COLUMNS) throw new SpreadsheetReadError('Worksheet XML exceeds column bounds.');
    implicitCells += rowCells;
    if (implicitCells > MAX_SPREADSHEET_CELLS) throw new SpreadsheetReadError('Worksheet XML exceeds cell bounds.');
  }
  const cellPattern = new RegExp(`<${XML_PREFIX}c\\b[^>]*>`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = cellPattern.exec(xml))) {
    const reference = /\br\s*=\s*["']([^"']+)["']/i.exec(match[0])?.[1];
    if (!reference) continue;
    const cell = parseCellReference(reference);
    if (!cell) throw new SpreadsheetReadError('Worksheet XML has an invalid cell reference.');
    if (cell.row + 1 > MAX_SPREADSHEET_ROWS) throw new SpreadsheetReadError('Worksheet XML exceeds row bounds.');
    if (cell.column + 1 > MAX_SPREADSHEET_COLUMNS) throw new SpreadsheetReadError('Worksheet XML exceeds column bounds.');
  }
  for (const cell of xmlElementBodies(xml, 'c')) preflightTextElements(cell, 'Cell text', ['t', 'v']);
};

const isXmlPartName = (name: string): boolean => /\.(?:xml|rels)$/i.test(name);

export const preflightZipArchive = async (bytes: Uint8Array): Promise<void> => {
  if (bytes.byteLength < 22) zipFailure('truncated end-of-central-directory record.');
  if (typeof globalThis.DecompressionStream !== 'function') {
    zipFailure('deflate decompression is unavailable.');
  }
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const eocdOffset = findEndOfCentralDirectory(view);
    const entries = parseZipEntries(bytes, view, eocdOffset);
    const xmlParts = new Map<string, XmlPart>();
    let actualExpandedBytes = 0;
    for (const entry of entries) {
      let actualSize: number;
      let actualCrc: number;
      let worksheetBytes: Uint8Array | undefined;
      if (entry.method === ZIP_STORED_METHOD) {
        actualSize = entry.data.byteLength;
        actualCrc = crc32(entry.data);
      }
      else {
        const decompressed = await readDeflateEntry(entry.data, isXmlPartName(entry.nameText));
        actualSize = decompressed.size;
        actualCrc = decompressed.crc;
        worksheetBytes = decompressed.bytes;
      }
      if (actualSize !== entry.uncompressedSize) zipFailure('actual and declared entry sizes differ.');
      if (actualCrc !== entry.crc) zipFailure('actual and declared entry CRCs differ.');
      actualExpandedBytes += actualSize;
      if (actualExpandedBytes > MAX_SPREADSHEET_UNCOMPRESSED_BYTES) {
        zipFailure(`actual uncompressed bytes exceed ${MAX_SPREADSHEET_UNCOMPRESSED_BYTES}.`);
      }
      if (isXmlPartName(entry.nameText)) {
        const xmlPart = decodeXmlPart(entry.nameText, worksheetBytes ?? entry.data);
        xmlParts.set(asciiCaseFold(entry.nameText), xmlPart);
        if (xmlPart.root === 'worksheet') preflightWorksheetXml(xmlPart.bytes);
        if (xmlPart.root === 'sst') preflightSharedStringsXml(xmlPart.bytes);
      }
    }
    validateOoxmlPackage(entries, xmlParts);
  } catch (error) {
    if (error instanceof SpreadsheetReadError) throw error;
    zipFailure('archive preflight failed.');
  }
};

const CSV_DELIMITERS = [44, 9, 59, 124] as const;

interface CsvRecord {
  delimiterCounts: Map<number, number>;
  hasContent: boolean;
}

const readCsvSepDirective = (bytes: Uint8Array, start: number): number | undefined => {
  if (bytes[start] !== 0x73 || bytes[start + 1] !== 0x65 || bytes[start + 2] !== 0x70 || bytes[start + 3] !== 0x3d) {
    return undefined;
  }
  const separator = bytes[start + 4];
  if (!CSV_DELIMITERS.includes(separator as typeof CSV_DELIMITERS[number])
    || (bytes[start + 5] !== 0x0a && bytes[start + 5] !== 0x0d)) {
    throw new SpreadsheetReadError('CSV sep directive is invalid.');
  }
  return separator;
};

const scanCsvRecords = (
  bytes: Uint8Array,
  start: number,
  onRecord: (record: CsvRecord) => boolean,
  activeDelimiter?: number,
): void => {
  const newCounts = (): Map<number, number> => new Map<number, number>(CSV_DELIMITERS.map(delimiter => [delimiter, 0]));
  let counts = newCounts();
  let inQuotes = false;
  let quotedField = false;
  let fieldStart = true;
  let hasContent = false;
  const finishRecord = (): boolean => {
    const stop = onRecord({ delimiterCounts: counts, hasContent });
    counts = newCounts();
    quotedField = false;
    fieldStart = true;
    hasContent = false;
    return stop;
  };
  for (let index = start; index < bytes.byteLength; index += 1) {
    const value = bytes[index];
    if (value === 34) {
      hasContent = true;
      if (fieldStart) {
        quotedField = true;
        inQuotes = true;
        fieldStart = false;
      } else if (quotedField) {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      hasContent = true;
    } else if (activeDelimiter === undefined
      ? CSV_DELIMITERS.includes(value as typeof CSV_DELIMITERS[number])
      : value === activeDelimiter) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
      hasContent = true;
      quotedField = false;
      fieldStart = true;
    } else if (value === 10) {
      if (finishRecord()) return;
    } else if (value === 13) {
      if (bytes[index + 1] !== 10 && finishRecord()) return;
    } else {
      hasContent = true;
      fieldStart = false;
    }
  }
  if (inQuotes) throw new SpreadsheetReadError('CSV contains an unterminated quote.');
  finishRecord();
};

const detectCsvDelimiter = (bytes: Uint8Array, start: number): number => {
  const separator = readCsvSepDirective(bytes, start);
  if (separator !== undefined) return separator;
  let selectedCounts: Map<number, number> | undefined;
  scanCsvRecords(bytes, start, record => {
    if (CSV_DELIMITERS.some(delimiter => (record.delimiterCounts.get(delimiter) ?? 0) > 0)) {
      selectedCounts = record.delimiterCounts;
      return true;
    }
    return false;
  });
  const counts = selectedCounts ?? new Map<number, number>();
  return CSV_DELIMITERS.reduce((best, delimiter) => (
    (counts.get(delimiter) ?? 0) > (counts.get(best) ?? 0) ? delimiter : best
  ), CSV_DELIMITERS[0]);
};

export const preflightCsvBytes = (bytes: Uint8Array): string => {
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const delimiter = detectCsvDelimiter(bytes, start);
  const sepDirective = readCsvSepDirective(bytes, start);
  let firstRecord = true;
  let rows = 0;
  let cells = 0;
  scanCsvRecords(bytes, start, record => {
    if (firstRecord) {
      firstRecord = false;
      if (sepDirective !== undefined) return false;
    }
    const columns = 1 + (record.delimiterCounts.get(delimiter) ?? 0);
    if (!record.hasContent && columns === 1) return false;
    rows += 1;
    cells += columns;
    if (rows > MAX_SPREADSHEET_ROWS) throw new SpreadsheetReadError('CSV exceeds row bounds.');
    if (columns > MAX_SPREADSHEET_COLUMNS) throw new SpreadsheetReadError('CSV exceeds column bounds.');
    if (cells > MAX_SPREADSHEET_CELLS) throw new SpreadsheetReadError('CSV exceeds cell bounds.');
    return false;
  }, delimiter);
  return String.fromCharCode(delimiter);
};

type SpreadsheetFormat = 'csv' | 'xls' | 'xlsx';

const formatForFile = (file: File): SpreadsheetFormat => {
  const match = /^.+\.(csv|xls|xlsx)$/i.exec(file.name);
  if (!match) throw new SpreadsheetReadError('Unsupported spreadsheet file type.');
  return match[1].toLowerCase() as SpreadsheetFormat;
};

const validateMagic = (bytes: Uint8Array, format: SpreadsheetFormat): void => {
  const content = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
    ? bytes.subarray(3)
    : bytes;
  const isZip = content[0] === 0x50
    && content[1] === 0x4b
    && ((content[2] === 0x03 && content[3] === 0x04)
      || (content[2] === 0x05 && content[3] === 0x06)
      || (content[2] === 0x07 && content[3] === 0x08));
  const isCfb = containsMagic(content, CFB_MAGIC);
  if (isZip && format !== 'xlsx') throw new SpreadsheetReadError('ZIP content requires an .xlsx extension.');
  if (isCfb && format !== 'xls') throw new SpreadsheetReadError('CFB content requires an .xls extension.');
  if (!isZip && !isCfb && format !== 'csv') {
    throw new SpreadsheetReadError('Spreadsheet content does not match its extension.');
  }
  if (format === 'csv' && (isZip || isCfb)) {
    throw new SpreadsheetReadError('CSV content cannot be a ZIP or CFB workbook.');
  }
  if (format === 'xls' && !isCfb) throw new SpreadsheetReadError('XLS content is not a CFB workbook.');
  if (format === 'xlsx' && !isZip) throw new SpreadsheetReadError('XLSX content is not a ZIP workbook.');
};

const validateCellBounds = (matrix: unknown[][]): void => {
  let cells = 0;
  for (const row of matrix) {
    if (row.length > MAX_SPREADSHEET_COLUMNS) {
      throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_COLUMNS} columns.`);
    }
    cells += row.length;
    if (cells > MAX_SPREADSHEET_CELLS) {
      throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_CELLS} cells.`);
    }
    for (const cell of row) {
      if (typeof cell === 'string' && cell.length > MAX_SPREADSHEET_CELL_STRING_LENGTH) {
        throw new SpreadsheetReadError(`Spreadsheet cell exceeds ${MAX_SPREADSHEET_CELL_STRING_LENGTH} characters.`);
      }
    }
  }
};

const matrixToWorkbook = (matrix: unknown[][]): SpreadsheetWorkbook => {
  const headers = matrix[0] ?? [];
  const usedHeaders = new Set<string>();
  const keys = headers.map(header => {
    const base = header === '' || header === null || header === undefined ? '__EMPTY' : String(header);
    let key = base;
    let suffix = 0;
    while (usedHeaders.has(key)) {
      suffix += 1;
      key = `${base}_${suffix}`;
    }
    usedHeaders.add(key);
    return key;
  });
  const structuredRows = matrix.slice(1).map(row => Object.fromEntries(
    keys.flatMap((key, index) => row[index] === undefined || row[index] === '' ? [] : [[key, row[index]]]),
  ));
  return { structuredRows, flatRows: matrix };
};

const LEGACY_WORKER_TIMEOUT_MS = 5_000;

const workerMatrix = (value: unknown): unknown[][] => {
  if (!value || typeof value !== 'object') throw new SpreadsheetReadError('Legacy spreadsheet parser rejected the file.');
  const response = value as { ok?: unknown; matrix?: unknown };
  if (response.ok !== true || !Array.isArray(response.matrix) || response.matrix.some(row => !Array.isArray(row))) {
    throw new SpreadsheetReadError('Legacy spreadsheet parser rejected the file.');
  }
  return response.matrix as unknown[][];
};

const parseLegacyWorkbookInBrowserWorker = (bytes: Uint8Array): Promise<unknown[][]> => new Promise((resolve, reject) => {
  const worker = new Worker(new URL('./spreadsheetParser.worker.mjs', import.meta.url), { type: 'module' });
  let settled = false;
  const finish = (callback: () => void): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    worker.terminate();
    callback();
  };
  const timeout = setTimeout(() => finish(() => reject(new SpreadsheetReadError('Legacy spreadsheet parser timed out.'))), LEGACY_WORKER_TIMEOUT_MS);
  worker.onmessage = event => finish(() => {
    try {
      resolve(workerMatrix(event.data));
    } catch (error) {
      reject(error);
    }
  });
  worker.onerror = () => finish(() => reject(new SpreadsheetReadError('Legacy spreadsheet parser failed.')));
  worker.onmessageerror = () => finish(() => reject(new SpreadsheetReadError('Legacy spreadsheet parser failed.')));
  worker.postMessage({ bytes: bytes.buffer }, [bytes.buffer as ArrayBuffer]);
});

const parseLegacyWorkbookInNodeWorker = async (bytes: Uint8Array): Promise<unknown[][]> => {
  let NodeWorker: typeof import('node:worker_threads').Worker;
  try {
    const nodeWorkerThreads = 'node:' + 'worker_threads';
    const nodeWorkerModule = await import(nodeWorkerThreads) as typeof import('node:worker_threads');
    ({ Worker: NodeWorker } = nodeWorkerModule);
  } catch {
    throw new SpreadsheetReadError('Legacy spreadsheet isolation is unavailable.');
  }
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(new URL('./spreadsheetParser.worker.mjs', import.meta.url));
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate();
      callback();
    };
    const timeout = setTimeout(() => finish(() => reject(new SpreadsheetReadError('Legacy spreadsheet parser timed out.'))), LEGACY_WORKER_TIMEOUT_MS);
    worker.on('message', value => finish(() => {
      try {
        resolve(workerMatrix(value));
      } catch (error) {
        reject(error);
      }
    }));
    worker.on('error', () => finish(() => reject(new SpreadsheetReadError('Legacy spreadsheet parser failed.'))));
    worker.on('messageerror', () => finish(() => reject(new SpreadsheetReadError('Legacy spreadsheet parser failed.'))));
    worker.postMessage({ bytes: bytes.buffer }, [bytes.buffer as ArrayBuffer]);
  });
};

const parseLegacyWorkbook = async (bytes: Uint8Array): Promise<unknown[][]> => {
  if (typeof globalThis.Worker === 'function') return parseLegacyWorkbookInBrowserWorker(bytes);
  if (typeof process !== 'undefined' && process.versions?.node) return parseLegacyWorkbookInNodeWorker(bytes);
  throw new SpreadsheetReadError('Legacy spreadsheet isolation is unavailable.');
};

const parseWorkbook = async (bytes: Uint8Array, format: SpreadsheetFormat): Promise<SpreadsheetWorkbook> => {
  if (format === 'xlsx') await preflightZipArchive(bytes);
  if (format === 'xls') {
    const matrix = await parseLegacyWorkbook(bytes);
    if (matrix.length > MAX_SPREADSHEET_ROWS) {
      throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_ROWS - 1} data rows.`);
    }
    validateCellBounds(matrix);
    return matrixToWorkbook(matrix);
  }
  const csvDelimiter = format === 'csv' ? preflightCsvBytes(bytes) : undefined;
  let XLSX: typeof import('@e965/xlsx');
  try {
    XLSX = await import('@e965/xlsx');
  } catch {
    throw new SpreadsheetReadError('Spreadsheet parser is unavailable.');
  }
  let workbook: ReturnType<typeof XLSX.read>;
  try {
    workbook = XLSX.read(bytes, {
      type: 'array',
      dense: true,
      sheets: 0,
      sheetRows: MAX_SPREADSHEET_ROWS + 1,
      ...(csvDelimiter ? { FS: csvDelimiter } : {}),
    });
  } catch {
    throw new SpreadsheetReadError('Spreadsheet parser rejected the file.');
  }
  const sheetNames = workbook.SheetNames;
  if (sheetNames.length === 0 || sheetNames.length > MAX_SPREADSHEET_SHEETS) {
    throw new SpreadsheetReadError(`Spreadsheet must contain 1-${MAX_SPREADSHEET_SHEETS} sheets.`);
  }
  const sheet = workbook.Sheets[sheetNames[0]];
  const reference = sheet?.['!ref'];
  if (typeof reference !== 'string') throw new SpreadsheetReadError('Spreadsheet first sheet has no bounded range.');
  let range: ReturnType<typeof XLSX.utils.decode_range>;
  try {
    range = XLSX.utils.decode_range(reference);
  } catch {
    throw new SpreadsheetReadError('Spreadsheet first sheet has an invalid range.');
  }
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (rowCount > MAX_SPREADSHEET_ROWS) {
    throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_ROWS - 1} data rows.`);
  }
  if (columnCount > MAX_SPREADSHEET_COLUMNS) {
    throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_COLUMNS} columns.`);
  }
  if (rowCount * columnCount > MAX_SPREADSHEET_CELLS) {
    throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_CELLS} cells.`);
  }
  let matrix: unknown[][];
  try {
    matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    }) as unknown[][];
  } catch {
    throw new SpreadsheetReadError('Spreadsheet cells could not be converted.');
  }
  if (matrix.length > MAX_SPREADSHEET_ROWS) {
    throw new SpreadsheetReadError(`Spreadsheet exceeds ${MAX_SPREADSHEET_ROWS - 1} data rows.`);
  }
  validateCellBounds(matrix);
  return matrixToWorkbook(matrix);
};

export const loadSpreadsheetWorkbook = async (file: File): Promise<SpreadsheetWorkbook> => {
  const format = formatForFile(file);
  if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_SPREADSHEET_FILE_BYTES) {
    throw new SpreadsheetReadError(`Spreadsheet exceeds the ${MAX_SPREADSHEET_FILE_BYTES} byte file size limit.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new SpreadsheetReadError();
  }
  if (bytes.byteLength > MAX_SPREADSHEET_FILE_BYTES) {
    throw new SpreadsheetReadError(`Spreadsheet exceeds the ${MAX_SPREADSHEET_FILE_BYTES} byte file size limit.`);
  }
  validateMagic(bytes, format);
  if (format !== 'csv' || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    return parseWorkbook(bytes, format);
  }
  const utf8Bytes = new Uint8Array(bytes.byteLength + 3);
  utf8Bytes.set([0xef, 0xbb, 0xbf]);
  utf8Bytes.set(bytes, 3);
  return parseWorkbook(utf8Bytes, format);
};
