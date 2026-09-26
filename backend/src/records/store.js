// Phase 6：战绩/个人作画记录的持久化写入（见 FULLREADME.md 第15节）。
// 只负责"局结束时怎么落库"，不涉及查询/展示——查询接口在 backend/src/routes/records.js。
//
// 调用方（game/engine.js 的 endGame、chain/engine.js 的 endGame）在计算完 scores 之后、
// 销毁内存 session 之前调用 recordGameSession，一次性把这一局的 game_records + drawings
// 落到 SQLite。两种模式共用同一个函数——它们的输入形状（scores 累计分、drawings 明细）
// 从各自 engine 里已经能拼出来，落库逻辑本身和模式无关。
'use strict';

const db = require('../db/init');

const insertRecordStmt = db.prepare(
  'INSERT INTO game_records (user_id, room_id, mode, score) VALUES (?, ?, ?, ?)'
);
const insertDrawingStmt = db.prepare(
  'INSERT INTO drawings (user_id, game_record_id, stroke_data) VALUES (?, ?, ?)'
);

// scores: { [userId]: number } —— 这一局每个玩家的累计得分（不区分是否中途退出，
//   中途退出的玩家在各自 engine 里已经从 turnOrder 移除，不会出现在这里）。
// drawings: [{ userId, word, actions }] —— 这一局里产生过的每一次"完整的一笔画"
//   （竞猜模式一回合一条，接龙模式每条链每次轮到画一条）；actions 为空数组的条目会被跳过，
//   不落一条空白记录进去。
// 返回 { recordIdByUserId: Map<number, number> }，调用方目前用不到，但留着方便以后扩展
// （比如结算页展示"本局作画记录"链接时可以直接用这份 id，不必再查一遍）。
function recordGameSession({ roomId, mode, scores, drawings = [] }) {
  const scoreEntries = Object.entries(scores || {});
  if (scoreEntries.length === 0) return { recordIdByUserId: new Map() };

  const tx = db.transaction(() => {
    const recordIdByUserId = new Map();
    for (const [userIdStr, score] of scoreEntries) {
      const userId = Number(userIdStr);
      const info = insertRecordStmt.run(userId, roomId, mode, score);
      recordIdByUserId.set(userId, info.lastInsertRowid);
    }
    for (const entry of drawings) {
      if (!entry || !Array.isArray(entry.actions) || entry.actions.length === 0) continue;
      const gameRecordId = recordIdByUserId.get(entry.userId) || null;
      const strokeData = JSON.stringify({ word: entry.word || null, actions: entry.actions });
      insertDrawingStmt.run(entry.userId, gameRecordId, strokeData);
    }
    return recordIdByUserId;
  });

  const recordIdByUserId = tx();
  return { recordIdByUserId };
}

module.exports = { recordGameSession };
