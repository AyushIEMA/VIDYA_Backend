import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import Batch from '../models/Batch.js';
import Enrollment from '../models/Enrollment.js';
import ClassLog from '../models/ClassLog.js';
import OrgTeacherAssignment from '../models/OrgTeacherAssignment.js';
import Announcement from '../models/Announcement.js';
import OrgTeacherProfile from '../models/OrgTeacherProfile.js';
import { uploadSingleFile, uploadToCloudinary } from '../utils/cloudinary.js';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';

const router = express.Router();
router.use(authenticate, authorize('org_teacher'));

router.use((req, res, next) => {
  // Force password reset on first login.
  if (req.user?.mustResetPassword) {
    return res.status(403).json({ error: 'Password reset required before accessing batches.' });
  }
  next();
});

router.get('/batches', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 10;
    const skip = (page - 1) * limit;

    const profile = await OrgTeacherProfile.findOne({ userId: req.user._id });
    const orgId = profile?.organizationId;

    // New source of truth: batch.teachers contains org teacher userIds
    if (orgId) {
      const query = { organizationId: orgId, teachers: req.user._id };
      const total = await Batch.countDocuments(query);
      const batches = await Batch.find(query)
        .select('batchName class board days schedule startTime fees subjects')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      return res.json({ batches, total, pages: Math.ceil(total / limit) || 1 });
    }

    // Fallback (back-compat): assignment table
    const query = { orgTeacherId: req.user._id };
    const total = await OrgTeacherAssignment.countDocuments(query);
    const assignments = await OrgTeacherAssignment.find(query)
      .populate('batchId', 'batchName class board days schedule startTime fees subjects')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const batches = assignments.map((a) => a.batchId).filter(Boolean);
    res.json({ batches, total, pages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    console.error('[orgTeacher/batches] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch/:id', async (req, res) => {
  try {
    const batchId = req.params.id;
    const assigned = await OrgTeacherAssignment.findOne({ orgTeacherId: req.user._id, batchId });
    if (!assigned) return res.status(404).json({ error: 'Batch not assigned to this teacher' });

    const batch = await Batch.findById(batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const logs = await ClassLog.find({ batchId }).sort({ date: -1 });
    res.json({ batch, logs });
  } catch (error) {
    console.error('[orgTeacher/batch] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch/:id/upload', uploadSingleFile('file'), async (req, res) => {
  try {
    const batchId = req.params.id;
    const assigned = await OrgTeacherAssignment.findOne({ orgTeacherId: req.user._id, batchId });
    if (!assigned) return res.status(404).json({ error: 'Batch not assigned to this teacher' });

    const batch = await Batch.findById(batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { type } = req.body || {};
    if (type !== 'notes' && type !== 'syllabus') {
      return res.status(400).json({ error: 'Invalid file type (use notes or syllabus)' });
    }

    const result = await uploadToCloudinary(req.file.buffer, 'vidya', {
      mimetype: req.file.mimetype,
      originalname: req.file.originalname
    });

    const fileData = { url: result.secure_url, name: req.file.originalname, uploadedAt: new Date() };
    if (type === 'notes') batch.notes.push(fileData);
    if (type === 'syllabus') batch.syllabus.push(fileData);

    await batch.save();
    res.json(batch);
  } catch (error) {
    console.error('[orgTeacher/upload] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch/:id/classlog', async (req, res) => {
  try {
    const batchId = req.params.id;
    const assigned = await OrgTeacherAssignment.findOne({ orgTeacherId: req.user._id, batchId });
    if (!assigned) return res.status(404).json({ error: 'Batch not assigned to this teacher' });

    const logs = await ClassLog.find({ batchId }).sort({ date: -1 });
    res.json(logs);
  } catch (error) {
    console.error('[orgTeacher/classlog] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch/:id/classlog', async (req, res) => {
  try {
    const batchId = req.params.id;
    const assigned = await OrgTeacherAssignment.findOne({ orgTeacherId: req.user._id, batchId });
    if (!assigned) return res.status(404).json({ error: 'Batch not assigned to this teacher' });

    const { title, description } = req.body || {};
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    const classLog = await ClassLog.create({
      batchId,
      orgTeacherId: req.user._id,
      organizationId: batch.organizationId,
      title: title.trim(),
      description
    });

    res.status(201).json(classLog);
  } catch (error) {
    console.error('[orgTeacher/classlog/create] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

// Notices: org-teacher can only notify a single batch.
router.post('/announcements', async (req, res) => {
  try {
    const { title, message, batchId } = req.body || {};

    if (!title?.trim() || !message?.trim() || !batchId) {
      return res.status(400).json({ error: 'title, message, and batchId are required' });
    }

    const assigned = await OrgTeacherAssignment.findOne({ orgTeacherId: req.user._id, batchId });
    if (!assigned) return res.status(404).json({ error: 'Batch not assigned to this teacher' });

    const batch = await Batch.findById(batchId);
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const profile = await OrgTeacherProfile.findOne({ userId: req.user._id }).select('name');
    const teacherName = String(profile?.name || '').trim() || 'Teacher';

    const announcement = await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      targetType: 'batch',
      batchId,
      orgTeacherId: req.user._id,
      organizationId: batch.organizationId
    });

    // WhatsApp notify students enrolled in this batch.
    const enrollments = await Enrollment.find({ batchId, status: 'active' }).populate('studentId');
    const students = enrollments.map((e) => e.studentId).filter(Boolean);
    const batchLabel = `${batch.batchName || 'Batch'}${batch.class ? ` • ${batch.class}` : ''}`;
    const text =
      `📢 ${teacherName} • ${batchLabel}\n` +
      `Announcement\n` +
      `Title: ${title.trim()}\n` +
      `Message: ${message.trim()}\n` +
      `\n` +
      `Reply not monitored.`;

    for (const student of students) {
      const phone = student?.parentWhatsapp;
      if (!phone) continue;
      await sendWhatsAppMessage(phone, text);
    }

    res.status(201).json(announcement);
  } catch (error) {
    console.error('[orgTeacher/announcements] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

