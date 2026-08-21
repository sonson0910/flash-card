import {
  SpreadsheetReadError,
  type SpreadsheetImportRequest,
} from '../importExport/spreadsheetImportService';

const MAX_XLSX_ARCHIVE_ENTRIES = 2_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
const MAX_XLSX_COMPRESSION_RATIO = 100;
const MAX_SHEET_ROWS = 5_001;
const MAX_SHEET_COLUMNS = 32;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const zipSafetyError = (): never => {
  throw new SpreadsheetReadError();
};

const findZipEndOfCentralDirectory = (view: DataView): number => {
  for (let offset = view.byteLength - 22; offset >= Math.max(0, view.byteLength - 65_557); offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) return offset;
  }
  return -1;
};

export const assertSafeSpreadsheetArchive = (data: ArrayBuffer): void => {
  const view = new DataView(data);
  const isZip = view.byteLength >= 4 && view.getUint16(0, true) === 0x4b50;
  const endOfDirectory = findZipEndOfCentralDirectory(view);
  if (endOfDirectory < 0) {
    if (isZip) zipSafetyError();
    return;
  }
  const entryCount = view.getUint16(endOfDirectory + 10, true);
  const directorySize = view.getUint32(endOfDirectory + 12, true);
  const directoryOffset = view.getUint32(endOfDirectory + 16, true);
  if (
    entryCount === 0xffff
    || directorySize === 0xffffffff
    || directoryOffset === 0xffffffff
    || entryCount > MAX_XLSX_ARCHIVE_ENTRIES
    || directoryOffset + directorySize > endOfDirectory
  ) zipSafetyError();

  let offset = directoryOffset;
  let totalUncompressedBytes = 0;
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (offset + 46 > endOfDirectory || view.getUint32(offset, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      zipSafetyError();
    }
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    totalUncompressedBytes += uncompressedSize;
    if (
      totalUncompressedBytes > MAX_XLSX_UNCOMPRESSED_BYTES
      || (compressedSize === 0 && uncompressedSize > 0)
      || (compressedSize > 0 && uncompressedSize > compressedSize * MAX_XLSX_COMPRESSION_RATIO)
    ) zipSafetyError();
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== directoryOffset + directorySize) zipSafetyError();
};

export const spreadsheetRequestFromFile = (file: File): SpreadsheetImportRequest => ({
  sizeBytes: file.size,
  loadWorkbook: async () => {
    let data: ArrayBuffer;
    try {
      data = await file.arrayBuffer();
    } catch {
      throw new SpreadsheetReadError();
    }
    assertSafeSpreadsheetArchive(data);
    const XLSX = await import('@e965/xlsx');
    const workbook = XLSX.read(data, { type: 'array', sheetRows: MAX_SHEET_ROWS });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!worksheet) return null;
    const range = worksheet['!ref'] ? XLSX.utils.decode_range(worksheet['!ref']) : null;
    if (range && range.e.c - range.s.c + 1 > MAX_SHEET_COLUMNS) throw new SpreadsheetReadError();
    return {
      structuredRows: XLSX.utils.sheet_to_json(worksheet) as unknown[],
      flatRows: XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][],
    };
  },
});
