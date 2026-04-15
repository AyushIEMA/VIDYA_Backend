import dotenv from 'dotenv';

dotenv.config();

import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import teacherRoutes from './routes/teacher.js';
import studentRoutes from './routes/student.js';
import batchRoutes from './routes/batch.js';
import orgAdminRoutes from './routes/orgAdmin.js';
import orgTeacherRoutes from './routes/orgTeacher.js';
import organizationRoutes from './routes/organization.js';
import whatsappRoutes from './routes/whatsapp.js';
import { initCloudinaryConfig } from './utils/cloudinary.js';

const app = express();

initCloudinaryConfig();

app.use(
  cors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.options('*', cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/batch', batchRoutes);
app.use('/api/org-admin', orgAdminRoutes);
app.use('/api/org-teacher', orgTeacherRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/whatsapp', whatsappRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
