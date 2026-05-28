import express from 'express';
const captainRouter = express.Router();
import { registerCaptain, loginCaptain, logoutCaptain, captainProfile, toggleAvailability, pollNewRide } from '../controller/captain.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

captainRouter.post('/register', registerCaptain);
captainRouter.post('/login', loginCaptain);
captainRouter.get('/logout', logoutCaptain);
captainRouter.get('/profile', authMiddleware, captainProfile);
captainRouter.patch('/toggle-availability', authMiddleware, toggleAvailability);
captainRouter.get('/poll-new-ride', authMiddleware, pollNewRide);

export default captainRouter;