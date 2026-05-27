import express from 'express';
const rideRouter = express.Router();
import authMiddleware from '../middleware/auth.middleware.js';
import { createRide } from '../controller/ride.controller.js';

rideRouter.get('/create-ride', authMiddleware, createRide);

export default rideRouter;