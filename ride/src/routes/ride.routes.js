import express from 'express';
const rideRouter = express.Router();
import authMiddleware from '../middleware/auth.middleware.js';
import captainAuthMiddleware from '../middleware/captainAuth.middleware.js';
import { createRide, acceptRide } from '../controller/ride.controller.js';

rideRouter.post('/create-ride', authMiddleware, createRide);
rideRouter.patch('/accept-ride/:rideId', captainAuthMiddleware, acceptRide);

export default rideRouter;
