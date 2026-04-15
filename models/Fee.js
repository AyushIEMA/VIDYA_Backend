import mongoose from 'mongoose';

const feeSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  originalAmount: { type: Number, required: true },
  discount: { type: Number, default: 0 },
  amount: { type: Number, required: true },
  month: { type: String, required: true },
  year: { type: Number, required: true },
  status: { type: String, enum: ['paid', 'pending'], default: 'pending' },
  paidAt: { type: Date }
}, { timestamps: true });

feeSchema.index({ studentId: 1, batchId: 1, month: 1, year: 1 }, { unique: true });

feeSchema.pre('validate', function(next) {
  const hasTeacher = Boolean(this.teacherId);
  const hasOrg = Boolean(this.organizationId);
  if (hasTeacher === hasOrg) {
    return next(new Error('Fee must belong to exactly one owner: teacherId or organizationId'));
  }
  next();
});

export default mongoose.model('Fee', feeSchema);
