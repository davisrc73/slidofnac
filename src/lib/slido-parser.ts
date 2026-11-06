import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

export interface SlidoRawRow {
  userId: string;
  userName: string;
  rank: number;
  score: number;
  maxScore: number;
  timeMs: number;
  quizId: string;
  quizName: string;
  sourceFile: string;
}

export interface PlayerStanding {
  position: number;
  name: string;
  score: number;
  maxScore: number;
  timeMs: number;
  displayTime: string;
  roundsPlayed: number;
}

export interface QuizRoundInfo {
  quizId: string;
  quizName: string;
  sourceFile: string;
  totalRows: number;
  uniquePlayers: number;
  duplicatesRemoved: number;
  maxScore: number;
  uploadedAt: string;
}

export interface LeaderboardState {
  eventTitle: string;
  subtitle: string;
  topLimit: number;
  updatedAt: string;
  totalParticipants: number;
  totalRounds: number;
  rounds: QuizRoundInfo[];
  standings: PlayerStanding[];
}

/**
 * Formats milliseconds into M:SS (and ms if needed for display)
 */
export function formatMilliseconds(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Minimal, zero-dependency ZIP reader for .xlsx files using Node's built-in zlib
 */
function extractXlsxXmlFiles(buffer: Buffer): Record<string, string> {
  const files: Record<string, string> = {};
  // Find End of Central Directory (EOCD) signature 0x06054b50
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Ficheiro .xlsx inválido (ZIP EOCD não encontrado).');
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(ptr) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(ptr + 10);
    const compressedSize = buffer.readUInt32LE(ptr + 20);
    const fileNameLen = buffer.readUInt16LE(ptr + 28);
    const extraLen = buffer.readUInt16LE(ptr + 30);
    const commentLen = buffer.readUInt16LE(ptr + 32);
    const localHeaderOffset = buffer.readUInt32LE(ptr + 42);
    const fileName = buffer.toString('utf8', ptr + 46, ptr + 46 + fileNameLen);

    if (
      fileName === 'xl/sharedStrings.xml' ||
      fileName.startsWith('xl/worksheets/sheet')
    ) {
      const localFileNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;
      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod === 0) {
        files[fileName] = compressedData.toString('utf8');
      } else if (compressionMethod === 8) {
        files[fileName] = zlib.inflateRawSync(compressedData).toString('utf8');
      }
    }

    ptr += 46 + fileNameLen + extraLen + commentLen;
  }

  return files;
}

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function colLettersToIndex(letters: string): number {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

/**
 * Parses an .xlsx buffer into a 2D array of string rows
 */
export function parseXlsxBufferToRows(buffer: Buffer): string[][] {
  const xmlFiles = extractXlsxXmlFiles(buffer);
  const sharedStrings: string[] = [];

  if (xmlFiles['xl/sharedStrings.xml']) {
    const ssXml = xmlFiles['xl/sharedStrings.xml'];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRegex.exec(ssXml)) !== null) {
      const siContent = siMatch[1];
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch: RegExpExecArray | null;
      let text = '';
      while ((tMatch = tRegex.exec(siContent)) !== null) {
        text += decodeXmlEntities(tMatch[1]);
      }
      sharedStrings.push(text);
    }
  }

  const sheetKey =
    Object.keys(xmlFiles)
      .filter((k) => k.startsWith('xl/worksheets/sheet'))
      .sort()[0] || '';

  if (!sheetKey || !xmlFiles[sheetKey]) {
    throw new Error('Folha de cálculo não encontrada no ficheiro .xlsx.');
  }

  const sheetXml = xmlFiles[sheetKey];
  const rows: string[][] = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1];
    const rowValues: string[] = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    let nextColIdx = 0;

    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const attrs = cellMatch[1] || '';
      const cellBody = cellMatch[2] || '';

      const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs);
      const colIdx = refMatch ? colLettersToIndex(refMatch[1]) : nextColIdx;
      while (rowValues.length < colIdx) {
        rowValues.push('');
      }
      nextColIdx = colIdx + 1;

      const typeMatch = /\bt="([^"]+)"/.exec(attrs);
      const cellType = typeMatch ? typeMatch[1] : '';

      let cellText = '';
      if (cellType === 'inlineStr') {
        const tMatch = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/.exec(cellBody);
        if (tMatch) cellText = decodeXmlEntities(tMatch[1]);
      } else {
        const vMatch = /<v(?:\s+[^>]*)?>([\s\S]*?)<\/v>/.exec(cellBody);
        if (vMatch) {
          const rawVal = decodeXmlEntities(vMatch[1]);
          if (cellType === 's') {
            const idx = parseInt(rawVal, 10);
            cellText = sharedStrings[idx] ?? rawVal;
          } else {
            cellText = rawVal;
          }
        }
      }

      rowValues[colIdx] = cellText;
    }

    if (rowValues.some((v) => v.trim() !== '')) {
      rows.push(rowValues);
    }
  }

  return rows;
}

/**
 * Parses a CSV string (supporting `;` or `,` separators and quoted fields) into a 2D array
 */
export function parseCsvToRows(text: string): string[][] {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];

  const lines = cleanText.split(/\r?\n/);
  const firstLine = lines[0] || '';
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolonCount >= commaCount ? ';' : ',';

  return lines
    .map((line) => {
      const cols: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === delimiter && !inQuotes) {
          cols.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cols.push(current.trim());
      return cols;
    })
    .filter((cols) => cols.some((c) => c !== ''));
}

/**
 * Detects whether a buffer is an .xlsx (PKZIP signature 0x50 0x4b 0x03 0x04) or CSV text
 */
export function parseSlidoFileBuffer(buffer: Buffer, fileName: string): SlidoRawRow[] {
  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  const rawRows = isZip
    ? parseXlsxBufferToRows(buffer)
    : parseCsvToRows(buffer.toString('utf8'));

  if (rawRows.length <= 1) {
    return [];
  }

  // Identify column indices from header if present, else use default Slido positions
  const header = rawRows[0].map((h) => h.trim().toLowerCase());
  const hasHeader =
    header.some((h) => h.includes('user') || h.includes('name') || h.includes('score')) ||
    isNaN(Number(rawRows[0][3]));

  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  const findIdx = (keywords: string[], fallback: number): number => {
    if (!hasHeader) return fallback;
    const idx = header.findIndex((h) => keywords.some((kw) => h === kw || h.includes(kw)));
    return idx !== -1 ? idx : fallback;
  };

  const userIdIdx = findIdx(['user id', 'userid'], 0);
  const userNameIdx = findIdx(['user name', 'username', 'nome', 'participante'], 1);
  const rankIdx = findIdx(['rank', ' posição', 'posicao'], 2);
  const scoreIdx = findIdx(['score', 'pontuação', 'pontos'], 3);
  const maxScoreIdx = findIdx(['max score', 'maxscore'], 4);
  const msIdx = findIdx(['milliseconds', 'time', 'tempo', 'ms'], 5);
  const quizIdIdx = findIdx(['quiz id', 'quizid'], 6);
  const quizNameIdx = findIdx(['quiz name', 'quizname'], 7);

  const parsed: SlidoRawRow[] = [];

  for (const cols of dataRows) {
    if (cols.length < 4) continue;
    const userName = (cols[userNameIdx] ?? '').trim();
    if (!userName) continue;

    const userId = (cols[userIdIdx] ?? '').trim() || userName;
    const rank = parseInt((cols[rankIdx] ?? '0').trim(), 10) || 0;
    const score = parseInt((cols[scoreIdx] ?? '0').trim(), 10) || 0;
    const maxScore = parseInt((cols[maxScoreIdx] ?? '0').trim(), 10) || 0;
    const timeMs = parseInt((cols[msIdx] ?? '0').trim(), 10) || 0;
    const quizId = (cols[quizIdIdx] ?? '').trim() || path.basename(fileName);
    const quizName = (cols[quizNameIdx] ?? '').trim() || 'CONVENÇÃO COMERCIAL NATAL 2026';

    parsed.push({
      userId,
      userName,
      rank,
      score,
      maxScore,
      timeMs,
      quizId,
      quizName,
      sourceFile: fileName,
    });
  }

  return parsed;
}

