import mongoose from 'mongoose';

const studentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  mobile: { type: String, required: true },
  whatsapp: { type: String, required: true },
  parentWhatsapp: { type: String, required: true },
  whatsapp_enabled: { type: Boolean, default: false },
  parentCall: { type: String, required: true },
  class: { type: String, required: true },
  board: { type: String, enum: ['CBSE', 'ICSE', 'State'], default: 'CBSE' }
}, { timestamps: true });

export default mongoose.model('Student', studentSchema);
