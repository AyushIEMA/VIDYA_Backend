import express from 'express';
import { authenticate } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import Review from '../models/Review.js';

const router = express.Router();

router.get('/:id/reviews', authenticate, async (req, res) => {
  try {
    const reviews = await Review.find({ batchId: req.params.id }).sort({ createdAt: -1 });
    const avgRating = reviews.length > 0 
      ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length 
      : 0;
    res.json({ reviews, avgRating });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
