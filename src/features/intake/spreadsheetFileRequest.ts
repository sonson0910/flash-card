import {
  SpreadsheetReadError,
  type SpreadsheetImportRequest,
} from '../importExport/spreadsheetImportService';

export const spreadsheetRequestFromFile = (file: File): SpreadsheetImportRequest => ({
  sizeBytes: file.size,
  loadWorkbook: async () => {
    const binary = await new Promise<string | null>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = event => resolve(typeof event.target?.result === 'string' ? event.target.result : null);
      reader.onerror = () => reject(new SpreadsheetReadError());
      reader.readAsBinaryString(file);
    });
    if (!binary) return null;
    const XLSX = await import('@e965/xlsx');
    const workbook = XLSX.read(binary, { type: 'binary' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    return {
      structuredRows: XLSX.utils.sheet_to_json(worksheet) as unknown[],
      flatRows: XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][],
    };
  },
});
