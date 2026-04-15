import mongoose from 'mongoose';

const teacherSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  teacherCode: { type: String, unique: true, required: true },
  address: { type: String, required: true },
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true }
  },
  profession: { type: String, required: true },
  experience: { type: String, required: true },
  education: { type: String, required: true },
  schoolCollege: { type: String, required: true },
  subjects: [{ type: String }],
  avgFees: { type: Number },
  mobile: { type: String, required: true },
  whatsapp: { type: String, required: true },
  gender: { type: String, enum: ['male', 'female', 'other'], required: true }
}, { timestamps: true });

export default mongoose.model('Teacher', teacherSchema);
