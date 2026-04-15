import mongoose from 'mongoose';

const enrollmentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  discount: { type: Number, default: 0 },
  discountType: { type: String, enum: ['amount', 'percentage'], default: 'amount' },
  status: { type: String, enum: ['active', 'promoted', 'failed', 'left'], default: 'active' }
}, { timestamps: true });

enrollmentSchema.index({ studentId: 1, batchId: 1 }, { unique: true });

enrollmentSchema.pre('validate', function(next) {
  const hasTeacher = Boolean(this.teacherId);
  const hasOrg = Boolean(this.organizationId);
  if (hasTeacher === hasOrg) {
    return next(new Error('Enrollment must belong to exactly one owner: teacherId or organizationId'));
  }
  next();
});

export default mongoose.model('Enrollment', enrollmentSchema);
