'use strict';

const express = require('express');
const store = require('../rooms/store');

const router = express.Router();

// GET /api/rooms/public?mode=guess|chain —— 加入房间-公开房间列表页用，不返回邀请码
router.get('/public', (req, res) => {
  const { mode } = req.query;
  if (mode && mode !== 'guess' && mode !== 'chain') {
    return res.status(400).json({ error: 'INVALID_MODE', message: 'mode 必须是 guess 或 chain' });
  }
  res.json({ rooms: store.listPublicRooms(mode) });
});

module.exports = router;
