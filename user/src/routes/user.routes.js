import express from 'express';
const userRouter = express.Router();
import { registerUser, loginUser, logoutUser, userProfile } from '../controller/user.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

userRouter.post('/register', registerUser);
userRouter.post('/login', loginUser);
userRouter.get('/logout', logoutUser);
userRouter.get('/profile', authMiddleware, userProfile);

export default userRouter;