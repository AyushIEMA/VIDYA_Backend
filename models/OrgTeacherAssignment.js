import mongoose from 'mongoose';

const orgTeacherAssignmentSchema = new mongoose.Schema(
  {
    orgTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true }
  },
  { timestamps: true }
);

orgTeacherAssignmentSchema.index({ orgTeacherId: 1, batchId: 1 }, { unique: true });

export default mongoose.model('OrgTeacherAssignment', orgTeacherAssignmentSchema);

