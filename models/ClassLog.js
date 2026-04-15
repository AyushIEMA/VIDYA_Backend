import mongoose from 'mongoose';

const classLogSchema = new mongoose.Schema({
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  orgTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  title: { type: String, required: true },
  description: { type: String },
  date: { type: Date, default: Date.now }
}, { timestamps: true });

export default mongoose.model('ClassLog', classLogSchema);
