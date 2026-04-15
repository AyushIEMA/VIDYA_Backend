import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    adminUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    address: { type: String, trim: true },
    location: {
      lat: { type: Number },
      lng: { type: Number }
    },
    nearbyLocation: { type: String, trim: true },
    subjects: [{ type: String }],
    gstin: { type: String, trim: true },
    contact: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    adminName: { type: String, trim: true },
    avgFees: { type: Number },
    organizationCode: { type: String, unique: true, required: true }
  },
  { timestamps: true }
);

export default mongoose.model('Organization', organizationSchema);

