import mongoose from 'mongoose';

const orgTeacherSalarySchema = new mongoose.Schema(
  {
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    orgTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    month: { type: String, required: true },
    year: { type: Number, required: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['paid', 'pending'], default: 'pending' },
    paidAt: { type: Date }
  },
  { timestamps: true }
);

orgTeacherSalarySchema.index({ organizationId: 1, orgTeacherId: 1, batchId: 1, month: 1, year: 1 }, { unique: true });

export default mongoose.model('OrgTeacherSalary', orgTeacherSalarySchema);

