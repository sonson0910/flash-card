import * as XLSX from '@e965/xlsx';

const MAX_ROWS = 5_001;
const MAX_COLUMNS = 64;
const MAX_CELLS = 200_000;
const MAX_CELL_STRING_LENGTH = 4_096;
const MAX_SHEETS = 32;

const parseLegacyWorkbook = async (bytes) => {
  const workbook = XLSX.read(bytes, {
    type: 'array',
    dense: true,
    sheets: 0,
    sheetRows: MAX_ROWS + 1,
  });
  if (workbook.SheetNames.length === 0 || workbook.SheetNames.length > MAX_SHEETS) {
    throw new Error('sheet limit');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const reference = sheet?.['!ref'];
  if (typeof reference !== 'string') throw new Error('range');
  const range = XLSX.utils.decode_range(reference);
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (rowCount > MAX_ROWS || columnCount > MAX_COLUMNS || rowCount * columnCount > MAX_CELLS) {
    throw new Error('shape limit');
  }
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: '',
    blankrows: false,
  });
  if (matrix.length > MAX_ROWS) throw new Error('row limit');
  let cells = 0;
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length > MAX_COLUMNS) throw new Error('column limit');
    cells += row.length;
    if (cells > MAX_CELLS) throw new Error('cell limit');
    if (row.some(cell => typeof cell === 'string' && cell.length > MAX_CELL_STRING_LENGTH)) {
      throw new Error('string limit');
    }
  }
  return matrix;
};

const handleMessage = async (data, reply) => {
  try {
    const matrix = await parseLegacyWorkbook(new Uint8Array(data.bytes));
    reply({ ok: true, matrix });
  } catch {
    reply({ ok: false });
  }
};

const setupNodeWorker = async () => {
  const nodeWorkerThreads = 'node:' + 'worker_threads';
  const { parentPort } = await import(nodeWorkerThreads);
  parentPort?.on('message', data => {
    void handleMessage(data, result => parentPort.postMessage(result));
  });
};

if (typeof process !== 'undefined' && process.versions?.node) {
  void setupNodeWorker();
} else if (typeof self !== 'undefined') {
  self.onmessage = event => {
    void handleMessage(event.data, result => self.postMessage(result));
  };
}
