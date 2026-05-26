import userModel from '../models/user.model.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import blacklistTokenModel from '../models/blacklisttoken.model.js';

export async function registerUser(req, res) {
    try {
        const { name, email, password } = req.body;
        const user = await userModel.findOne({ email });
        if (user) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new userModel({ name, email, password: hashedPassword });
        await newUser.save();
        const token = jwt.sign({ id: newUser._id }, config.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token);
        res.status(201).json({ message: 'User created successfully', data: { name, email }, token });
    } catch (error) {
        res.status(500).json({ message: 'Error creating user', error });
    }
};

export async function loginUser(req, res) {
    try {
        const { email, password } = req.body;
        const user = await userModel.findOne({ email }).select('+password');
        if (!user) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const token = jwt.sign({ id: user._id }, config.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token);
        res.status(200).json({ message: 'Login successful', data: { name: user.name, email: user.email }, token });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error });
    }
};

export async function logoutUser(req, res) {
    try {
        const token = req.cookies.token;
        await blacklistTokenModel.create({ token });
        res.clearCookie('token');
        res.status(200).json({ message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ message: 'Error logging out', error });
    }
}

export async function userProfile(req, res) {
    try {
        const user = req.user;
        res.status(200).json({ message: 'User profile', data: { name: user.name, email: user.email } });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching user profile', error });
    }
}

export default {
    registerUser,
    loginUser,
    logoutUser,
    userProfile
};