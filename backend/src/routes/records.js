// Phase 6：战绩历史 / 排行榜 / 个人作画记录的只读查询接口（见 FULLREADME.md 第15节）。
// 写入侧在 backend/src/records/store.js（局结束时由各自 engine 调用），这里只负责查询、
// 不做任何写操作。全部接口都要求登录——本项目所有 REST 接口在前端都是登录后才会被访问到的
// 页面（路由守卫见 frontend/src/router/index.js），这里在后端也一并收紧，不依赖前端单侧校验。
'use strict';

const express = require('express');
const db = require('../db/init');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const MODES = ['guess', 'chain'];
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 50;
const DEFAULT_LEADERBOARD_LIMIT = 20;
const MAX_LEADERBOARD_LIMIT = 50;

// 分页参数统一解析：limit 缺省/越界都夹到 [1, max] 之间，offset 非法值当 0，避免拼出奇怪的 SQL。
function parsePaging(query, { defaultLimit, maxLimit }) {
  let limit = parseInt(query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  if (limit > maxLimit) limit = maxLimit;

  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  return { limit, offset };
}

function parseModeFilter(query) {
  const { mode } = query;
  if (!mode) return null;
  if (!MODES.includes(mode)) return undefined; // undefined 表示非法值，调用方据此返回 400
  return mode;
}

// GET /api/records/me —— 个人战绩历史（分页），按对局时间倒序
router.get('/me', (req, res) => {
  const mode = parseModeFilter(req.query);
  if (mode === undefined) {
    return res.status(400).json({ error: 'INVALID_MODE', message: 'mode 必须是 guess 或 chain' });
  }
  const { limit, offset } = parsePaging(req.query, {
    defaultLimit: DEFAULT_LIST_LIMIT,
    maxLimit: MAX_LIST_LIMIT,
  });

  const whereClause = mode ? 'WHERE user_id = ? AND mode = ?' : 'WHERE user_id = ?';
  const params = mode ? [req.user.id, mode] : [req.user.id];

  const total = db.prepare(`SELECT COUNT(*) AS c FROM game_records ${whereClause}`).get(...params).c;
  const records = db
    .prepare(
      `SELECT id, room_id AS roomId, mode, score, played_at AS playedAt
       FROM game_records ${whereClause}
       ORDER BY played_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);

  res.json({ records, total, limit, offset });
});

// GET /api/records/leaderboard —— 总分排行榜（按 SUM(score) 聚合），附带当前用户的排名
router.get('/leaderboard', (req, res) => {
  const mode = parseModeFilter(req.query);
  if (mode === undefined) {
    return res.status(400).json({ error: 'INVALID_MODE', message: 'mode 必须是 guess 或 chain' });
  }
  const { limit } = parsePaging(req.query, {
    defaultLimit: DEFAULT_LEADERBOARD_LIMIT,
    maxLimit: MAX_LEADERBOARD_LIMIT,
  });

  const whereClause = mode ? 'WHERE gr.mode = ?' : '';
  const params = mode ? [mode] : [];

  // 只按用户量级不大的小规模部署场景设计：一次性把全部有过战绩的用户聚合出来，
  // 在 JS 里既截取排行榜前 N 名、又定位当前用户的名次，不必为"查自己排第几"再单独发一条
  // "COUNT 比我分高的人数" SQL——数据量大了以后（这不是本 Phase 的预期场景）需要重新评估。
  const all = db
    .prepare(
      `SELECT u.id AS userId, u.username AS username,
              COALESCE(SUM(gr.score), 0) AS totalScore,
              COUNT(gr.id) AS gamesPlayed
       FROM game_records gr
       JOIN users u ON u.id = gr.user_id
       ${whereClause}
       GROUP BY gr.user_id
       ORDER BY totalScore DESC, gamesPlayed DESC, userId ASC`
    )
    .all(...params);

  const leaderboard = all.slice(0, limit).map((row, i) => ({ ...row, rank: i + 1 }));

  const myIndex = all.findIndex((row) => row.userId === req.user.id);
  const me =
    myIndex === -1
      ? null
      : { ...all[myIndex], rank: myIndex + 1 };

  res.json({ leaderboard, me, mode: mode || 'all' });
});

// GET /api/records/drawings —— 个人作画记录列表（不含完整笔迹，只用于列表缩略展示的元信息）
router.get('/drawings', (req, res) => {
  const { limit, offset } = parsePaging(req.query, {
    defaultLimit: DEFAULT_LIST_LIMIT,
    maxLimit: MAX_LIST_LIMIT,
  });

  const total = db.prepare('SELECT COUNT(*) AS c FROM drawings WHERE user_id = ?').get(req.user.id).c;
  const drawings = db
    .prepare(
      `SELECT d.id AS id,
              d.created_at AS createdAt,
              json_extract(d.stroke_data, '$.word') AS word,
              gr.mode AS mode,
              gr.room_id AS roomId,
              gr.score AS score
       FROM drawings d
       LEFT JOIN game_records gr ON gr.id = d.game_record_id
       WHERE d.user_id = ?
       ORDER BY d.created_at DESC, d.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(req.user.id, limit, offset);

  res.json({ drawings, total, limit, offset });
});

// GET /api/records/drawings/:id —— 单条作画记录详情（含完整笔迹，用于前端回放/放大预览）
router.get('/drawings/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'INVALID_ID', message: '无效的记录 id' });
  }

  const row = db
    .prepare(
      `SELECT d.id AS id,
              d.user_id AS userId,
              d.created_at AS createdAt,
              d.stroke_data AS strokeData,
              gr.mode AS mode,
              gr.room_id AS roomId,
              gr.score AS score
       FROM drawings d
       LEFT JOIN game_records gr ON gr.id = d.game_record_id
       WHERE d.id = ?`
    )
    .get(id);

  // 不存在 / 不是自己的记录：统一返回 404，不区分"不存在"和"是别人的"，避免用 id 递增探测
  // 出"这个 id 存在，只是不是我的"这种信息（虽然 id 本身没什么敏感性，但没理由多暴露）。
  if (!row || row.userId !== req.user.id) {
    return res.status(404).json({ error: 'NOT_FOUND', message: '作画记录不存在' });
  }

  let parsed;
  try {
    parsed = JSON.parse(row.strokeData);
  } catch (err) {
    return res.status(500).json({ error: 'CORRUPT_DATA', message: '作画记录数据损坏' });
  }

  res.json({
    id: row.id,
    createdAt: row.createdAt,
    mode: row.mode,
    roomId: row.roomId,
    score: row.score,
    word: parsed.word,
    actions: parsed.actions,
  });
});

module.exports = router;
