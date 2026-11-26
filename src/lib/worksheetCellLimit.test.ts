import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { readStatementWorkbook } from './importer';

vi.mock('./importLimits', () => ({ MAX_XLSX_CELLS: 4 }));

function workbookWithFooter(footer: string, ...sheets: string[]): ArrayBuffer {
  const files = Object.fromEntries(sheets.map((body, i) => [
    `xl/worksheets/sheet${i + 1}.xml`,
    strToU8(`<worksheet xmlns:x="urn:sheet"><sheetData>${body}</sheetData>${footer}</worksheet>`),
  ]));
  return Uint8Array.from(zipSync(files)).buffer;
}

const workbook = (...sheets: string[]) => workbookWithFooter('', ...sheets);

const tooMany = 'Terlalu banyak sel dalam file XLSX. Pilih periode mutasi yang lebih singkat.';

describe.each([false, true])('worksheet cell limit with preserveNumericText=%s', preserve => {
  it('accepts exactly the budget, including empty, qualified and populated cells', () => {
    const file = workbook('<row><!-- <c/> --><x:c t="inlineStr"><is><t><![CDATA[<x:c/>]]></t></is></x:c><c/></row>',
      '<row><?note <c/>?><c t="str"><v>&lt;c/&gt;</v></c><c /></row>');
    const { sheets } = readStatementWorkbook(file, preserve);
    expect(sheets.map(s => s.values[0][0])).toEqual(['<x:c/>', '<c/>']);
  });
  it('counts only cell elements under worksheet rows', () => {
    const file = workbookWithFooter('<extLst><x:c/><sheetData><row><c/></row></sheetData></extLst>',
      '<row attr="example > marker"><c/><c/><c/><c/></row><ext><c/></ext>');
    expect(readStatementWorkbook(file, preserve).sheets[0].values).toHaveLength(1);
  });
  it('refuses the next cell, including an empty cell or a cell on another worksheet', () => {
    const row = '<row><x:c/><c/><c/><c/></row>';
    expect(() => readStatementWorkbook(workbook(row + '<row><x:c/></row>'), preserve)).toThrow(tooMany);
    expect(() => readStatementWorkbook(workbook(row, '<row><c/></row>'), preserve)).toThrow(tooMany);
  });
});
it('checks all worksheets before constructing rows from the first worksheet', () => {
  const file = workbook('<row r="0"><c/></row>', '<row><c/><c/><c/><c/></row>');
  expect(() => readStatementWorkbook(file, true)).toThrow(tooMany);
});
