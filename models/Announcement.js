import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema({
  teacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'Teacher' },
  orgTeacherId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization' },
  title: { type: String, required: true },
  message: { type: String, required: true },
  targetType: { type: String, enum: ['all', 'batch', 'students'], required: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch' },
  studentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Student' }]
}, { timestamps: true });

export default mongoose.model('Announcement', announcementSchema);
