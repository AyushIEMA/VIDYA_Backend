import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import Batch from '../models/Batch.js';
import Enrollment from '../models/Enrollment.js';
import Fee from '../models/Fee.js';
import Attendance from '../models/Attendance.js';
import Announcement from '../models/Announcement.js';
import Review from '../models/Review.js';
import ClassLog from '../models/ClassLog.js';
import { isWithinRadius } from '../utils/geo.js';
import { hasScheduleConflict } from '../utils/schedule.js';

const router = express.Router();

const STUDENT_PROFILE_FIELDS = [
  'name', 'address', 'mobile', 'whatsapp', 'parentWhatsapp', 'parentCall', 'class', 'board'
];

router.use(authenticate, authorize('student'));

router.get('/profile', async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user._id });
    res.json(student);
  } catch (error) {
    console.error('[student/attendance] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const payload = {};
    for (const k of STUDENT_PROFILE_FIELDS) {
      if (req.body[k] !== undefined) payload[k] = req.body[k];
    }
    const student = await Student.findOneAndUpdate(
      { userId: req.user._id },
      payload,
      { new: true, runValidators: true }
    );
    res.json(student);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/teacher/search', async (req, res) => {
  try {
    const { teacherCode } = req.body;
    const teacher = await Teacher.findOne({ teacherCode });
    if (!teacher) return res.status(404).json({ error: 'Teacher not found' });
    res.json(teacher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/teacher/:teacherId/batches', async (req, res) => {
  try {
    const { page = 1, limit = 10, search, class: cls, subject, board } = req.query;
    const query = { teacherId: req.params.teacherId };

    if (search) query.batchName = { $regex: search, $options: 'i' };
    if (cls) query.class = cls;
    if (board) query.board = board;
    if (subject) {
      const s = String(subject).trim();
      if (s) {
        // subjects is an array; regex matches any element (case-insensitive)
        query.subjects = { $elemMatch: { $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } };
      }
    }

    const batches = await Batch.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Batch.countDocuments(query);
    res.json({ batches, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/enroll', async (req, res) => {
  try {
    const { batchId } = req.body;
    const student = await Student.findOne({ userId: req.user._id });
    const batch = await Batch.findById(batchId);

    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    const isOrgBatch = Boolean(batch.organizationId);
    const isTeacherBatch = Boolean(batch.teacherId);
    if (isOrgBatch === isTeacherBatch) {
      return res.status(400).json({ error: 'Batch owner is invalid' });
    }

    const existing = await Enrollment.findOne({ studentId: student._id, batchId });
    if (existing) return res.status(400).json({ error: 'Already enrolled' });

    const otherEnrollments = await Enrollment.find({
      studentId: student._id,
      status: 'active'
    }).populate('batchId').populate('teacherId');

    const conflicts = [];
    for (const e of otherEnrollments) {
      if (!e.batchId) continue;
      if (e.batchId._id.toString() === batch._id.toString()) continue;
      if (hasScheduleConflict(e.batchId, batch)) {
        const t = e.teacherId;
        conflicts.push({
          batchName: e.batchId.batchName,
          teacherName: t ? `${t.firstName || ''} ${t.lastName || ''}`.trim() : 'Batch',
          days: e.batchId.days,
          startTime: e.batchId.startTime,
          schedule: e.batchId.schedule
        });
      }
    }

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: 'Schedule conflict with another enrolled batch',
        conflicts
      });
    }

    const enrollment = await Enrollment.create({
      studentId: student._id,
      batchId,
      teacherId: isTeacherBatch ? batch.teacherId : undefined,
      organizationId: isOrgBatch ? batch.organizationId : undefined,
      discount: 0,
      discountType: 'amount'
    });

    const currentDate = new Date();
    const month = currentDate.toLocaleString('en-US', { month: 'long' });
    const year = currentDate.getFullYear();
    
    await Fee.create({
      studentId: student._id,
      batchId,
      teacherId: isTeacherBatch ? batch.teacherId : undefined,
      organizationId: isOrgBatch ? batch.organizationId : undefined,
      originalAmount: batch.fees,
      discount: 0,
      amount: batch.fees,
      month,
      year,
      status: 'pending'
    });

    res.status(201).json(enrollment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch/:batchId/leave', async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user._id });
    const enrollment = await Enrollment.findOne({
      studentId: student._id,
      batchId: req.params.batchId,
      status: 'active'
    });
    if (!enrollment) {
      return res.status(404).json({ error: 'Active enrollment not found' });
    }
    enrollment.status = 'left';
    await enrollment.save();
    res.json({ message: 'Left batch', enrollment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batches', async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user._id });
    const enrollments = await Enrollment.find({ studentId: student._id, status: 'active' })
      .populate('batchId')
      .populate('teacherId')
      .populate('organizationId');
    
    const grouped = {};
    for (const enrollment of enrollments) {
      if (!enrollment.batchId) continue;

      if (enrollment.teacherId) {
        const teacherId = enrollment.teacherId._id.toString();
        const key = `t:${teacherId}`;
        if (!grouped[key]) {
          grouped[key] = {
            type: 'teacher',
            teacher: enrollment.teacherId,
            batches: []
          };
        }
        grouped[key].batches.push({
          ...enrollment.batchId.toObject(),
          discount: enrollment.discount,
          enrollmentId: enrollment._id
        });
        continue;
      }

      if (enrollment.organizationId) {
        const orgId = enrollment.organizationId._id.toString();
        const key = `o:${orgId}`;
        if (!grouped[key]) {
          grouped[key] = {
            type: 'organization',
            organization: enrollment.organizationId,
            batches: []
          };
        }
        grouped[key].batches.push({
          ...enrollment.batchId.toObject(),
          discount: enrollment.discount,
          enrollmentId: enrollment._id
        });
      }
    }

    res.json(Object.values(grouped));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch/:id/details', async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id).populate('teacherId').populate('organizationId');
    const logs = await ClassLog.find({ batchId: req.params.id }).sort({ date: -1 });
    res.json({ batch, logs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/attendance', async (req, res) => {
  try {
    const { batchId, location } = req.body;
    const student = await Student.findOne({ userId: req.user._id });
    const batch = await Batch.findById(batchId);

    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    // Input validation (400 only for invalid input).
    const lat = location?.lat;
    const lng = location?.lng;
    if (!batchId) {
      return res.status(400).json({ error: 'batchId is required' });
    }
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'location.lat and location.lng are required' });
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      return res.status(400).json({ error: 'location.lat and location.lng must be valid numbers' });
    }
    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      return res.status(400).json({ error: 'location.lat/lng are out of range' });
    }

    const now = new Date();
    const todayName = now.toLocaleString('en-US', { weekday: 'long' });

    const scheduleSlots = batch.schedule?.length
      ? batch.schedule
      : (batch.days || []).map((d) => ({ day: d, startTime: batch.startTime }));

    const slot = scheduleSlots.find((s) => (s.day || '') === todayName);
    const withinWeekday = Boolean(slot);

    const parseTime = (t) => {
      const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
      if (!m) return null;
      return { h: parseInt(m[1], 10), m: parseInt(m[2], 10) };
    };

    const timeObj = slot ? parseTime(slot.startTime) : null;
    const start = (() => {
      if (!withinWeekday) return null;
      if (!timeObj) return null;
      const d = new Date(now);
      d.setHours(timeObj.h, timeObj.m, 0, 0);
      return d;
    })();
    const end = (() => {
      if (!start) return null;
      const d = new Date(start);
      d.setMinutes(d.getMinutes() + 30);
      return d;
    })();

    const within = isWithinRadius(
      latNum,
      lngNum,
      batch.location.lat,
      batch.location.lng
    );

    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const existing = await Attendance.findOne({
      studentId: student._id,
      batchId,
      date: { $gte: today }
    });

    if (existing) return res.status(409).json({ error: 'Attendance already marked today' });

    // Enforce rules (do not auto-create attendance on failure).
    if (!within) {
      return res.status(403).json({ error: 'Too far from batch location' });
    }
    if (!withinWeekday) {
      return res.status(422).json({ error: 'Today is not a scheduled class day for this batch' });
    }
    if (!start || !end) {
      return res.status(422).json({ error: 'Batch start time is not configured for today' });
    }
    if (now > end) {
      const startTime = slot?.startTime || batch.startTime || '';
      return res.status(422).json({ error: `You are late. Class started at ${startTime}. Contact teacher.` });
    }
    // Preserve existing behavior: don't allow before class start.
    if (now < start) {
      const startTime = slot?.startTime || batch.startTime || '';
      return res.status(422).json({ error: `Attendance opens at ${startTime}.` });
    }

    const attendance = await Attendance.create({
      studentId: student._id,
      batchId,
      date: new Date(),
      status: 'present',
      location: { lat: latNum, lng: lngNum }
    });

    res.status(201).json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/review', async (req, res) => {
  try {
    const { batchId, rating, comment } = req.body;
    const student = await Student.findOne({ userId: req.user._id });
    
    const review = await Review.create({
      batchId,
      studentId: student._id,
      rating,
      comment
    });

    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/announcements', async (req, res) => {
  try {
    const student = await Student.findOne({ userId: req.user._id });
    const enrollments = await Enrollment.find({ studentId: student._id, status: 'active' });
    const teacherIds = enrollments.map(e => e.teacherId);
    const batchIds = enrollments.map(e => e.batchId);

    const announcements = await Announcement.find({
      $or: [
        { teacherId: { $in: teacherIds }, targetType: 'all' },
        { batchId: { $in: batchIds }, targetType: 'batch' },
        { studentIds: { $in: [student._id] }, targetType: 'students' }
      ]
    }).populate('teacherId').sort({ createdAt: -1 });

    res.json(announcements);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
