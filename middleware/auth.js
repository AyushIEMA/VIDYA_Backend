import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) return res.status(401).json({ error: 'User not found' });
    
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    const userRole = (req.user?.role || '').toString().trim().toLowerCase();
    const allowedRoles = roles.map((role) => role.toString().trim().toLowerCase());

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    next();
  };
};
