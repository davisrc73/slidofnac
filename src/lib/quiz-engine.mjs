import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { normalizeNameKey, formatMilliseconds } from './slido-server.mjs';
import { generateQrCodeSvg } from './qrcode-svg.mjs';
import { buildXlsxWorkbook } from './xlsx-exporter.mjs';

const DATA_DIR = path.resolve(process.cwd(), '.slido-data');
const DB_PATH = path.join(DATA_DIR, 'quiz-platform.sqlite');

export const FNAC_TEAMS = [
  'Sede / Serviços Centrais',
  'FNAC Colombo',
  'FNAC Chiado',
  'FNAC Norteshopping',
  'FNAC Vasco da Gama',
  'FNAC Almada',
  'FNAC Amoreiras',
  'FNAC Alfragide',
  'FNAC Cascais',
  'FNAC Oeiras',
  'FNAC Santa Catarina',
  'FNAC MarShopping',
  'FNAC GaiaShopping',
  'FNAC Braga',
  'FNAC Guimarães',
  'FNAC Coimbra',
  'FNAC Fórum Aveiro',
  'FNAC Viseu',
  'FNAC Leiria',
  'FNAC AlgarveShopping',
  'FNAC Fórum Algarve (Faro)',
  'FNAC Madeira',
  'FNAC Setúbal',
  'FNAC Torres Vedras',
  'FNAC Évora',
  'FNAC Vila Real',
  'Logística / Entreposto',
];

let dbInstance = null;

export function getLanIpAddress() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (e) {
    // ignore
  }
  return 'localhost';
}

function safeAddColumn(db, table, colDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef};`);
  } catch (e) {
    // Column already exists
  }
}

function getDb() {
  if (dbInstance) return dbInstance;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS quizzes (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      order_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'quiz',
      options_json TEXT NOT NULL DEFAULT '[]',
      correct_index INTEGER NOT NULL DEFAULT 0,
      time_limit_sec INTEGER NOT NULL DEFAULT 20,
      points_multiplier INTEGER NOT NULL DEFAULT 1,
      image_url TEXT DEFAULT '',
      image_reveal_mode TEXT DEFAULT 'none',
      config_json TEXT DEFAULT '{}',
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS roster (
      normalized_key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      employee_id TEXT DEFAULT '',
      team_name TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      employee_id TEXT DEFAULT '',
      team_name TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      selected_index INTEGER NOT NULL DEFAULT -1,
      is_correct INTEGER NOT NULL DEFAULT 0,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      time_ms INTEGER NOT NULL DEFAULT 0,
      response_text TEXT DEFAULT '',
      response_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (quiz_id) REFERENCES quizzes(id) ON DELETE CASCADE,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS idea_votes (
      answer_id TEXT NOT NULL,
      participant_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (answer_id, participant_id),
      FOREIGN KEY (answer_id) REFERENCES answers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS live_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      active_quiz_id TEXT,
      status TEXT NOT NULL DEFAULT 'lobby',
      current_question_index INTEGER NOT NULL DEFAULT 0,
      question_started_at INTEGER NOT NULL DEFAULT 0,
      countdown_step INTEGER NOT NULL DEFAULT -1,
      public_base_url TEXT DEFAULT '',
      include_imported_rounds INTEGER NOT NULL DEFAULT 0,
      leaderboard_mode TEXT NOT NULL DEFAULT 'individual'
    );
  `);

  // Safe migrations for existing databases
  safeAddColumn(db, 'questions', 'points_multiplier INTEGER NOT NULL DEFAULT 1');
  safeAddColumn(db, 'questions', "image_url TEXT DEFAULT ''");
  safeAddColumn(db, 'questions', "image_reveal_mode TEXT DEFAULT 'none'");
  safeAddColumn(db, 'questions', "config_json TEXT DEFAULT '{}'");
  safeAddColumn(db, 'roster', "team_name TEXT DEFAULT ''");
  safeAddColumn(db, 'participants', "team_name TEXT DEFAULT ''");
  safeAddColumn(db, 'answers', 'points_awarded INTEGER NOT NULL DEFAULT 0');
  safeAddColumn(db, 'answers', "response_text TEXT DEFAULT ''");
  safeAddColumn(db, 'answers', "response_json TEXT DEFAULT '{}'");
  safeAddColumn(db, 'live_state', "leaderboard_mode TEXT NOT NULL DEFAULT 'individual'");

  dbInstance = db;
  seedInitialDataIfNeeded(db);
  return db;
}

function seedInitialDataIfNeeded(db) {
  // Upgrade legacy 'multiple'/'boolean' types to 'quiz' so all 8 Slido models have clean canonical types
  db.exec(`UPDATE questions SET type = 'quiz' WHERE type IN ('multiple', 'boolean');`);

  const hasShowcase = db
    .prepare("SELECT id FROM questions WHERE type IN ('wordcloud', 'poll', 'rating', 'ideas') LIMIT 1")
    .get();

  const firstQuiz = db.prepare('SELECT id FROM quizzes ORDER BY created_at ASC LIMIT 1').get();
  if (!firstQuiz) {
    const quizId = 'quiz-convencao-2026';
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO quizzes (id, code, title, description, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(
      quizId,
      'FNAC26',
      'Convenção Comercial Natal 2026 — Sessão Interativa Completa',
      'Playlist com os 8 modelos de interação (Word Cloud, Poll, Quiz, Ideias, Ranking, Rating, Texto Livre e Survey).',
      now
    );
    seedDefaultPlaylistQuestions(db, quizId);
    db.prepare(`
      INSERT OR REPLACE INTO live_state (id, active_quiz_id, status, current_question_index, question_started_at, countdown_step, public_base_url, include_imported_rounds, leaderboard_mode)
      VALUES (1, ?, 'lobby', 0, 0, -1, '', 0, 'individual')
    `).run(quizId);
  } else if (!hasShowcase) {
    // Append examples of the new Slido models to the existing demo session so the user can test all 8 models immediately!
    appendNewModelExamples(db, firstQuiz.id);
  }
}

function seedDefaultPlaylistQuestions(db, quizId) {
  const items = [
    {
      type: 'wordcloud',
      text: 'Numa palavra, o que define o espírito da equipa FNAC neste Natal 2026?',
      options: [],
      correctIndex: 0,
      timeLimitSec: 45,
      pointsMultiplier: 1,
      config: { maxWords: 3 },
    },
    {
      type: 'poll',
      text: 'Qual destas áreas considera mais estratégica para surpreender o cliente na loja?',
      options: [
        'Atendimento personalizado e recomendação especialista',
        'Rapidez no Click & Collect e Omnicanalidade',
        'Destaque visual e experimentação de produto',
        'Soluções de Serviços, Seguros e Fidelização Cartão FNAC',
      ],
      correctIndex: 0,
      timeLimitSec: 30,
      pointsMultiplier: 1,
      config: {},
    },
    {
      type: 'quiz',
      text: 'Em que ano foi inaugurada a primeira loja FNAC em Portugal (Centro Comercial Colombo)?',
      options: ['1996', '1998', '2000', '2002'],
      correctIndex: 1,
      timeLimitSec: 20,
      pointsMultiplier: 1,
      config: {},
    },
    {
      type: 'quiz',
      text: '🔥 PERGUNTA DUPLA (2x PONTOS): Qual é o fator de desempate principal na Tabela de Classificação?',
      options: [
        'Ordem alfabética do nome',
        'Menor tempo acumulado em milissegundos',
        'Antiguidade na empresa',
        'Sorteio aleatório',
      ],
      correctIndex: 1,
      timeLimitSec: 20,
      pointsMultiplier: 2,
      config: {},
    },
    {
      type: 'ideas',
      text: 'Que ideia prática implementaria na sua loja para acelerar o atendimento no pico de Natal?',
      options: [],
      correctIndex: 0,
      timeLimitSec: 60,
      pointsMultiplier: 1,
      config: { allowUpvotes: true },
    },
    {
      type: 'ranking',
      text: 'Ordene por prioridade as categorias mais procuradas para presentes de Natal:',
      options: [
        'Livros & Papelaria',
        'Gaming & Consolas',
        'Smartphones, Áudio & Som',
        'Pequenos Eletrodomésticos & Casa',
      ],
      correctIndex: 0,
      timeLimitSec: 45,
      pointsMultiplier: 1,
      config: {},
    },
    {
      type: 'rating',
      text: 'Como avalia a energia e preparação da sua equipa para a Convenção Comercial Natal 2026?',
      options: ['1', '2', '3', '4', '5'],
      correctIndex: 0,
      timeLimitSec: 30,
      pointsMultiplier: 1,
      config: { maxStars: 5 },
    },
    {
      type: 'opentext',
      text: 'Deixe uma mensagem de motivação para as equipas das Lojas FNAC!',
      options: [],
      correctIndex: 0,
      timeLimitSec: 45,
      pointsMultiplier: 1,
      config: {},
    },
    {
      type: 'survey',
      text: 'Inquérito Rápido de Feedback da Convenção',
      options: [],
      correctIndex: 0,
      timeLimitSec: 90,
      pointsMultiplier: 1,
      config: {
        surveyQuestions: [
          {
            id: 'sq1',
            type: 'rating',
            text: 'Avaliação global das apresentações da manhã (1 a 5 estrelas)',
            maxStars: 5,
          },
          {
            id: 'sq2',
            type: 'poll',
            text: 'Qual o momento mais útil até agora?',
            options: ['Estratégia Comercial', 'Novidades Produto Natal', 'Dinâmica de Equipas / Quiz'],
          },
          {
            id: 'sq3',
            type: 'opentext',
            text: 'Alguma sugestão para a próxima Convenção?',
          },
        ],
      },
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO questions (id, quiz_id, order_index, text, type, options_json, correct_index, time_limit_sec, points_multiplier, image_url, image_reveal_mode, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  items.forEach((it, idx) => {
    stmt.run(
      `q-${idx + 1}-${crypto.randomBytes(3).toString('hex')}`,
      quizId,
      idx,
      it.text,
      it.type,
      JSON.stringify(it.options || []),
      it.correctIndex || 0,
      it.timeLimitSec || 20,
      it.pointsMultiplier || 1,
      it.imageUrl || '',
      it.imageRevealMode || 'none',
      JSON.stringify(it.config || {})
    );
  });
}

function appendNewModelExamples(db, quizId) {
  const maxOrder =
    db.prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM questions WHERE quiz_id = ?').get(quizId)
      ?.m ?? -1;

  const extra = [
    {
      type: 'wordcloud',
      text: 'Numa palavra, o que define o espírito da equipa FNAC neste Natal 2026?',
      options: [],
      timeLimitSec: 45,
      config: { maxWords: 3 },
    },
    {
      type: 'poll',
      text: 'Qual destas áreas considera mais estratégica para surpreender o cliente na loja?',
      options: [
        'Atendimento personalizado e recomendação especialista',
        'Rapidez no Click & Collect e Omnicanalidade',
        'Destaque visual e experimentação de produto',
        'Soluções de Serviços e Fidelização Cartão FNAC',
      ],
      timeLimitSec: 30,
      config: {},
    },
    {
      type: 'ideas',
      text: 'Que ideia prática implementaria na sua loja para acelerar o atendimento no Natal?',
      options: [],
      timeLimitSec: 60,
      config: { allowUpvotes: true },
    },
    {
      type: 'ranking',
      text: 'Ordene por prioridade as categorias mais procuradas para presentes de Natal:',
      options: [
        'Livros & Papelaria',
        'Gaming & Consolas',
        'Smartphones, Áudio & Som',
        'Pequenos Eletrodomésticos & Casa',
      ],
      timeLimitSec: 45,
      config: {},
    },
    {
      type: 'rating',
      text: 'Como avalia a preparação da sua equipa para a Convenção Comercial Natal 2026?',
      options: ['1', '2', '3', '4', '5'],
      timeLimitSec: 30,
      config: { maxStars: 5 },
    },
    {
      type: 'opentext',
      text: 'Deixe uma mensagem de motivação para as equipas das Lojas FNAC!',
      options: [],
      timeLimitSec: 45,
      config: {},
    },
    {
      type: 'survey',
      text: 'Inquérito Rápido de Feedback da Convenção',
      options: [],
      timeLimitSec: 90,
      config: {
        surveyQuestions: [
          {
            id: 'sq1',
            type: 'rating',
            text: 'Avaliação global das apresentações (1 a 5 estrelas)',
            maxStars: 5,
          },
          {
            id: 'sq2',
            type: 'poll',
            text: 'Qual o momento mais útil da Convenção?',
            options: ['Estratégia Comercial', 'Novidades Produto Natal', 'Dinâmica de Equipas / Quiz'],
          },
          {
            id: 'sq3',
            type: 'opentext',
            text: 'Alguma sugestão para a próxima edição?',
          },
        ],
      },
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO questions (id, quiz_id, order_index, text, type, options_json, correct_index, time_limit_sec, points_multiplier, image_url, image_reveal_mode, config_json)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, '', 'none', ?)
  `);

  extra.forEach((it, idx) => {
    stmt.run(
      `q-ext-${idx + 1}-${crypto.randomBytes(2).toString('hex')}`,
      quizId,
      maxOrder + 1 + idx,
      it.text,
      it.type,
      JSON.stringify(it.options),
      it.timeLimitSec,
      JSON.stringify(it.config)
    );
  });
}

export function syncRosterFromNames(namesArray) {
  const db = getDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO roster (normalized_key, name, employee_id, team_name) VALUES (?, ?, ?, ?)'
  );
  for (const rawName of namesArray) {
    const clean = (rawName || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    const key = normalizeNameKey(clean);
    if (key && clean.length >= 2) {
      stmt.run(key, clean, '', '');
    }
  }
}

export function searchRoster(query = '') {
  const db = getDb();
  const qNorm = normalizeNameKey(query);
  const allRoster = db.prepare('SELECT name, employee_id, team_name FROM roster ORDER BY name ASC').all();
  if (!qNorm) {
    return allRoster.slice(0, 30);
  }
  return allRoster
    .filter(
      (r) =>
        normalizeNameKey(r.name).includes(qNorm) ||
        (r.employee_id && r.employee_id.includes(qNorm)) ||
        (r.team_name && normalizeNameKey(r.team_name).includes(qNorm))
    )
    .slice(0, 15);
}

export function addRosterNames(rawText) {
  const lines = (rawText || '')
    .split(/\r?\n|,|;/)
    .map((s) => s.trim())
    .filter(Boolean);
  syncRosterFromNames(lines);
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as c FROM roster').get().c;
}

export function joinOrUpdateParticipant({ participantId, name, employeeId = '', teamName = '' }) {
  const db = getDb();
  const cleanName = (name || '').replace(/\s+/g, ' ').trim();
  if (!cleanName) {
    throw new Error('Por favor introduza o seu nome.');
  }
  const normKey = normalizeNameKey(cleanName);
  if (!normKey) {
    throw new Error('Nome inválido.');
  }

  const cleanTeam = (teamName || '').trim();
  const now = new Date().toISOString();

  const existingByName = db
    .prepare('SELECT * FROM participants WHERE normalized_key = ? LIMIT 1')
    .get(normKey);

  if (existingByName) {
    const finalTeam = cleanTeam || existingByName.team_name || '';
    db.prepare(
      'UPDATE participants SET name = ?, employee_id = ?, team_name = ?, last_seen_at = ? WHERE id = ?'
    ).run(cleanName, employeeId || existingByName.employee_id, finalTeam, now, existingByName.id);
    db.prepare(
      'INSERT OR REPLACE INTO roster (normalized_key, name, employee_id, team_name) VALUES (?, ?, ?, ?)'
    ).run(normKey, cleanName, employeeId || '', finalTeam);
    return {
      id: existingByName.id,
      name: cleanName,
      normalizedKey: normKey,
      employeeId: employeeId || existingByName.employee_id,
      teamName: finalTeam,
    };
  }

  const finalId =
    participantId && participantId.length >= 6 ? participantId : `p-${crypto.randomUUID()}`;
  const existingById = db.prepare('SELECT * FROM participants WHERE id = ?').get(finalId);

  if (existingById) {
    const finalTeam = cleanTeam || existingById.team_name || '';
    db.prepare(
      'UPDATE participants SET name = ?, normalized_key = ?, employee_id = ?, team_name = ?, last_seen_at = ? WHERE id = ?'
    ).run(cleanName, normKey, employeeId, finalTeam, now, finalId);
  } else {
    db.prepare(
      'INSERT INTO participants (id, name, normalized_key, employee_id, team_name, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(finalId, cleanName, normKey, employeeId, cleanTeam, now, now);
  }

  db.prepare(
    'INSERT OR REPLACE INTO roster (normalized_key, name, employee_id, team_name) VALUES (?, ?, ?, ?)'
  ).run(normKey, cleanName, employeeId || '', cleanTeam);

  return {
    id: finalId,
    name: cleanName,
    normalizedKey: normKey,
    employeeId,
    teamName: cleanTeam,
  };
}

/**
 * Handles submissions for all 8 interaction models:
 * - 'quiz': competitive choice with points_awarded (1 or 2x) and reaction time_ms
 * - 'poll': multiple choice poll (live percentage bars)
 * - 'wordcloud': word submission (can submit multiple words)
 * - 'opentext': free-text comment card
 * - 'ideas': idea submission + separate upvote action
 * - 'ranking': ordered array of option indices [2, 0, 1, 3]
 * - 'rating': numeric score 1..maxStars
 * - 'survey': JSON object of answers for each sub-question
 */
export function submitAnswer(body) {
  const db = getDb();
  const {
    participantId,
    questionId,
    selectedIndex,
    clientElapsedMs,
    responseText = '',
    responseJson = null,
    action = 'submit',
    answerId = '',
  } = body;

  const participant = db.prepare('SELECT * FROM participants WHERE id = ?').get(participantId);
  if (!participant) {
    throw new Error('Sessão de participante não encontrada. Por favor volte a entrar.');
  }

  // Upvote toggle for 'ideas' model
  if (action === 'upvote_idea' && answerId) {
    const existingVote = db
      .prepare('SELECT 1 FROM idea_votes WHERE answer_id = ? AND participant_id = ?')
      .get(answerId, participantId);
    if (existingVote) {
      db.prepare('DELETE FROM idea_votes WHERE answer_id = ? AND participant_id = ?').run(
        answerId,
        participantId
      );
      return { ok: true, upvoted: false };
    } else {
      db.prepare(
        'INSERT INTO idea_votes (answer_id, participant_id, created_at) VALUES (?, ?, ?)'
      ).run(answerId, participantId, new Date().toISOString());
      return { ok: true, upvoted: true };
    }
  }

  const live = db.prepare('SELECT * FROM live_state WHERE id = 1').get();
  if (!live || (live.status !== 'question_open' && live.status !== 'question_reveal')) {
    throw new Error('Esta atividade não está aberta de momento.');
  }

  const questions = db
    .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index ASC')
    .all(live.active_quiz_id);
  const currentQuestion = questions[live.current_question_index];

  if (!currentQuestion || currentQuestion.id !== questionId) {
    throw new Error('Esta atividade já não é a atividade ativa.');
  }

  const qType = currentQuestion.type || 'quiz';
  const now = new Date().toISOString();

  // For 'wordcloud', 'opentext', and 'ideas', participants can submit multiple entries!
  if (qType === 'wordcloud' || qType === 'opentext' || qType === 'ideas') {
    const cleanText = String(responseText || '').trim();
    if (!cleanText) {
      throw new Error('Por favor escreva uma resposta antes de enviar.');
    }
    const newAnsId = `ans-${crypto.randomUUID()}`;
    db.prepare(`
      INSERT INTO answers (id, quiz_id, question_id, participant_id, selected_index, is_correct, points_awarded, time_ms, response_text, response_json, created_at)
      VALUES (?, ?, ?, ?, -1, 0, 0, 0, ?, '{}', ?)
    `).run(newAnsId, live.active_quiz_id, currentQuestion.id, participantId, cleanText, now);

    // Automatically upvote own idea in 'ideas' mode
    if (qType === 'ideas') {
      db.prepare(
        'INSERT OR IGNORE INTO idea_votes (answer_id, participant_id, created_at) VALUES (?, ?, ?)'
      ).run(newAnsId, participantId, now);
    }

    return {
      ok: true,
      answerId: newAnsId,
      questionId: currentQuestion.id,
      responseText: cleanText,
    };
  }

  // For 'quiz', check time limit
  const maxAllowedMs = (currentQuestion.time_limit_sec || 20) * 1000;
  const serverElapsedMs = Math.max(100, Date.now() - (live.question_started_at || Date.now()));

  if (qType === 'quiz') {
    if (live.status !== 'question_open') {
      throw new Error('A votação para esta pergunta do Quiz já encerrou.');
    }
    if (serverElapsedMs > maxAllowedMs + 1500) {
      throw new Error('O tempo para responder a esta pergunta terminou!');
    }
  }

  let finalTimeMs = serverElapsedMs;
  if (
    typeof clientElapsedMs === 'number' &&
    clientElapsedMs >= 100 &&
    Math.abs(serverElapsedMs - clientElapsedMs) <= 2000
  ) {
    finalTimeMs = Math.round(clientElapsedMs);
  }
  finalTimeMs = Math.min(maxAllowedMs, Math.max(100, finalTimeMs));

  const selIdx = typeof selectedIndex === 'number' ? Number(selectedIndex) : -1;
  const isCorrect =
    qType === 'quiz' && selIdx === Number(currentQuestion.correct_index) ? 1 : 0;
  const multiplier = Number(currentQuestion.points_multiplier) || 1;
  const pointsAwarded = isCorrect ? multiplier : 0;
  const jsonPayload = responseJson ? JSON.stringify(responseJson) : '{}';

  // Single-response per participant per question for quiz, poll, rating, ranking, survey
  const existingAns = db
    .prepare('SELECT id FROM answers WHERE question_id = ? AND participant_id = ? LIMIT 1')
    .get(currentQuestion.id, participantId);

  if (existingAns) {
    db.prepare(`
      UPDATE answers
      SET selected_index = ?, is_correct = ?, points_awarded = ?, time_ms = ?, response_text = ?, response_json = ?, created_at = ?
      WHERE id = ?
    `).run(
      selIdx,
      isCorrect,
      pointsAwarded,
      finalTimeMs,
      String(responseText || ''),
      jsonPayload,
      now,
      existingAns.id
    );
  } else {
    db.prepare(`
      INSERT INTO answers (id, quiz_id, question_id, participant_id, selected_index, is_correct, points_awarded, time_ms, response_text, response_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `ans-${crypto.randomUUID()}`,
      live.active_quiz_id,
      currentQuestion.id,
      participantId,
      selIdx,
      isCorrect,
      pointsAwarded,
      finalTimeMs,
      String(responseText || ''),
      jsonPayload,
      now
    );
  }

  return {
    ok: true,
    questionId: currentQuestion.id,
    selectedIndex: selIdx,
    timeMs: finalTimeMs,
    displayTime: `${(finalTimeMs / 1000).toFixed(2)}s`,
  };
}

/**
 * Computes rich live aggregation for any of the 8 question models
 */
function buildQuestionLiveAggregation(db, question, participantId = '') {
  if (!question) return null;
  const qType = question.type || 'quiz';
  const options = question.options || [];

  const allAnswers = db
    .prepare(`
      SELECT a.*, p.name as participant_name, p.team_name as team_name
      FROM answers a
      LEFT JOIN participants p ON p.id = a.participant_id
      WHERE a.question_id = ?
      ORDER BY a.created_at DESC
    `)
    .all(question.id);

  const totalResponses = allAnswers.length;
  const uniqueResponders = new Set(allAnswers.map((a) => a.participant_id)).size;

  // 1. Multiple Choice Poll & Competitive Quiz
  if (qType === 'quiz' || qType === 'poll') {
    const counts = new Array(options.length).fill(0);
    for (const a of allAnswers) {
      if (a.selected_index >= 0 && a.selected_index < counts.length) {
        counts[a.selected_index]++;
      }
    }
    return {
      totalAnswers: totalResponses,
      uniqueResponders,
      optionCounts: counts,
      optionPercentages: counts.map((c) =>
        totalResponses > 0 ? Math.round((c / totalResponses) * 100) : 0
      ),
    };
  }

  // 2. Word Cloud
  if (qType === 'wordcloud') {
    const wordMap = new Map();
    for (const a of allAnswers) {
      const raw = (a.response_text || '').trim();
      if (!raw) continue;
      const norm = normalizeNameKey(raw);
      if (!norm) continue;
      const current = wordMap.get(norm) || { text: raw, count: 0 };
      current.count += 1;
      // Prefer properly accented/capitalized display text
      if (/[^\u0000-\u007f]/.test(raw)) current.text = raw;
      wordMap.set(norm, current);
    }
    const words = Array.from(wordMap.values()).sort((a, b) => b.count - a.count);
    return {
      totalAnswers: totalResponses,
      uniqueResponders,
      words: words.slice(0, 50),
    };
  }

  // 3. Open Text
  if (qType === 'opentext') {
    return {
      totalAnswers: totalResponses,
      uniqueResponders,
      entries: allAnswers.slice(0, 60).map((a) => ({
        id: a.id,
        text: a.response_text,
        author: a.participant_name || 'Participante',
        team: a.team_name || '',
        createdAt: a.created_at,
      })),
    };
  }

  // 4. Ideas (with Upvotes)
  if (qType === 'ideas') {
    const voteRows = db
      .prepare(`
        SELECT iv.answer_id, iv.participant_id
        FROM idea_votes iv
        JOIN answers a ON a.id = iv.answer_id
        WHERE a.question_id = ?
      `)
      .all(question.id);

    const voteCounts = new Map();
    const myVotedIds = new Set();
    for (const v of voteRows) {
      voteCounts.set(v.answer_id, (voteCounts.get(v.answer_id) || 0) + 1);
      if (participantId && v.participant_id === participantId) {
        myVotedIds.add(v.answer_id);
      }
    }

    const ideas = allAnswers
      .map((a) => ({
        id: a.id,
        text: a.response_text,
        author: a.participant_name || 'Participante',
        team: a.team_name || '',
        votes: voteCounts.get(a.id) || 0,
        upvotedByMe: myVotedIds.has(a.id),
        createdAt: a.created_at,
      }))
      .sort((a, b) => b.votes - a.votes);

    return {
      totalAnswers: totalResponses,
      uniqueResponders,
      ideas,
    };
  }

  // 5. Ranking (Borda count weighted score)
  if (qType === 'ranking') {
    const n = options.length;
    const pointsPerOption = new Array(n).fill(0);
    const firstPlaceVotes = new Array(n).fill(0);

    for (const a of allAnswers) {
      try {
        const parsed = JSON.parse(a.response_json || '{}');
        const order = Array.isArray(parsed.order) ? parsed.order : [];
        order.forEach((optIdx, rankPos) => {
          if (optIdx >= 0 && optIdx < n) {
            pointsPerOption[optIdx] += Math.max(0, n - rankPos);
            if (rankPos === 0) firstPlaceVotes[optIdx]++;
          }
        });
      } catch (e) {
        // ignore
      }
    }

    const maxPossiblePoints = Math.max(1, totalResponses * n);
    const rankedItems = options
      .map((label, idx) => ({
        optionIndex: idx,
        label,
        points: pointsPerOption[idx],
        firstPlaceVotes: firstPlaceVotes[idx],
        percentage:
          totalResponses > 0 ? Math.round((pointsPerOption[idx] / maxPossiblePoints) * 100) : 0,
      }))
      .sort((a, b) => b.points - a.points);

    return {
      totalAnswers: totalResponses,
      uniqueResponders,
      rankedItems,
    };
  }

  // 6. Rating (1..maxStars)
  if (qType === 'rating') {
    const maxStars = Number(question.config?.maxStars) || 5;
    const distribution = new Array(maxStars).fill(0);
    let sum = 0;
    let count = 0;

    for (const a of allAnswers) {
      const val = Number(a.selected_index);
      if (val >= 1 && val <= maxStars) {
        distribution[val - 1]++;
        sum += val;
        count++;
      }
    }

    const average = count > 0 ? (sum / count).toFixed(1) : '0.0';
    return {
      totalAnswers: count,
      uniqueResponders,
      maxStars,
      average: Number(average),
      distribution,
      distributionPercentages: distribution.map((c) =>
        count > 0 ? Math.round((c / count) * 100) : 0
      ),
    };
  }

  // 7. Survey (Multi-question self-paced)
  if (qType === 'survey') {
    const subQuestions = question.config?.surveyQuestions || [];
    const resultsPerSub = subQuestions.map((sq) => {
      if (sq.type === 'rating') {
        const maxStars = Number(sq.maxStars) || 5;
        let sum = 0;
        let cnt = 0;
        for (const a of allAnswers) {
          try {
            const map = JSON.parse(a.response_json || '{}');
            const val = Number(map[sq.id]);
            if (val >= 1 && val <= maxStars) {
              sum += val;
              cnt++;
            }
          } catch (e) {}
        }
        return {
          id: sq.id,
          text: sq.text,
          type: sq.type,
          average: cnt > 0 ? Number((sum / cnt).toFixed(1)) : 0,
          maxStars,
          count: cnt,
        };
      }
      if (sq.type === 'poll') {
        const opts = sq.options || [];
        const counts = new Array(opts.length).fill(0);
        let cnt = 0;
        for (const a of allAnswers) {
          try {
            const map = JSON.parse(a.response_json || '{}');
            const idx = Number(map[sq.id]);
            if (idx >= 0 && idx < opts.length) {
              counts[idx]++;
              cnt++;
            }
          } catch (e) {}
        }
        return {
          id: sq.id,
          text: sq.text,
          type: sq.type,
          options: opts,
          counts,
          percentages: counts.map((c) => (cnt > 0 ? Math.round((c / cnt) * 100) : 0)),
          count: cnt,
        };
      }
      // opentext
      const comments = [];
      for (const a of allAnswers) {
        try {
          const map = JSON.parse(a.response_json || '{}');
          if (map[sq.id] && String(map[sq.id]).trim()) {
            comments.push({
              text: String(map[sq.id]).trim(),
              author: a.participant_name || 'Participante',
            });
          }
        } catch (e) {}
      }
      return {
        id: sq.id,
        text: sq.text,
        type: sq.type,
        comments: comments.slice(0, 20),
        count: comments.length,
      };
    });

    return {
      totalAnswers: totalResponses,
      uniqueResponders,
      surveyResults: resultsPerSub,
    };
  }

  return { totalAnswers: totalResponses, uniqueResponders };
}

/**
 * Exports all Live Quizzes that have competitive 'quiz' answers as rounds for the Leaderboard
 */
export function getLiveQuizzesAsRoundsMap() {
  const db = getDb();
  const quizzes = db.prepare('SELECT * FROM quizzes ORDER BY created_at ASC').all();
  const roundsMap = {};

  for (const quiz of quizzes) {
    const quizQuestions = db
      .prepare("SELECT points_multiplier FROM questions WHERE quiz_id = ? AND type = 'quiz'")
      .all(quiz.id);
    if (quizQuestions.length === 0) continue;

    const maxPossibleScore = quizQuestions.reduce(
      (acc, q) => acc + (Number(q.points_multiplier) || 1),
      0
    );

    const aggregated = db
      .prepare(`
        SELECT
          p.id as userId,
          p.name as userName,
          p.team_name as teamName,
          SUM(CASE WHEN a.points_awarded > 0 THEN a.points_awarded ELSE a.is_correct END) as score,
          SUM(a.time_ms) as timeMs,
          COUNT(a.id) as answeredCount
        FROM answers a
        JOIN questions q ON q.id = a.question_id
        JOIN participants p ON p.id = a.participant_id
        WHERE a.quiz_id = ? AND q.type = 'quiz'
        GROUP BY p.id
      `)
      .all(quiz.id);

    if (aggregated.length === 0) continue;

    const sorted = aggregated.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.timeMs - b.timeMs;
    });

    roundsMap[quiz.id] = {
      quizId: quiz.id,
      quizName: quiz.title,
      sourceFile: `Quiz Ao Vivo (${quiz.code})`,
      uploadedAt: quiz.created_at,
      rows: sorted.map((r, idx) => ({
        userId: r.userId,
        userName: r.userName,
        teamName: r.teamName || '',
        rank: idx + 1,
        score: Number(r.score) || 0,
        maxScore: maxPossibleScore,
        timeMs: Number(r.timeMs) || 0,
        quizId: quiz.id,
        quizName: quiz.title,
        sourceFile: `Quiz Ao Vivo (${quiz.code})`,
      })),
    };
  }

  return roundsMap;
}

/**
 * Computes FNAC Store / Team Battle Standings ("Batalha de Lojas / Equipas")
 */
export function getTeamStandings(individualStandings = []) {
  const db = getDb();
  const participantTeams = new Map();
  const rows = db.prepare("SELECT normalized_key, team_name FROM participants WHERE team_name != ''").all();
  for (const r of rows) {
    participantTeams.set(r.normalized_key, r.team_name);
  }
  const rosterRows = db.prepare("SELECT normalized_key, team_name FROM roster WHERE team_name != ''").all();
  for (const r of rosterRows) {
    if (!participantTeams.has(r.normalized_key)) {
      participantTeams.set(r.normalized_key, r.team_name);
    }
  }

  const teamsMap = new Map();
  for (const player of individualStandings) {
    const teamName = player.teamName || participantTeams.get(player.key) || '';
    if (!teamName) continue;

    const current = teamsMap.get(teamName) || {
      teamName,
      membersCount: 0,
      totalScore: 0,
      totalMaxScore: 0,
      totalTimeMs: 0,
      topMemberName: player.name,
      topMemberScore: player.score,
    };

    current.membersCount += 1;
    current.totalScore += player.score;
    current.totalMaxScore += player.maxScore || 12;
    current.totalTimeMs += player.timeMs;
    teamsMap.set(teamName, current);
  }

  return Array.from(teamsMap.values())
    .map((t) => {
      const avgScore = t.membersCount > 0 ? Number((t.totalScore / t.membersCount).toFixed(1)) : 0;
      const avgTimeMs = t.membersCount > 0 ? Math.round(t.totalTimeMs / t.membersCount) : 0;
      return {
        ...t,
        avgScore,
        avgTimeMs,
        displayAvgTime: formatMilliseconds(avgTimeMs),
        displayTotalTime: formatMilliseconds(t.totalTimeMs),
      };
    })
    .sort((a, b) => {
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
      return a.avgTimeMs - b.avgTimeMs;
    })
    .map((t, idx) => ({
      position: idx + 1,
      ...t,
    }));
}

export function getQuizStandings(quizId) {
  const db = getDb();
  const quizQuestions = db
    .prepare("SELECT points_multiplier FROM questions WHERE quiz_id = ? AND type = 'quiz'")
    .all(quizId);
  const maxPossibleScore =
    quizQuestions.reduce((acc, q) => acc + (Number(q.points_multiplier) || 1), 0) || 1;

  const rows = db
    .prepare(`
      SELECT
        p.id as participantId,
        p.name as name,
        p.team_name as teamName,
        SUM(CASE WHEN a.points_awarded > 0 THEN a.points_awarded ELSE a.is_correct END) as score,
        SUM(a.time_ms) as timeMs,
        COUNT(a.id) as answeredCount
      FROM answers a
      JOIN questions q ON q.id = a.question_id
      JOIN participants p ON p.id = a.participant_id
      WHERE a.quiz_id = ? AND q.type = 'quiz'
      GROUP BY p.id
    `)
    .all(quizId);

  return rows
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.timeMs - b.timeMs;
    })
    .map((r, idx) => ({
      position: idx + 1,
      participantId: r.participantId,
      name: r.name,
      teamName: r.teamName || '',
      score: Number(r.score) || 0,
      maxScore: maxPossibleScore,
      timeMs: Number(r.timeMs) || 0,
      displayTime: formatMilliseconds(Number(r.timeMs) || 0),
      exactSeconds: `${((Number(r.timeMs) || 0) / 1000).toFixed(2)}s`,
      answeredCount: Number(r.answeredCount) || 0,
    }));
}

export function getFullLiveState({ participantId = '', requestHost = '', requestProto = 'http' } = {}) {
  const db = getDb();
  const live = db.prepare('SELECT * FROM live_state WHERE id = 1').get();
  const allQuizzes = db
    .prepare('SELECT * FROM quizzes ORDER BY created_at DESC')
    .all()
    .map((q) => {
      const qList = db
        .prepare('SELECT * FROM questions WHERE quiz_id = ? ORDER BY order_index ASC')
        .all(q.id)
        .map((item) => ({
          id: item.id,
          quizId: item.quiz_id,
          orderIndex: item.order_index,
          text: item.text,
          type: item.type || 'quiz',
          options: JSON.parse(item.options_json || '[]'),
          correctIndex: item.correct_index,
          timeLimitSec: item.time_limit_sec,
          pointsMultiplier: item.points_multiplier || 1,
          imageUrl: item.image_url || '',
          imageRevealMode: item.image_reveal_mode || 'none',
          config: JSON.parse(item.config_json || '{}'),
        }));
      const answersCount =
        db.prepare('SELECT COUNT(*) as c FROM answers WHERE quiz_id = ?').get(q.id)?.c || 0;
      return {
        ...q,
        questions: qList,
        answersCount,
      };
    });

  const activeQuiz =
    allQuizzes.find((q) => q.id === live.active_quiz_id) || allQuizzes[0] || null;

  const questions = activeQuiz ? activeQuiz.questions : [];
  const currentIdx = Math.min(
    Math.max(0, live.current_question_index || 0),
    Math.max(0, questions.length - 1)
  );
  const currentQuestion = questions[currentIdx] || null;

  const nowMs = Date.now();
  let timeRemainingMs = 0;
  let elapsedMs = 0;

  if (currentQuestion && live.status === 'question_open') {
    const durationMs = (currentQuestion.timeLimitSec || 20) * 1000;
    elapsedMs = Math.max(0, nowMs - (live.question_started_at || nowMs));
    timeRemainingMs = Math.max(0, durationMs - elapsedMs);
  }

  const questionStats = buildQuestionLiveAggregation(db, currentQuestion, participantId);

  const allParticipants = db
    .prepare(
      'SELECT id, name, employee_id, team_name as teamName, last_seen_at FROM participants ORDER BY last_seen_at DESC'
    )
    .all();

  let myParticipant = null;
  let myAnswer = null;
  let mySubmissionsCount = 0;

  if (participantId) {
    myParticipant = db
      .prepare(
        'SELECT id, name, employee_id as employeeId, team_name as teamName FROM participants WHERE id = ?'
      )
      .get(participantId);

    if (myParticipant && currentQuestion) {
      const myRows = db
        .prepare(
          'SELECT selected_index, is_correct, points_awarded, time_ms, response_text, response_json FROM answers WHERE question_id = ? AND participant_id = ? ORDER BY created_at DESC'
        )
        .all(currentQuestion.id, participantId);

      mySubmissionsCount = myRows.length;
      if (myRows.length > 0) {
        const ans = myRows[0];
        let parsedJson = {};
        try {
          parsedJson = JSON.parse(ans.response_json || '{}');
        } catch (e) {}
        myAnswer = {
          selectedIndex: ans.selected_index,
          isCorrect: live.status === 'question_reveal' ? Boolean(ans.is_correct) : null,
          pointsAwarded: live.status === 'question_reveal' ? ans.points_awarded : null,
          timeMs: ans.time_ms,
          displayTime: `${(ans.time_ms / 1000).toFixed(2)}s`,
          responseText: ans.response_text || '',
          responseJson: parsedJson,
          submissionsCount: mySubmissionsCount,
        };
      }
    }
  }

  const lanIp = getLanIpAddress();
  const port = requestHost.includes(':') ? requestHost.split(':')[1] : process.env.PORT || '4321';
  const hostOnly = (requestHost || '').split(':')[0].toLowerCase();
  const isLocalLoopback = !hostOnly || hostOnly === 'localhost' || hostOnly === '127.0.0.1' || hostOnly === '0.0.0.0';
  const envPublicUrl = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  const autoBaseUrl =
    envPublicUrl || (!isLocalLoopback ? `${requestProto}://${requestHost}` : `http://${lanIp}:${port}`);
  const baseUrl = (live.public_base_url || '').trim().replace(/\/+$/, '') || autoBaseUrl;
  const joinUrl = `${baseUrl}/play`;

  let qrSvg = '';
  try {
    qrSvg = generateQrCodeSvg(joinUrl, 2);
  } catch (e) {
    console.error('Erro QR:', e);
  }

  const quizStandings = activeQuiz ? getQuizStandings(activeQuiz.id) : [];

  return {
    serverNow: nowMs,
    status: live.status,
    leaderboardMode: live.leaderboard_mode || 'individual',
    fnacTeams: FNAC_TEAMS,
    activeQuizId: activeQuiz ? activeQuiz.id : null,
    activeQuiz: activeQuiz
      ? {
          id: activeQuiz.id,
          code: activeQuiz.code,
          title: activeQuiz.title,
          description: activeQuiz.description,
          totalQuestions: questions.length,
        }
      : null,
    allQuizzes,
    currentQuestionIndex: currentIdx,
    questionStartedAt: live.question_started_at,
    timeRemainingMs,
    countdownStep: live.countdown_step,
    publicBaseUrl: live.public_base_url || '',
    autoDetectedUrl: autoBaseUrl,
    joinUrl,
    qrSvg,
    includeImportedRounds: Boolean(live.include_imported_rounds),
    currentQuestion: currentQuestion
      ? {
          id: currentQuestion.id,
          orderIndex: currentQuestion.orderIndex,
          number: currentIdx + 1,
          total: questions.length,
          text: currentQuestion.text,
          type: currentQuestion.type,
          options: currentQuestion.options,
          timeLimitSec: currentQuestion.timeLimitSec,
          pointsMultiplier: currentQuestion.pointsMultiplier,
          imageUrl: currentQuestion.imageUrl,
          imageRevealMode: currentQuestion.imageRevealMode,
          config: currentQuestion.config,
          correctIndex: currentQuestion.correctIndex,
        }
      : null,
    questionStats,
    participantsCount: allParticipants.length,
    participants: allParticipants.slice(0, 60),
    rosterCount: db.prepare('SELECT COUNT(*) as c FROM roster').get()?.c || 0,
    quizStandings,
    myParticipant,
    myAnswer,
  };
}

export function executeHostAction(body) {
  const db = getDb();
  const live = db.prepare('SELECT * FROM live_state WHERE id = 1').get();
  const { action } = body;

  if (action === 'set_status') {
    const { status, leaderboardMode } = body;
    if (leaderboardMode) {
      db.prepare('UPDATE live_state SET leaderboard_mode = ? WHERE id = 1').run(leaderboardMode);
    }
    if (status === 'question_open') {
      db.prepare('UPDATE live_state SET status = ?, question_started_at = ? WHERE id = 1').run(
        status,
        Date.now()
      );
    } else if (status) {
      db.prepare('UPDATE live_state SET status = ? WHERE id = 1').run(status);
    }
  } else if (action === 'open_question') {
    const qIdx = Number(body.questionIndex ?? 0);
    db.prepare(
      'UPDATE live_state SET status = ?, current_question_index = ?, question_started_at = ? WHERE id = 1'
    ).run('question_open', qIdx, Date.now());
  } else if (action === 'reveal_answer') {
    db.prepare('UPDATE live_state SET status = ? WHERE id = 1').run('question_reveal');
  } else if (action === 'next_question') {
    const qCount =
      db
        .prepare('SELECT COUNT(*) as c FROM questions WHERE quiz_id = ?')
        .get(live.active_quiz_id)?.c || 0;
    const nextIdx = (live.current_question_index || 0) + 1;
    if (nextIdx < qCount) {
      db.prepare(
        'UPDATE live_state SET status = ?, current_question_index = ?, question_started_at = ? WHERE id = 1'
      ).run('question_open', nextIdx, Date.now());
    } else {
      db.prepare('UPDATE live_state SET status = ? WHERE id = 1').run('leaderboard');
    }
  } else if (action === 'select_quiz') {
    const { quizId } = body;
    db.prepare(
      'UPDATE live_state SET active_quiz_id = ?, status = ?, current_question_index = 0, countdown_step = -1 WHERE id = 1'
    ).run(quizId, 'lobby');
  } else if (action === 'create_quiz') {
    const quizId = `quiz-${Date.now()}`;
    const code = (body.code || 'FNAC26').toUpperCase().trim();
    const title = (body.title || 'Nova Sessão Interativa').trim();
    db.prepare(
      'INSERT INTO quizzes (id, code, title, description, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(quizId, code, title, body.description || '', new Date().toISOString());
    db.prepare(
      'UPDATE live_state SET active_quiz_id = ?, status = ?, current_question_index = 0 WHERE id = 1'
    ).run(quizId, 'lobby');
  } else if (action === 'delete_quiz') {
    const { quizId } = body;
    db.prepare('DELETE FROM quizzes WHERE id = ?').run(quizId);
    const remaining = db.prepare('SELECT id FROM quizzes ORDER BY created_at DESC LIMIT 1').get();
    db.prepare('UPDATE live_state SET active_quiz_id = ?, status = ? WHERE id = 1').run(
      remaining ? remaining.id : null,
      'lobby'
    );
  } else if (action === 'save_question') {
    const {
      questionId,
      quizId,
      text,
      type = 'quiz',
      options = [],
      correctIndex = 0,
      timeLimitSec = 20,
      pointsMultiplier = 1,
      imageUrl = '',
      imageRevealMode = 'none',
      config = {},
    } = body;

    const targetQuizId = quizId || live.active_quiz_id;
    const cleanOptions = Array.isArray(options)
      ? options.map((o) => String(o).trim()).filter(Boolean)
      : [];

    if (questionId) {
      db.prepare(`
        UPDATE questions
        SET text = ?, type = ?, options_json = ?, correct_index = ?, time_limit_sec = ?, points_multiplier = ?, image_url = ?, image_reveal_mode = ?, config_json = ?
        WHERE id = ?
      `).run(
        text.trim(),
        type,
        JSON.stringify(cleanOptions),
        Number(correctIndex) || 0,
        Number(timeLimitSec) || 20,
        Number(pointsMultiplier) || 1,
        String(imageUrl || '').trim(),
        String(imageRevealMode || 'none'),
        JSON.stringify(config || {}),
        questionId
      );
    } else {
      const maxOrder =
        db
          .prepare('SELECT COALESCE(MAX(order_index), -1) as m FROM questions WHERE quiz_id = ?')
          .get(targetQuizId)?.m ?? -1;
      const newId = `q-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
      db.prepare(`
        INSERT INTO questions (id, quiz_id, order_index, text, type, options_json, correct_index, time_limit_sec, points_multiplier, image_url, image_reveal_mode, config_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId,
        targetQuizId,
        maxOrder + 1,
        text.trim(),
        type,
        JSON.stringify(cleanOptions),
        Number(correctIndex) || 0,
        Number(timeLimitSec) || 20,
        Number(pointsMultiplier) || 1,
        String(imageUrl || '').trim(),
        String(imageRevealMode || 'none'),
        JSON.stringify(config || {})
      );
    }
  } else if (action === 'delete_question') {
    const { questionId } = body;
    const qRow = db.prepare('SELECT quiz_id FROM questions WHERE id = ?').get(questionId);
    db.prepare('DELETE FROM questions WHERE id = ?').run(questionId);
    if (qRow) {
      const rem = db
        .prepare('SELECT id FROM questions WHERE quiz_id = ? ORDER BY order_index ASC')
        .all(qRow.quiz_id);
      const upd = db.prepare('UPDATE questions SET order_index = ? WHERE id = ?');
      rem.forEach((r, idx) => upd.run(idx, r.id));
    }
  } else if (action === 'reset_quiz_answers') {
    const targetQuizId = body.quizId || live.active_quiz_id;
    db.prepare('DELETE FROM answers WHERE quiz_id = ?').run(targetQuizId);
    db.prepare(
      'UPDATE live_state SET status = ?, current_question_index = 0, countdown_step = -1 WHERE id = 1'
    ).run('lobby');
  } else if (action === 'set_network_config') {
    if (typeof body.publicBaseUrl === 'string') {
      db.prepare('UPDATE live_state SET public_base_url = ? WHERE id = 1').run(
        body.publicBaseUrl.trim()
      );
    }
    if (typeof body.includeImportedRounds === 'boolean') {
      db.prepare('UPDATE live_state SET include_imported_rounds = ? WHERE id = 1').run(
        body.includeImportedRounds ? 1 : 0
      );
    }
  } else if (action === 'add_roster') {
    addRosterNames(body.rawText || '');
  }
}

/**
 * Generates a full multi-sheet .xlsx export of Individual Leaderboard, FNAC Teams Leaderboard, and All Interaction Responses
 */
export function generateFullExportXlsx(leaderboard) {
  const db = getDb();
  const standings = leaderboard?.standings || [];
  const teamStandings = getTeamStandings(standings);

  // Sheet 1: Slido-compatible Individual Leaderboard
  const sheet1Rows = [
    ['User ID', 'User Name', 'Loja / Equipa', 'Rank', 'Score', 'Max Score', 'Milliseconds', 'Display Time', 'Entries'],
    ...standings.map((p) => [
      p.key,
      p.name,
      p.teamName || '',
      p.position,
      p.score,
      p.maxScore || 12,
      p.timeMs,
      p.displayTime,
      p.entriesCount || 1,
    ]),
  ];

  // Sheet 2: FNAC Teams / Stores Battle
  const sheet2Rows = [
    ['Posição', 'Loja / Equipa FNAC', 'Nº Participantes', 'Média de Pontos', 'Pontos Totais', 'Tempo Médio'],
    ...teamStandings.map((t) => [
      t.position,
      t.teamName,
      t.membersCount,
      t.avgScore,
      t.totalScore,
      t.displayAvgTime,
    ]),
  ];

  // Sheet 3: All Responses across all 8 Interaction Models
  const allResponses = db
    .prepare(`
      SELECT
        q.title as quiz_title,
        qu.order_index + 1 as q_num,
        qu.type as q_type,
        qu.text as q_text,
        qu.options_json as options_json,
        p.name as participant_name,
        p.team_name as team_name,
        a.selected_index,
        a.is_correct,
        a.points_awarded,
        a.time_ms,
        a.response_text,
        a.response_json,
        a.created_at
      FROM answers a
      JOIN quizzes q ON q.id = a.quiz_id
      JOIN questions qu ON qu.id = a.question_id
      LEFT JOIN participants p ON p.id = a.participant_id
      ORDER BY a.created_at DESC
    `)
    .all();

  const sheet3Rows = [
    ['Sessão', 'Nº', 'Tipo', 'Pergunta / Atividade', 'Participante', 'Loja / Equipa', 'Resposta', 'Pontos', 'Tempo (ms)', 'Data/Hora'],
    ...allResponses.map((r) => {
      let answerFormatted = r.response_text || '';
      if (!answerFormatted && r.selected_index >= 0) {
        try {
          const opts = JSON.parse(r.options_json || '[]');
          answerFormatted = opts[r.selected_index] ?? String(r.selected_index);
        } catch (e) {
          answerFormatted = String(r.selected_index);
        }
      }
      if (!answerFormatted && r.response_json && r.response_json !== '{}') {
        answerFormatted = r.response_json;
      }
      return [
        r.quiz_title,
        r.q_num,
        r.q_type.toUpperCase(),
        r.q_text,
        r.participant_name || 'Anónimo',
        r.team_name || '',
        answerFormatted,
        r.points_awarded || 0,
        r.time_ms || 0,
        r.created_at,
      ];
    }),
  ];

  return buildXlsxWorkbook([
    { name: 'Classificacao Individual', rows: sheet1Rows },
    { name: 'Ranking Lojas FNAC', rows: sheet2Rows },
    { name: 'Todas as Interacoes', rows: sheet3Rows },
  ]);
}
