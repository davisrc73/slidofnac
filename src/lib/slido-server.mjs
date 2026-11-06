import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  syncRosterFromNames,
  searchRoster,
  joinOrUpdateParticipant,
  submitAnswer,
  getLiveQuizzesAsRoundsMap,
  getFullLiveState,
  executeHostAction,
  getTeamStandings,
  generateFullExportXlsx,
} from './quiz-engine.mjs';

const DATA_DIR = path.resolve(process.cwd(), '.slido-data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const DEFAULT_XLSX = path.resolve(process.cwd(), 'resultados.csv.xlsx');
const DEFAULT_CSV = path.resolve(process.cwd(), 'public', 'resultados.csv');

export function formatMilliseconds(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const min = Math.floor(totalSeconds / 60);
  const sec = totalSeconds % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Normalizes a participant name so similar variations match automatically:
 * - Strips accents/diacritics (é -> e, ã -> a, ç -> c, etc.)
 * - Replaces underscores, dots, and hyphens with spaces
 * - Collapses multiple spaces and lowercases
 */
export function normalizeNameKey(rawName) {
  return (rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Chooses the best-formatted display name among raw variants
 * (prefers accents, proper Title Case over all-lowercase or underscores)
 */
function scoreDisplayNameQuality(name) {
  const clean = (name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let score = 0;
  const accentMatches = clean.match(/[^\u0000-\u007f]/g);
  score += (accentMatches ? accentMatches.length : 0) * 10;
  const words = clean.split(' ').filter(Boolean);
  for (const w of words) {
    if (w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase()) {
      score += 4;
    }
  }
  if (!name.includes('_')) score += 2;
  return score;
}

function chooseBestDisplayName(variants) {
  if (!variants || variants.length === 0) return '';
  const sorted = [...variants].sort((a, b) => {
    const diff = scoreDisplayNameQuality(b) - scoreDisplayNameQuality(a);
    if (diff !== 0) return diff;
    return b.length - a.length;
  });
  return sorted[0].replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Computes similarity between two normalized strings (Dice bigrams + token overlap)
 */
function computeNameSimilarity(normA, normB) {
  if (normA === normB) return 1;
  const tokensA = normA.split(' ').filter(Boolean);
  const tokensB = normB.split(' ').filter(Boolean);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  if (tokensA[0] === tokensB[0] && tokensA[0].length >= 3) {
    if (tokensA.length === 1 || tokensB.length === 1) {
      return 0.84;
    }
    if (tokensA[tokensA.length - 1] === tokensB[tokensB.length - 1]) {
      return 0.94;
    }
    const lastA = tokensA[tokensA.length - 1];
    const lastB = tokensB[tokensB.length - 1];
    if ((lastA.length === 1 && lastB.startsWith(lastA)) || (lastB.length === 1 && lastA.startsWith(lastB))) {
      return 0.88;
    }
  }

  const getBigrams = (s) => {
    const bg = [];
    for (let i = 0; i < s.length - 1; i++) bg.push(s.slice(i, i + 2));
    return bg;
  };
  const bgA = getBigrams(normA);
  const bgB = getBigrams(normB);
  if (bgA.length === 0 || bgB.length === 0) return 0;
  const usedB = new Array(bgB.length).fill(false);
  let matches = 0;
  for (const a of bgA) {
    const idx = bgB.findIndex((b, i) => !usedB[i] && b === a);
    if (idx !== -1) {
      usedB[idx] = true;
      matches++;
    }
  }
  const dice = (2 * matches) / (bgA.length + bgB.length);
  if (tokensA[0] === tokensB[0] && dice >= 0.78) {
    return dice;
  }
  return dice >= 0.88 ? dice : 0;
}

function decodeXmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function colLettersToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

function extractXlsxXmlFiles(buffer) {
  const files = {};
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Ficheiro .xlsx inválido (cabeçalho ZIP não encontrado).');
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

export function parseXlsxBufferToRows(buffer) {
  const xmlFiles = extractXlsxXmlFiles(buffer);
  const sharedStrings = [];

  if (xmlFiles['xl/sharedStrings.xml']) {
    const ssXml = xmlFiles['xl/sharedStrings.xml'];
    const siRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let siMatch;
    while ((siMatch = siRegex.exec(ssXml)) !== null) {
      const siContent = siMatch[1];
      const tRegex = /<t(?:\s+[^>]*)?>([\s\S]*?)<\/t>/g;
      let tMatch;
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
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1];
    const rowValues = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
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

    if (rowValues.some((v) => v && v.trim() !== '')) {
      rows.push(rowValues);
    }
  }

  return rows;
}

export function parseCsvToRows(text) {
  const cleanText = text.replace(/^\uFEFF/, '').trim();
  if (!cleanText) return [];

  const lines = cleanText.split(/\r?\n/);
  const firstLine = lines[0] || '';
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = semicolonCount >= commaCount ? ';' : ',';

  return lines
    .map((line) => {
      const cols = [];
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

export function parseSlidoBuffer(buffer, fileName = 'resultados.xlsx') {
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

  const header = rawRows[0].map((h) => (h || '').trim().toLowerCase());
  const hasHeader =
    header.some((h) => h.includes('user') || h.includes('name') || h.includes('score')) ||
    isNaN(Number(rawRows[0][3]));

  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  const findIdx = (keywords, fallback) => {
    if (!hasHeader) return fallback;
    const idx = header.findIndex((h) => keywords.some((kw) => h === kw || h.includes(kw)));
    return idx !== -1 ? idx : fallback;
  };

  const userIdIdx = findIdx(['user id', 'userid'], 0);
  const userNameIdx = findIdx(['user name', 'username', 'nome', 'participante'], 1);
  const rankIdx = findIdx(['rank', 'posição', 'posicao'], 2);
  const scoreIdx = findIdx(['score', 'pontuação', 'pontos'], 3);
  const maxScoreIdx = findIdx(['max score', 'maxscore'], 4);
  const msIdx = findIdx(['milliseconds', 'time', 'tempo', 'ms'], 5);
  const quizIdIdx = findIdx(['quiz id', 'quizid'], 6);
  const quizNameIdx = findIdx(['quiz name', 'quizname'], 7);

  const parsed = [];
  for (const cols of dataRows) {
    if (!cols || cols.length < 4) continue;
    const userName = (cols[userNameIdx] ?? '').trim();
    if (!userName) continue;

    const userId = (cols[userIdIdx] ?? '').trim() || userName;
    const rank = parseInt((cols[rankIdx] ?? '0').trim(), 10) || 0;
    const score = parseInt((cols[scoreIdx] ?? '0').trim(), 10) || 0;
    const maxScore = parseInt((cols[maxScoreIdx] ?? '0').trim(), 10) || 9;
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

function resolveCanonicalKey(normKey, manualMerges = {}) {
  let current = normKey;
  const visited = new Set();
  while (manualMerges[current] && !visited.has(current)) {
    visited.add(current);
    current = manualMerges[current].targetKey;
  }
  return current;
}

export function buildLeaderboardFromRounds(roundsMap, settings = {}) {
  const manualMerges = settings.manualMerges || {};
  const ignoredSuggestions = settings.ignoredSuggestions || [];
  const sumWithinSameQuiz = settings.sumWithinSameQuiz !== false;

  const roundsInfo = [];
  const playerTotals = new Map();
  let globalMaxScore = 0;

  for (const [quizId, roundData] of Object.entries(roundsMap)) {
    const rows = roundData.rows || [];
    const entriesPerCanonicalInRound = new Map();
    let unifiedRowsCount = 0;
    let roundMaxScore = 0;

    for (const row of rows) {
      if (row.maxScore > roundMaxScore) {
        roundMaxScore = row.maxScore;
      }
    }
    if (!roundMaxScore) roundMaxScore = 9;
    globalMaxScore += roundMaxScore;

    for (const row of rows) {
      const autoKey = normalizeNameKey(row.userName);
      const canonicalKey = resolveCanonicalKey(autoKey, manualMerges);

      const existingInRound = entriesPerCanonicalInRound.get(canonicalKey);
      if (!existingInRound) {
        entriesPerCanonicalInRound.set(canonicalKey, {
          score: row.score,
          maxScore: roundMaxScore,
          timeMs: row.timeMs,
          count: 1,
          rawVariants: new Set([row.userName.trim()]),
          sourceKeys: new Set([autoKey]),
        });
      } else {
        unifiedRowsCount++;
        existingInRound.rawVariants.add(row.userName.trim());
        existingInRound.sourceKeys.add(autoKey);

        if (sumWithinSameQuiz) {
          // Sum points and times of repeated/unified entries in the Quiz ID;
          // keep maxScore equal to the round's total questions (roundMaxScore)
          existingInRound.score += row.score;
          existingInRound.maxScore = roundMaxScore;
          existingInRound.timeMs += row.timeMs;
          existingInRound.count += 1;
        } else {
          if (
            row.score > existingInRound.score ||
            (row.score === existingInRound.score && row.timeMs < existingInRound.timeMs)
          ) {
            existingInRound.score = row.score;
            existingInRound.timeMs = row.timeMs;
          }
        }
      }
    }

    roundsInfo.push({
      quizId,
      quizName: roundData.quizName || 'CONVENÇÃO COMERCIAL NATAL 2026',
      sourceFile: roundData.sourceFile || 'resultados.csv.xlsx',
      totalRows: rows.length,
      uniquePlayers: entriesPerCanonicalInRound.size,
      unifiedRowsCount,
      maxScore: roundMaxScore,
      uploadedAt: roundData.uploadedAt || new Date().toISOString(),
    });

    for (const [canonicalKey, roundEntry] of entriesPerCanonicalInRound.entries()) {
      const current = playerTotals.get(canonicalKey) || {
        canonicalKey,
        rawVariants: new Set(),
        sourceKeys: new Set(),
        score: 0,
        maxScore: 0,
        timeMs: 0,
        entriesCount: 0,
        roundsPlayed: 0,
      };

      for (const v of roundEntry.rawVariants) current.rawVariants.add(v);
      for (const k of roundEntry.sourceKeys) current.sourceKeys.add(k);

      current.score += roundEntry.score;
      current.maxScore += roundEntry.maxScore;
      current.timeMs += roundEntry.timeMs;
      current.entriesCount += roundEntry.count;
      current.roundsPlayed += 1;
      playerTotals.set(canonicalKey, current);
    }
  }

  const standings = Array.from(playerTotals.values())
    .map((p) => {
      const customDisplayName = manualMerges[p.canonicalKey]?.displayName;
      const variantsArr = Array.from(p.rawVariants);
      const displayName = customDisplayName || chooseBestDisplayName(variantsArr);
      const totalQuestions = globalMaxScore || p.maxScore || 9;
      return {
        key: p.canonicalKey,
        name: displayName,
        variants: variantsArr,
        sourceKeys: Array.from(p.sourceKeys),
        score: p.score,
        maxScore: totalQuestions,
        scoreRatio: `${p.score}/${totalQuestions}`,
        timeMs: p.timeMs,
        displayTime: formatMilliseconds(p.timeMs),
        entriesCount: p.entriesCount,
        roundsPlayed: p.roundsPlayed,
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.timeMs - b.timeMs;
    })
    .map((p, idx) => ({
      position: idx + 1,
      ...p,
    }));

  const suggestedMerges = [];
  const ignoredSet = new Set(ignoredSuggestions);

  for (let i = 0; i < standings.length; i++) {
    for (let j = i + 1; j < standings.length; j++) {
      const p1 = standings[i];
      const p2 = standings[j];
      const pairId = [p1.key, p2.key].sort().join('||');
      if (ignoredSet.has(pairId)) continue;

      const sim = computeNameSimilarity(p1.key, p2.key);
      if (sim >= 0.80) {
        suggestedMerges.push({
          pairId,
          similarity: Math.round(sim * 100),
          playerA: {
            key: p1.key,
            name: p1.name,
            score: p1.score,
            maxScore: p1.maxScore,
            timeMs: p1.timeMs,
            displayTime: p1.displayTime,
            entriesCount: p1.entriesCount,
          },
          playerB: {
            key: p2.key,
            name: p2.name,
            score: p2.score,
            maxScore: p2.maxScore,
            timeMs: p2.timeMs,
            displayTime: p2.displayTime,
            entriesCount: p2.entriesCount,
          },
          combinedScore: p1.score + p2.score,
          totalQuestions: p1.maxScore,
          combinedDisplayTime: formatMilliseconds(p1.timeMs + p2.timeMs),
        });
      }
    }
  }

  suggestedMerges.sort((a, b) => b.similarity - a.similarity || b.combinedScore - a.combinedScore);

  const activeManualMerges = Object.entries(manualMerges)
    .filter(([sourceKey, info]) => sourceKey !== info.targetKey)
    .map(([sourceKey, info]) => ({
      sourceKey,
      sourceLabel: info.sourceLabel || sourceKey,
      targetKey: info.targetKey,
      targetLabel: info.displayName || info.targetKey,
    }));

  const autoUnifiedList = standings
    .filter((s) => s.variants.length > 1 || s.entriesCount > 1)
    .map((s) => ({
      key: s.key,
      name: s.name,
      variants: s.variants,
      entriesCount: s.entriesCount,
      score: s.score,
      maxScore: s.maxScore,
      displayTime: s.displayTime,
    }));

  const teamStandings = getTeamStandings(standings);

  const defaultQuizName =
    roundsInfo[roundsInfo.length - 1]?.quizName || 'CONVENÇÃO COMERCIAL NATAL 2026';

  return {
    eventTitle: settings.eventTitle || defaultQuizName,
    subtitle: settings.subtitle || 'Tabela de Classificação',
    topLimit: settings.topLimit || 5,
    sumWithinSameQuiz,
    totalQuestions: globalMaxScore || 9,
    updatedAt: settings.updatedAt || new Date().toISOString(),
    totalParticipants: standings.length,
    totalRounds: roundsInfo.length,
    rounds: roundsInfo,
    standings,
    teamStandings,
    suggestedMerges: suggestedMerges.slice(0, 25),
    activeManualMerges,
    autoUnifiedList,
  };
}

function getDiskSourceMtime() {
  try {
    if (fs.existsSync(DEFAULT_XLSX)) {
      return fs.statSync(DEFAULT_XLSX).mtimeMs;
    }
    if (fs.existsSync(DEFAULT_CSV)) {
      return fs.statSync(DEFAULT_CSV).mtimeMs;
    }
  } catch (e) {
    // ignore
  }
  return 0;
}

function loadInitialRoundsFromDisk() {
  let rows = [];
  let sourceFile = '';

  if (fs.existsSync(DEFAULT_XLSX)) {
    const buf = fs.readFileSync(DEFAULT_XLSX);
    rows = parseSlidoBuffer(buf, 'resultados.csv.xlsx');
    sourceFile = 'resultados.csv.xlsx';
  } else if (fs.existsSync(DEFAULT_CSV)) {
    const buf = fs.readFileSync(DEFAULT_CSV);
    rows = parseSlidoBuffer(buf, 'resultados.csv');
    sourceFile = 'resultados.csv';
  }

  const roundsMap = {};
  const allNames = [];
  for (const row of rows) {
    allNames.push(row.userName);
    if (!roundsMap[row.quizId]) {
      roundsMap[row.quizId] = {
        quizId: row.quizId,
        quizName: row.quizName,
        sourceFile,
        uploadedAt: new Date().toISOString(),
        rows: [],
      };
    }
    roundsMap[row.quizId].rows.push(row);
  }
  try {
    if (allNames.length > 0) syncRosterFromNames(allNames);
  } catch (e) {
    // ignore
  }
  return roundsMap;
}

function loadPersistedState() {
  const currentDiskMtime = getDiskSourceMtime();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (raw && raw.roundsMap && Object.keys(raw.roundsMap).length > 0) {
        raw.settings = raw.settings || {};
        raw.settings.manualMerges = raw.settings.manualMerges || {};
        raw.settings.ignoredSuggestions = raw.settings.ignoredSuggestions || [];
        if (typeof raw.settings.sumWithinSameQuiz !== 'boolean') {
          raw.settings.sumWithinSameQuiz = true;
        }
        // If resultados.csv.xlsx on disk was updated more recently, reload disk rounds automatically
        if (currentDiskMtime > 0 && raw.diskMtimeMs !== currentDiskMtime) {
          const freshDiskRounds = loadInitialRoundsFromDisk();
          for (const [qId, qData] of Object.entries(freshDiskRounds)) {
            raw.roundsMap[qId] = qData;
          }
          raw.diskMtimeMs = currentDiskMtime;
          savePersistedState(raw);
        }
        return raw;
      }
    }
  } catch (err) {
    console.error('Erro ao ler estado persistido:', err);
  }

  const roundsMap = loadInitialRoundsFromDisk();
  const initialState = {
    diskMtimeMs: currentDiskMtime,
    settings: {
      eventTitle: 'CONVENÇÃO COMERCIAL NATAL 2026',
      subtitle: 'Tabela de Classificação',
      topLimit: 5,
      sumWithinSameQuiz: true,
      manualMerges: {},
      ignoredSuggestions: [],
      updatedAt: new Date().toISOString(),
    },
    roundsMap,
  };
  savePersistedState(initialState);
  return initialState;
}

function savePersistedState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Erro ao guardar estado:', err);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.end(JSON.stringify(payload));
}

export async function handleSlidoApiRequest(req, res, next) {
  const url = req.url ? req.url.split('?')[0] : '';

  if (url === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'ok',
      app: 'slidofnac',
      env: process.env.APP_ENV || process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
      uptimeSec: Math.round(process.uptime()),
    });
  }

  if (url === '/api/live/export.xlsx' && req.method === 'GET') {
    try {
      const state = loadPersistedState();
      const liveRounds = getLiveQuizzesAsRoundsMap();
      const combinedRounds = { ...state.roundsMap, ...liveRounds };
      const leaderboard = buildLeaderboardFromRounds(combinedRounds, state.settings);
      const xlsxBuf = generateFullExportXlsx(leaderboard);

      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="resultados-fnac-quiz.xlsx"'
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.end(xlsxBuf);
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Erro ao exportar Excel.' });
    }
  }

  if (url === '/api/leaderboard' && req.method === 'GET') {
    try {
      const state = loadPersistedState();
      const liveRounds = getLiveQuizzesAsRoundsMap();
      const combinedRounds = { ...state.roundsMap, ...liveRounds };
      const leaderboard = buildLeaderboardFromRounds(combinedRounds, state.settings);
      return sendJson(res, 200, leaderboard);
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Erro ao carregar classificação.' });
    }
  }

  if (url === '/api/live/state' && req.method === 'GET') {
    try {
      const queryStr = req.url.includes('?') ? req.url.split('?')[1] : '';
      const params = new URLSearchParams(queryStr);
      const participantId = params.get('participantId') || '';
      const requestHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4321';
      const requestProto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();

      const state = loadPersistedState();
      const liveState = getFullLiveState({ participantId, requestHost, requestProto });
      const liveRounds = getLiveQuizzesAsRoundsMap();
      const combinedRounds = liveState.includeImportedRounds
        ? { ...state.roundsMap, ...liveRounds }
        : Object.keys(liveRounds).length > 0
        ? liveRounds
        : state.roundsMap;
      const leaderboard = buildLeaderboardFromRounds(combinedRounds, state.settings);

      return sendJson(res, 200, {
        ...liveState,
        leaderboard,
      });
    } catch (err) {
      return sendJson(res, 500, { error: err.message || 'Erro ao ler estado live.' });
    }
  }

      if (url === '/api/live/roster' && req.method === 'GET') {
        try {
          const queryStr = req.url.includes('?') ? req.url.split('?')[1] : '';
          const params = new URLSearchParams(queryStr);
          const q = params.get('q') || '';
          return sendJson(res, 200, { results: searchRoster(q) });
        } catch (err) {
          return sendJson(res, 500, { error: err.message });
        }
      }

      if (url === '/api/live/join' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const participant = joinOrUpdateParticipant(body);
          return sendJson(res, 200, { ok: true, participant });
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Erro ao entrar no quiz.' });
        }
      }

      if (url === '/api/live/answer' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const result = submitAnswer(body);
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Erro ao submeter resposta.' });
        }
      }

      if (url === '/api/live/control' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          executeHostAction(body);
          const requestHost = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4321';
          const requestProto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
          const state = loadPersistedState();
          const liveState = getFullLiveState({ requestHost, requestProto });
          const liveRounds = getLiveQuizzesAsRoundsMap();
          const combinedRounds = liveState.includeImportedRounds
            ? { ...state.roundsMap, ...liveRounds }
            : Object.keys(liveRounds).length > 0
            ? liveRounds
            : state.roundsMap;
          const leaderboard = buildLeaderboardFromRounds(combinedRounds, state.settings);

          return sendJson(res, 200, { ok: true, ...liveState, leaderboard });
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Erro ao executar comando.' });
        }
      }

      if (url === '/api/upload' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const { fileName = 'resultados.xlsx', contentBase64, mode = 'merge' } = body;
          if (!contentBase64) {
            return sendJson(res, 400, { error: 'Conteúdo do ficheiro em falta.' });
          }

          const buffer = Buffer.from(contentBase64, 'base64');
          const parsedRows = parseSlidoBuffer(buffer, fileName);
          if (parsedRows.length === 0) {
            return sendJson(res, 400, {
              error: 'Não foram encontradas linhas válidas do Slido no ficheiro enviado.',
            });
          }

          const state = loadPersistedState();
          if (mode === 'replace') {
            state.roundsMap = {};
          }

          const groupedByQuiz = {};
          for (const row of parsedRows) {
            if (!groupedByQuiz[row.quizId]) {
              groupedByQuiz[row.quizId] = {
                quizId: row.quizId,
                quizName: row.quizName,
                sourceFile: fileName,
                uploadedAt: new Date().toISOString(),
                rows: [],
              };
            }
            groupedByQuiz[row.quizId].rows.push(row);
          }

          for (const [qId, qData] of Object.entries(groupedByQuiz)) {
            state.roundsMap[qId] = qData;
          }

          state.settings.updatedAt = new Date().toISOString();
          savePersistedState(state);

          const leaderboard = buildLeaderboardFromRounds(state.roundsMap, state.settings);
          return sendJson(res, 200, {
            ok: true,
            message: `Ficheiro "${fileName}" processado com sucesso (${parsedRows.length} registos).`,
            leaderboard,
          });
        } catch (err) {
          return sendJson(res, 400, {
            error: err.message || 'Erro ao processar o ficheiro enviado.',
          });
        }
      }

      if (url === '/api/settings' && req.method === 'POST') {
        try {
          const body = await readJsonBody(req);
          const state = loadPersistedState();
          state.settings.manualMerges = state.settings.manualMerges || {};
          state.settings.ignoredSuggestions = state.settings.ignoredSuggestions || [];

          if (body.action === 'reset') {
            state.roundsMap = loadInitialRoundsFromDisk();
            state.settings.manualMerges = {};
            state.settings.ignoredSuggestions = [];
          } else if (body.action === 'clear') {
            state.roundsMap = {};
          } else if (body.removeQuizId) {
            delete state.roundsMap[body.removeQuizId];
          } else if (body.action === 'mergeUsers') {
            const { sourceKeys = [], targetKey, displayName, sourceLabels = {} } = body;
            if (targetKey && Array.isArray(sourceKeys)) {
              for (const sKey of sourceKeys) {
                if (sKey && sKey !== targetKey) {
                  state.settings.manualMerges[sKey] = {
                    targetKey,
                    displayName: displayName || targetKey,
                    sourceLabel: sourceLabels[sKey] || sKey,
                  };
                }
              }
              if (displayName) {
                state.settings.manualMerges[targetKey] = {
                  targetKey,
                  displayName,
                  sourceLabel: displayName,
                };
              }
            }
          } else if (body.action === 'unmergeUser') {
            const { sourceKey } = body;
            if (sourceKey && state.settings.manualMerges[sourceKey]) {
              delete state.settings.manualMerges[sourceKey];
            }
          } else if (body.action === 'ignoreSuggestion') {
            const { pairId } = body;
            if (pairId && !state.settings.ignoredSuggestions.includes(pairId)) {
              state.settings.ignoredSuggestions.push(pairId);
            }
          }

          if (typeof body.sumWithinSameQuiz === 'boolean') {
            state.settings.sumWithinSameQuiz = body.sumWithinSameQuiz;
          }
          if (typeof body.eventTitle === 'string' && body.eventTitle.trim()) {
            state.settings.eventTitle = body.eventTitle.trim();
          }
          if (typeof body.subtitle === 'string' && body.subtitle.trim()) {
            state.settings.subtitle = body.subtitle.trim();
          }
          if (typeof body.topLimit === 'number' && body.topLimit >= 1 && body.topLimit <= 100) {
            state.settings.topLimit = body.topLimit;
          }

          state.settings.updatedAt = new Date().toISOString();
          savePersistedState(state);

          const leaderboard = buildLeaderboardFromRounds(state.roundsMap, state.settings);
          return sendJson(res, 200, { ok: true, leaderboard });
        } catch (err) {
          return sendJson(res, 400, { error: err.message || 'Erro ao atualizar definições.' });
        }
      }

  if (typeof next === 'function') {
    next();
  }
}

export function createSlidoApiPlugin() {
  return {
    name: 'slido-fnac-api',
    configureServer(server) {
      server.middlewares.use(handleSlidoApiRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleSlidoApiRequest);
    },
  };
}
