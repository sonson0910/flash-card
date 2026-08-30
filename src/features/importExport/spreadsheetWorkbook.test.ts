import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as XLSX from '@e965/xlsx';
import {
  loadSpreadsheetWorkbook,
  MAX_SPREADSHEET_CELLS,
  MAX_SPREADSHEET_COLUMNS,
  MAX_SPREADSHEET_FILE_BYTES,
  MAX_SPREADSHEET_ROWS,
  MAX_SPREADSHEET_SHEETS,
  MAX_SPREADSHEET_UNCOMPRESSED_BYTES,
  preflightCsvBytes,
  preflightZipArchive,
  preflightWorksheetXml,
  preflightSharedStringsXml,
  SpreadsheetReadError,
} from './spreadsheetWorkbook';

const textEncoder = new TextEncoder();

const writeU16 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer).setUint16(offset, value, true);
};

const writeU32 = (bytes: Uint8Array, offset: number, value: number): void => {
  new DataView(bytes.buffer).setUint32(offset, value, true);
};

const crc32 = (bytes: Uint8Array): number => {
  let value = 0xffffffff;
  for (const byte of bytes) {
    let table = value ^ byte;
    for (let bit = 0; bit < 8; bit += 1) table = (table >>> 1) ^ ((table & 1) === 1 ? 0xedb88320 : 0);
    value = table;
  }
  return (value ^ 0xffffffff) >>> 0;
};

const zipArchive = (options: {
  entryCount?: number;
  uncompressedSize?: number;
  diskNumber?: number;
  zip64?: boolean;
  method?: number;
  flags?: number;
  localCompressedSize?: number;
  localUncompressedSize?: number;
  centralExtra?: Uint8Array;
  localExtra?: Uint8Array;
} = {}): Uint8Array => {
  const entryCount = options.entryCount ?? 1;
  const uncompressedSize = options.uncompressedSize ?? 0;
  const names = Array.from({ length: entryCount }, (_, index) => textEncoder.encode(`entry-${index}.xml`));
  const localExtra = options.localExtra ?? new Uint8Array();
  const centralExtra = options.centralExtra ?? new Uint8Array();
  const localBytes = names.reduce((total, name) => total + 30 + name.length + localExtra.length, 0);
  const centralBytes = names.reduce((total, name) => total + 46 + name.length + centralExtra.length, 0);
  const centralOffset = localBytes;
  const eocdOffset = centralOffset + centralBytes;
  const bytes = new Uint8Array(eocdOffset + 22);
  let localOffset = 0;
  for (const name of names) {
    writeU32(bytes, localOffset, 0x04034b50);
    writeU16(bytes, localOffset + 6, options.flags ?? 0);
    writeU16(bytes, localOffset + 8, options.method ?? 0);
    writeU32(bytes, localOffset + 18, options.localCompressedSize ?? 0);
    writeU32(bytes, localOffset + 22, options.localUncompressedSize ?? 0);
    writeU16(bytes, localOffset + 26, name.length);
    writeU16(bytes, localOffset + 28, localExtra.length);
    bytes.set(name, localOffset + 30);
    bytes.set(localExtra, localOffset + 30 + name.length);
    localOffset += 30 + name.length + localExtra.length;
  }
  let centralCursor = centralOffset;
  let centralLocalOffset = 0;
  for (const name of names) {
    writeU32(bytes, centralCursor, 0x02014b50);
    writeU16(bytes, centralCursor + 4, 20);
    writeU16(bytes, centralCursor + 6, 20);
    writeU16(bytes, centralCursor + 8, options.flags ?? 0);
    writeU16(bytes, centralCursor + 10, options.method ?? 0);
    writeU32(bytes, centralCursor + 20, options.uncompressedSize ?? 0);
    writeU32(bytes, centralCursor + 24, options.zip64 ? 0xffffffff : uncompressedSize);
    writeU16(bytes, centralCursor + 28, name.length);
    writeU16(bytes, centralCursor + 30, centralExtra.length);
    writeU32(bytes, centralCursor + 42, centralLocalOffset);
    bytes.set(name, centralCursor + 46);
    bytes.set(centralExtra, centralCursor + 46 + name.length);
    centralCursor += 46 + name.length + centralExtra.length;
    centralLocalOffset += 30 + name.length;
  }
  writeU32(bytes, eocdOffset, 0x06054b50);
  writeU16(bytes, eocdOffset + 4, options.diskNumber ?? 0);
  writeU16(bytes, eocdOffset + 6, options.diskNumber ?? 0);
  writeU16(bytes, eocdOffset + 8, entryCount);
  writeU16(bytes, eocdOffset + 10, entryCount);
  writeU32(bytes, eocdOffset + 12, centralBytes);
  writeU32(bytes, eocdOffset + 16, centralOffset);
  return bytes;
};

const rawDeflate = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
};

const singleDeflateZip = async (
  data: Uint8Array,
  declaredSize = data.byteLength,
  entryName = 'xl/worksheets/sheet1.xml',
): Promise<Uint8Array> => {
  const compressed = await rawDeflate(data);
  const name = textEncoder.encode(entryName);
  const localOffset = 0;
  const centralOffset = 30 + name.length + compressed.length;
  const eocdOffset = centralOffset + 46 + name.length;
  const bytes = new Uint8Array(eocdOffset + 22);
  writeU32(bytes, localOffset, 0x04034b50);
  writeU16(bytes, localOffset + 6, 0x0800);
  writeU16(bytes, localOffset + 8, 8);
  writeU32(bytes, localOffset + 14, crc32(data));
  writeU32(bytes, localOffset + 18, compressed.length);
  writeU32(bytes, localOffset + 22, declaredSize);
  writeU16(bytes, localOffset + 26, name.length);
  bytes.set(name, localOffset + 30);
  bytes.set(compressed, localOffset + 30 + name.length);
  writeU32(bytes, centralOffset, 0x02014b50);
  writeU16(bytes, centralOffset + 6, 20);
  writeU16(bytes, centralOffset + 8, 0x0800);
  writeU16(bytes, centralOffset + 10, 8);
  writeU32(bytes, centralOffset + 16, crc32(data));
  writeU32(bytes, centralOffset + 20, compressed.length);
  writeU32(bytes, centralOffset + 24, declaredSize);
  writeU16(bytes, centralOffset + 28, name.length);
  writeU32(bytes, centralOffset + 42, localOffset);
  bytes.set(name, centralOffset + 46);
  writeU32(bytes, eocdOffset, 0x06054b50);
  writeU16(bytes, eocdOffset + 8, 1);
  writeU16(bytes, eocdOffset + 10, 1);
  writeU32(bytes, eocdOffset + 12, 46 + name.length);
  writeU32(bytes, eocdOffset + 16, centralOffset);
  return bytes;
};

const storedZip = (entries: Record<string, string | Uint8Array>): Uint8Array => {
  const records = Object.entries(entries).map(([name, content]) => ({
    name: textEncoder.encode(name),
    data: typeof content === 'string' ? textEncoder.encode(content) : content,
  }));
  const localBytes = records.reduce((total, entry) => total + 30 + entry.name.length + entry.data.length, 0);
  const centralBytes = records.reduce((total, entry) => total + 46 + entry.name.length, 0);
  const centralOffset = localBytes;
  const eocdOffset = centralOffset + centralBytes;
  const bytes = new Uint8Array(eocdOffset + 22);
  let localOffset = 0;
  for (const entry of records) {
    writeU32(bytes, localOffset, 0x04034b50);
    writeU32(bytes, localOffset + 14, crc32(entry.data));
    writeU32(bytes, localOffset + 18, entry.data.length);
    writeU32(bytes, localOffset + 22, entry.data.length);
    writeU16(bytes, localOffset + 26, entry.name.length);
    bytes.set(entry.name, localOffset + 30);
    bytes.set(entry.data, localOffset + 30 + entry.name.length);
    localOffset += 30 + entry.name.length + entry.data.length;
  }
  let centralCursor = centralOffset;
  localOffset = 0;
  for (const entry of records) {
    writeU32(bytes, centralCursor, 0x02014b50);
    writeU16(bytes, centralCursor + 4, 20);
    writeU16(bytes, centralCursor + 6, 20);
    writeU32(bytes, centralCursor + 16, crc32(entry.data));
    writeU32(bytes, centralCursor + 20, entry.data.length);
    writeU32(bytes, centralCursor + 24, entry.data.length);
    writeU16(bytes, centralCursor + 28, entry.name.length);
    writeU32(bytes, centralCursor + 42, localOffset);
    bytes.set(entry.name, centralCursor + 46);
    centralCursor += 46 + entry.name.length;
    localOffset += 30 + entry.name.length + entry.data.length;
  }
  writeU32(bytes, eocdOffset, 0x06054b50);
  writeU16(bytes, eocdOffset + 8, records.length);
  writeU16(bytes, eocdOffset + 10, records.length);
  writeU32(bytes, eocdOffset + 12, centralBytes);
  writeU32(bytes, eocdOffset + 16, centralOffset);
  return bytes;
};

const minimalOoxmlPackage = (worksheetPath = 'worksheets/sheet1.xml', worksheetXml = '<worksheet/>') => ({
  '[Content_Types].xml': `<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/${worksheetPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
  'xl/workbook.xml': '<workbook><sheets><sheet name="Cards" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${worksheetPath}"/></Relationships>`,
  [`xl/${worksheetPath}`]: worksheetXml,
});

const csvFile = (content: string, name = 'cards.csv', type = 'text/csv'): File => (
  new File([textEncoder.encode(content)], name, { type })
);

describe('spreadsheet workbook loader', () => {
  it('rejects ZIP archives with too many entries, excessive expansion, ZIP64, or multiple disks', async () => {
    await expect(preflightZipArchive(zipArchive({ entryCount: 5_001 }))).rejects.toThrow(SpreadsheetReadError);
    await expect(preflightZipArchive(zipArchive({
      uncompressedSize: MAX_SPREADSHEET_UNCOMPRESSED_BYTES + 1,
      method: 8,
    }))).rejects.toThrow(/uncompressed/i);
    await expect(preflightZipArchive(zipArchive({ zip64: true }))).rejects.toThrow(/ZIP64/i);
    await expect(preflightZipArchive(zipArchive({ diskNumber: 1 }))).rejects.toThrow(/disk/i);
  });

  it('rejects truncated ZIP metadata before invoking the workbook parser', async () => {
    await expect(preflightZipArchive(zipArchive().slice(0, -1))).rejects.toThrow(SpreadsheetReadError);
  });

  it('fails closed when native deflate decompression is unavailable', async () => {
    const original = globalThis.DecompressionStream;
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      await expect(preflightZipArchive(zipArchive())).rejects.toThrow(/decompression/i);
    } finally {
      vi.stubGlobal('DecompressionStream', original);
    }
  });

  it('rejects ZIP metadata smuggling, descriptors, ZIP64 extras, and overlapping regions', async () => {
    await expect(preflightZipArchive(zipArchive({
      method: 8,
      localCompressedSize: 1024 * 1024,
    }))).rejects.toThrow(/metadata|size|truncated/i);
    await expect(preflightZipArchive(zipArchive({ flags: 0x0008 }))).rejects.toThrow(/flag|descriptor/i);
    await expect(preflightZipArchive(zipArchive({
      centralExtra: new Uint8Array([1, 0, 4, 0, 0, 0, 0, 0]),
    }))).rejects.toThrow(/ZIP64/i);
    await expect(preflightZipArchive(zipArchive({
      localExtra: new Uint8Array([1, 0, 4, 0, 0, 0, 0, 0]),
    }))).rejects.toThrow(/ZIP64/i);
    const overlapping = zipArchive({ entryCount: 2 });
    const centralOffset = (30 + 'entry-0.xml'.length) * 2;
    const secondCentralOffset = centralOffset + 46 + 'entry-0.xml'.length;
    writeU32(overlapping, secondCentralOffset + 42, 0);
    overlapping.set(textEncoder.encode('entry-0.xml'), secondCentralOffset + 46);
    await expect(preflightZipArchive(overlapping)).rejects.toThrow(/unique|overlap|truncated/i);
  });

  it('rejects deflate size mismatches and caps actual output without a large fixture', async () => {
    const content = textEncoder.encode('small worksheet content');
    await expect(preflightZipArchive(await singleDeflateZip(content, content.length + 1)))
      .rejects.toThrow(/size/i);

    const original = globalThis.DecompressionStream;
    class RepeatingBomb {
      readable = new ReadableStream<Uint8Array>({
        start(controller) {
          const chunk = new Uint8Array(65_536);
          for (let index = 0; index < Math.ceil((MAX_SPREADSHEET_UNCOMPRESSED_BYTES + 1) / chunk.length); index += 1) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      });

      writable = new WritableStream<Uint8Array>();
    }
    vi.stubGlobal('DecompressionStream', RepeatingBomb);
    try {
      await expect(preflightZipArchive(await singleDeflateZip(content, content.length, 'entry.bin')))
        .rejects.toThrow(/uncompressed/i);
    } finally {
      vi.stubGlobal('DecompressionStream', original);
    }
  });

  it('loads CSV through one bounded matrix and derives structured rows', async () => {
    const file = csvFile('Word,Translation\napple,táo\n', 'cards.csv', 'text/plain');
    const read = vi.spyOn(file, 'arrayBuffer');
    const workbook = await loadSpreadsheetWorkbook(file);
    expect(read).toHaveBeenCalledOnce();
    expect(workbook).toMatchObject({
      structuredRows: [{ Word: 'apple', Translation: 'táo' }],
      flatRows: [['Word', 'Translation'], ['apple', 'táo']],
    });
  });

  it('does not mistake CSV text beginning with PK for a ZIP archive', async () => {
    await expect(loadSpreadsheetWorkbook(csvFile('PK,Translation\napple,táo\n')))
      .resolves.toMatchObject({ structuredRows: [{ PK: 'apple', Translation: 'táo' }] });
  });

  it('accepts real XLS and rejects renamed XLSX/CFB content', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Word', 'Translation'],
      ['apple', 'táo'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Cards');
    const xlsBytes = XLSX.write(workbook, { type: 'array', bookType: 'xls' });
    await expect(loadSpreadsheetWorkbook(new File([xlsBytes], 'cards.xls', { type: 'text/plain' })))
      .resolves.toMatchObject({ structuredRows: [{ Word: 'apple', Translation: 'táo' }] });

    const xlsxBytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    await expect(loadSpreadsheetWorkbook(new File([xlsxBytes], 'cards.xls', { type: 'application/octet-stream' })))
      .rejects.toThrow(/extension|magic|format/i);
    await expect(loadSpreadsheetWorkbook(new File([xlsBytes], 'cards.xlsx', { type: '' })))
      .rejects.toThrow(/extension|magic|format/i);
    await expect(loadSpreadsheetWorkbook(new File([zipArchive()], 'cards.csv', { type: 'text/plain' })))
      .rejects.toThrow(/ZIP|CSV|format/i);
    await expect(loadSpreadsheetWorkbook(new File([
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ], 'cards.csv', { type: 'text/plain' }))).rejects.toThrow(/CFB|CSV|format/i);
  });

  it('keeps legacy XLS parsing off the caller thread', async () => {
    const source = readFileSync(fileURLToPath(new URL('./spreadsheetWorkbook.ts', import.meta.url)), 'utf8');
    expect(source).toMatch(/parseLegacyWorkbook|spreadsheetParser\.worker/);
    expect(source).toMatch(/LEGACY_WORKER_TIMEOUT_MS/);
    expect(source).toMatch(/worker\.terminate\(\)/);
  });

  it('loads a small XLSX workbook with dense array parsing', async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Word', 'Translation'],
      ['apple', 'táo'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Cards');
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true });
    await expect(loadSpreadsheetWorkbook(new File(
      [bytes],
      'cards.xlsx',
      { type: 'text/plain' },
    ))).resolves.toMatchObject({
      structuredRows: [{ Word: 'apple', Translation: 'táo' }],
      flatRows: [['Word', 'Translation'], ['apple', 'táo']],
    });
  });

  it('rejects workbooks with too many sheets', async () => {
    const workbook = XLSX.utils.book_new();
    for (let index = 0; index < 33; index += 1) {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Word'], ['apple']]), `S${index}`);
    }
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    await expect(loadSpreadsheetWorkbook(new File([bytes], 'many-sheets.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }))).rejects.toThrow(/sheets/i);
  });

  it('rejects excessive OOXML workbook sheet metadata during ZIP preflight', async () => {
    const sheetCount = MAX_SPREADSHEET_SHEETS + 1;
    const sheets = Array.from({ length: sheetCount }, (_, index) =>
      `<sheet name="S${index}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    ).join('');
    const relationships = Array.from({ length: sheetCount }, (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    ).join('');
    const contentTypes = Array.from({ length: sheetCount }, (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ).join('');
    const packageEntries = {
      '[Content_Types].xml': `<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${contentTypes}</Types>`,
      'xl/workbook.xml': `<workbook><sheets>${sheets}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships>${relationships}</Relationships>`,
      ...Object.fromEntries(Array.from({ length: sheetCount }, (_, index) =>
        [`xl/worksheets/sheet${index + 1}.xml`, '<worksheet/>'],
      )),
    };
    await expect(preflightZipArchive(storedZip(packageEntries))).rejects.toThrow(/sheet/i);
  });

  it('rejects files beyond the shared byte limit and worksheet shape limits', async () => {
    const oversized = new File([new Uint8Array(MAX_SPREADSHEET_FILE_BYTES + 1)], 'cards.csv', { type: 'text/csv' });
    await expect(loadSpreadsheetWorkbook(oversized)).rejects.toThrow(/file size/i);

    const tooManyRows = `${['Word', 'Translation'].join(',')}\n${Array.from(
      { length: 5_001 }, (_, index) => `word-${index},translation`,
    ).join('\n')}`;
    await expect(loadSpreadsheetWorkbook(csvFile(tooManyRows))).rejects.toThrow(/row/i);

    const tooManyColumns = `${Array.from({ length: 65 }, (_, index) => `c${index}`).join(',')}\n${'x,'.repeat(64)}x`;
    await expect(loadSpreadsheetWorkbook(csvFile(tooManyColumns))).rejects.toThrow(/column/i);

    const tooManyCells = Array.from(
      { length: 4_001 },
      () => Array.from({ length: 51 }, () => 'x').join(','),
    ).join('\n');
    await expect(loadSpreadsheetWorkbook(csvFile(tooManyCells))).rejects.toThrow(/cell/i);
  });

  it('pre-scans quoted CSV bounds before invoking XLSX', () => {
    const tooManyColumns = textEncoder.encode(`${Array.from({ length: 65 }, () => 'x').join('\t')}\n`);
    expect(() => preflightCsvBytes(tooManyColumns)).toThrow(/column/i);
    const tooManyRows = textEncoder.encode(`${'x\n'.repeat(5_002)}`);
    expect(() => preflightCsvBytes(tooManyRows)).toThrow(/row/i);
    expect(() => preflightCsvBytes(textEncoder.encode('Word,Translation\n"hello, world",ok\n'))).not.toThrow();
  });

  it('uses one bounded delimiter for early CSV rows and passes it to the parser', async () => {
    const tabbed = textEncoder.encode(`header\n${Array.from({ length: 65 }, () => 'x').join('\t')}\n`);
    expect(() => preflightCsvBytes(tabbed)).toThrow(/column/i);
    const semicolon = textEncoder.encode('Word;Translation\napple;táo\n');
    expect(preflightCsvBytes(semicolon)).toBe(';');
    expect(await loadSpreadsheetWorkbook(csvFile('Word\tTranslation\napple\ttáo\n')))
      .toMatchObject({ structuredRows: [{ Word: 'apple', Translation: 'táo' }] });
    expect(await loadSpreadsheetWorkbook(csvFile('Word;Translation\napple;táo\n')))
      .toMatchObject({ structuredRows: [{ Word: 'apple', Translation: 'táo' }] });
  });

  it('keeps comma semantics when a value contains more semicolons than the CSV has commas', async () => {
    await expect(loadSpreadsheetWorkbook(csvFile('Word,Translation\nhello,a;b;c;d;e\n')))
      .resolves.toMatchObject({
        flatRows: [['Word', 'Translation'], ['hello', 'a;b;c;d;e']],
        structuredRows: [{ Word: 'hello', Translation: 'a;b;c;d;e' }],
      });
  });

  it('detects tabs after a long single-column logical record', async () => {
    const firstRecord = 'x'.repeat(1_025);
    const bytes = textEncoder.encode(`${firstRecord}\nWord\tTranslation\nhello\ttáo\n`);
    expect(preflightCsvBytes(bytes)).toBe('\t');
    const workbook = await loadSpreadsheetWorkbook(csvFile(
      `${firstRecord}\nWord\tTranslation\nhello\ttáo\n`,
    ));
    expect(workbook.flatRows[0]?.[0]).toBe(firstRecord);
    expect(workbook.flatRows.slice(1)).toEqual([['Word', 'Translation'], ['hello', 'táo']]);
  });

  it('does not count the sep directive as a worksheet row', async () => {
    const content = [
      'sep=;',
      'Word;Translation',
      ...Array.from({ length: 5_000 }, (_, index) => `word-${index};translation`),
    ].join('\n');
    const workbook = await loadSpreadsheetWorkbook(csvFile(`${content}\n`));
    expect(workbook.flatRows).toHaveLength(5_001);
    expect(workbook.structuredRows).toHaveLength(5_000);
  });

  it('matches strict lowercase sep directive semantics', async () => {
    const uppercase = await loadSpreadsheetWorkbook(csvFile('SEP=;\nWord;Translation\napple;táo\n'));
    expect(uppercase.flatRows).toHaveLength(3);
    expect(uppercase.flatRows[0]?.[0]).toBe('SEP=');
    await expect(loadSpreadsheetWorkbook(csvFile('sep=;malformed\nWord,Translation\napple,táo\n')))
      .rejects.toThrow(/sep|directive/i);
  });

  it('matches SheetJS field-start quote handling for CSV bounds', () => {
    expect(preflightCsvBytes(textEncoder.encode('sep=;\rWord;Translation\rapple;táo\r'))).toBe(';');
    const wideInternalQuote = `Word,Translation\nx"${',x'.repeat(MAX_SPREADSHEET_COLUMNS)}"\n`;
    expect(() => preflightCsvBytes(textEncoder.encode(wideInternalQuote))).toThrow(/column/i);

    const semicolonBeforeQuote = `Word,Translation\nx;"${',x'.repeat(MAX_SPREADSHEET_COLUMNS)}"\n`;
    expect(() => preflightCsvBytes(textEncoder.encode(semicolonBeforeQuote))).toThrow(/column/i);

    const quoteStateReopened = `Word,Translation\n"a"b"${',x'.repeat(MAX_SPREADSHEET_COLUMNS)}"\n`;
    expect(() => preflightCsvBytes(textEncoder.encode(quoteStateReopened))).not.toThrow();

    const rowsHiddenByInternalQuote = `Word,Translation\nx"\n${'x\n'.repeat(MAX_SPREADSHEET_ROWS)}"\n`;
    expect(() => preflightCsvBytes(textEncoder.encode(rowsHiddenByInternalQuote))).toThrow(/row/i);
  });

  it('preflights worksheet XML dimensions and cell references', () => {
    const xml = (body: string) => textEncoder.encode(`<worksheet><dimension ref="A1:${body}"/><sheetData></sheetData></worksheet>`);
    expect(() => preflightWorksheetXml(xml('BM5002'))).toThrow(/row|column/i);
    expect(() => preflightWorksheetXml(textEncoder.encode('<worksheet><sheetData><c r="A1"/><c r="BM2"/></sheetData></worksheet>')))
      .toThrow(/column|cell/i);
    expect(() => preflightWorksheetXml(textEncoder.encode(
      '<x:worksheet xmlns:x="urn:test"><x:dimension ref="A1:BM2"/><x:sheetData/></x:worksheet>',
    ))).toThrow(/column/i);
    expect(() => preflightWorksheetXml(textEncoder.encode(
      `<x:worksheet><x:sheetData><x:c r="A1" t="inlineStr"><x:is><x:t>${'x'.repeat(4_097)}</x:t></x:is></x:c></x:sheetData></x:worksheet>`,
    ))).toThrow(/cell|string/i);
  });

  it('bounds implicit OOXML rows/cells and decoded CDATA/string-result text', () => {
    const tooManyImplicitRows = `<worksheet><sheetData>${'<row><c/></row>'.repeat(MAX_SPREADSHEET_ROWS + 1)}</sheetData></worksheet>`;
    expect(() => preflightWorksheetXml(textEncoder.encode(tooManyImplicitRows))).toThrow(/row/i);

    const tooManyImplicitColumns = `<worksheet><sheetData><row>${'<c/>'.repeat(MAX_SPREADSHEET_COLUMNS + 1)}</row></sheetData></worksheet>`;
    expect(() => preflightWorksheetXml(textEncoder.encode(tooManyImplicitColumns))).toThrow(/column|cell/i);

    const longStringResult = `<worksheet><sheetData><row><c t="str"><v><![CDATA[${'x'.repeat(4_097)}]]></v></c></row></sheetData></worksheet>`;
    expect(() => preflightWorksheetXml(textEncoder.encode(longStringResult))).toThrow(/text|string|value/i);
  });

  it('preflights shared strings count and aggregate text length', () => {
    expect(() => preflightSharedStringsXml(textEncoder.encode(
      `<x:sst><x:si><x:r><x:t>a</x:t></x:r><x:r><x:t>${'x'.repeat(4_096)}</x:t></x:r></x:si></x:sst>`,
    ))).toThrow(/string/i);
    expect(() => preflightSharedStringsXml(textEncoder.encode(
      `<sst>${'<si><t>x</t></si>'.repeat(MAX_SPREADSHEET_CELLS + 1)}</sst>`,
    ))).toThrow(/shared|cell|string/i);
  });

  it('requires an OOXML package and validates custom worksheet relationships', async () => {
    await expect(loadSpreadsheetWorkbook(new File([
      storedZip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet' }),
    ], 'not-xlsx.xlsx', { type: 'application/zip' }))).rejects.toThrow(/OOXML|package|content/i);
    const custom = minimalOoxmlPackage(
      'custom/sheet.xml',
      '<x:worksheet xmlns:x="urn:test"><x:dimension ref="A1:BM2"/><x:sheetData/></x:worksheet>',
    );
    await expect(loadSpreadsheetWorkbook(new File([storedZip(custom)], 'custom.xlsx', { type: 'text/plain' })))
      .rejects.toThrow(/column/i);
    const sharedStrings = {
      ...minimalOoxmlPackage(),
      'xl/sharedStrings.xml': `<x:sst><x:si><x:t>${'x'.repeat(4_097)}</x:t></x:si></x:sst>`,
    };
    await expect(loadSpreadsheetWorkbook(new File([storedZip(sharedStrings)], 'shared.xlsx')))
      .rejects.toThrow(/Shared string|string/i);
    await expect(loadSpreadsheetWorkbook(new File([storedZip({ 'xl/../workbook.xml': 'bad' })], 'unsafe.xlsx')))
      .rejects.toThrow(/path|entry|traversal/i);
  });

  it('rejects case-insensitive ZIP part collisions before workbook parsing', async () => {
    await expect(preflightZipArchive(storedZip({
      ...minimalOoxmlPackage(),
      'XL/WORKBOOK.XML': '<workbook/>',
    }))).rejects.toThrow(/unique|case|entry/i);
    await expect(preflightZipArchive(storedZip({
      ...minimalOoxmlPackage(),
      'XL/WORKBOOK.BIN': 'hybrid marker',
    }))).rejects.toThrow(/OOXML|marker|package/i);
  });

  it('rejects case-insensitive alternate-parser hybrid markers before workbook parsing', async () => {
    for (const [name, content] of [
      ['META-INF/MANIFEST.XML', '<manifest/>'],
      ['OBJECTDATA.XML', '<objectdata/>'],
      ['INDEX/DOCUMENT.IWA', 'binary marker'],
    ] as const) {
      await expect(preflightZipArchive(storedZip({
        ...minimalOoxmlPackage(),
        [name]: content,
      }))).rejects.toThrow(/OOXML|marker|package/i);
    }
  });

  it('reproduces SheetJS duplicate and blank header semantics from one matrix', async () => {
    const workbook = await loadSpreadsheetWorkbook(csvFile('Word,Word,Translation,\na,b,c,d\n'));
    expect(workbook.structuredRows).toEqual([{ Word: 'a', Word_1: 'b', Translation: 'c', __EMPTY: 'd' }]);
  });

  it('rejects unsupported file types and overlong cell strings', async () => {
    await expect(loadSpreadsheetWorkbook(csvFile('Word\napple', 'cards.txt', 'text/plain')))
      .rejects.toThrow(/file type/i);
    await expect(loadSpreadsheetWorkbook(csvFile(`Word\n${'x'.repeat(4_097)}`)))
      .rejects.toThrow(/cell/i);
  });

  it('keeps spreadsheet intake on the central loader with no direct XLSX parsing', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../intake/spreadsheetFileRequest.ts', import.meta.url)),
      'utf8',
    );
    expect(source).toMatch(/loadSpreadsheetWorkbook/);
    expect(source).not.toMatch(/@e965\/xlsx|XLSX\.read|sheet_to_json/);
    const loaderSource = readFileSync(fileURLToPath(new URL('./spreadsheetWorkbook.ts', import.meta.url)), 'utf8');
    expect(loaderSource.match(/sheet_to_json/g)).toHaveLength(1);
    expect(loaderSource).toMatch(/sheets:\s*0/);
  });
});
