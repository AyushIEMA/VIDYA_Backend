import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comment: { type: String }
}, { timestamps: true });

export default mongoose.model('Review', reviewSchema);
