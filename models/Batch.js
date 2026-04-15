import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  teachers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  batchName: { type: String, required: true },
  class: { type: String, required: true },
  board: { type: String, required: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  subjects: [{ type: String }],
  days: [{ type: String }],
  /** Per-day start times; when set, takes precedence over single startTime for display/conflicts */
  schedule: [{ day: { type: String }, startTime: { type: String } }],
  startTime: { type: String, default: '' },
  fees: { type: Number, default: 0 },
  notes: [{ url: String, name: String, uploadedAt: Date }],
  syllabus: [{ url: String, name: String, uploadedAt: Date }]
}, { timestamps: true });

batchSchema.pre('validate', function(next) {
  // Require either individual teacher OR organization owner (not both).
  const hasTeacher = Boolean(this.teacherId);
  const hasOrg = Boolean(this.organizationId);
  if (hasTeacher === hasOrg) {
    return next(new Error('Batch must belong to exactly one owner: teacherId or organizationId'));
  }
  // Organization batches must have at least one org teacher assigned.
  if (hasOrg && (!Array.isArray(this.teachers) || this.teachers.length === 0)) {
    return next(new Error('Organization batch must have at least 1 teacher'));
  }
  next();
});

export default mongoose.model('Batch', batchSchema);
