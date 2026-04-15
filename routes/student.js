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
    const windowOk = (() => {
      if (!withinWeekday) return false;
      if (!timeObj) return false;
      const start = new Date(now);
      start.setHours(timeObj.h, timeObj.m, 0, 0);
      const end = new Date(start);
      end.setMinutes(end.getMinutes() + 30);
      return now >= start && now <= end;
    })();

    const within = isWithinRadius(
      location.lat,
      location.lng,
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

    if (existing) return res.status(400).json({ error: 'Attendance already marked today' });

    // Enforce rules. If any rule fails, block marking and auto-mark ABSENT.
    if (!within || !withinWeekday || !windowOk) {
      const reasons = [];
      if (!within) reasons.push('You are not within 500m of the class location');
      if (!withinWeekday) reasons.push('Today is not a scheduled class day for this batch');
      if (withinWeekday && !windowOk) reasons.push('Outside attendance time window (start time + 30 minutes)');

      const absent = await Attendance.create({
        studentId: student._id,
        batchId,
        date: new Date(),
        status: 'absent',
        location
      });

      return res.status(400).json({
        error: reasons.join('. '),
        autoMarked: 'absent',
        attendance: absent
      });
    }

    const attendance = await Attendance.create({
      studentId: student._id,
      batchId,
      date: new Date(),
      status: 'present',
      location
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
