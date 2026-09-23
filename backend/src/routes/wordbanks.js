'use strict';

const express = require('express');
const { listCategories } = require('../wordbanks');

const router = express.Router();

// GET /api/wordbanks —— 房间设置页"系统出题"下拉列表用
router.get('/', (req, res) => {
  res.json({ categories: listCategories() });
});

module.exports = router;
