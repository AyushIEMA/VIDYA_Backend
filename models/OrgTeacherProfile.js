import mongoose from 'mongoose';

const orgTeacherProfileSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    degree: { type: String, trim: true },
    experience: { type: String, trim: true }
  },
  { timestamps: true }
);

export default mongoose.model('OrgTeacherProfile', orgTeacherProfileSchema);

