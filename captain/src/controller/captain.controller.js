import captainModel from '../models/captain.model.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import blacklistTokenModel from '../models/blacklisttoken.model.js';

export async function registerCaptain(req, res) {
    try {
        const { name, email, password } = req.body;
        const captain = await captainModel.findOne({ email });
        if (captain) {
            return res.status(400).json({ message: 'captain already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const newCaptain = new captainModel({ name, email, password: hashedPassword });
        await newCaptain.save();
        const token = jwt.sign({ id: newCaptain._id }, config.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token);
        res.status(201).json({
            message: 'captain created successfully',
            data: {
                id: newCaptain._id,
                name: newCaptain.name,
                email: newCaptain.email,
                isAvailable: newCaptain.isAvailable,
                createdAt: newCaptain.createdAt,
                updatedAt: newCaptain.updatedAt,
            },
            token,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error creating captain', error });
    }
};

export async function loginCaptain(req, res) {
    try {
        const { email, password } = req.body;
        const captain = await captainModel.findOne({ email }).select('+password');
        if (!captain) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const isMatch = await bcrypt.compare(password, captain.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid email or password' });
        }
        const token = jwt.sign({ id: captain._id }, config.JWT_SECRET, { expiresIn: '1h' });
        res.cookie('token', token);
        res.status(200).json({
            message: 'Login successful',
            data: {
                id: captain._id,
                name: captain.name,
                email: captain.email,
                isAvailable: captain.isAvailable,
                createdAt: captain.createdAt,
                updatedAt: captain.updatedAt,
            },
            token,
        });
    } catch (error) {
        res.status(500).json({ message: 'Error logging in', error });
    }
};

export async function logoutCaptain(req, res) {
    try {
        const token = req.cookies.token;
        await blacklistTokenModel.create({ token });
        res.clearCookie('token');
        res.status(200).json({ message: 'Logout successful' });
    } catch (error) {
        res.status(500).json({ message: 'Error logging out', error });
    }
}

export async function captainProfile(req, res) {
    try {
        const captain = req.captain;
        res.status(200).json({
            message: 'captain profile',
            data: {
                id: captain._id,
                name: captain.name,
                email: captain.email,
                isAvailable: captain.isAvailable,
                createdAt: captain.createdAt,
                updatedAt: captain.updatedAt,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching captain profile', error });
    }
}

export async function toggleAvailability(req, res) {
    try {
        const captain = await captainModel.findById(req.captain._id);
        captain.isAvailable = !captain.isAvailable;
        await captain.save();
        res.status(200).json({
            message: 'Availability toggled',
            data: {
                id: captain._id,
                name: captain.name,
                email: captain.email,
                isAvailable: captain.isAvailable,
                createdAt: captain.createdAt,
                updatedAt: captain.updatedAt,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'Error toggling availability', error });
    }
}

export default {
    registerCaptain,
    loginCaptain,
    logoutCaptain,
    captainProfile,
    toggleAvailability
};