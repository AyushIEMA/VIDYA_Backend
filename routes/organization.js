import express from 'express';
import { authenticate } from '../middleware/auth.js';
import Organization from '../models/Organization.js';
import Batch from '../models/Batch.js';

const router = express.Router();

// Student: search organization by code (requires login to keep abuse down)
router.post('/search', authenticate, async (req, res) => {
  try {
    const organizationCode = String(req.body?.organizationCode || '').trim().toUpperCase();
    if (!organizationCode) return res.status(400).json({ error: 'organizationCode is required' });
    const org = await Organization.findOne({ organizationCode });
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json(org);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Student: list batches for org (pagination + filters)
router.get('/:orgId/batches', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, class: cls, subject, board } = req.query;
    const query = { organizationId: req.params.orgId };
    if (search) query.batchName = { $regex: search, $options: 'i' };
    if (cls) query.class = cls;
    if (board) query.board = board;
    if (subject) {
      const s = String(subject).trim();
      if (s) query.subjects = { $elemMatch: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } };
    }

    const batches = await Batch.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10))
      .sort({ createdAt: -1 });

    const total = await Batch.countDocuments(query);
    res.json({ batches, total, pages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

