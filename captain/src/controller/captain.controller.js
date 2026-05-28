import captainModel from '../models/captain.model.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import blacklistTokenModel from '../models/blacklisttoken.model.js';
import { subscribeToQueue } from '../service/rabbit.js';

const DEFAULT_LONG_POLL_TIMEOUT_MS = 25_000;

const pendingRideRequests = [];
const waitingLongPollClients = [];

function deliverRideRequest(payload) {
    while (waitingLongPollClients.length) {
        const client = waitingLongPollClients.shift();
        if (!client || client.res.headersSent || client.res.writableEnded) continue;

        clearTimeout(client.timeoutId);
        client.res.status(200).json({ message: 'New ride available', data: payload });
        return;
    }

    pendingRideRequests.push(payload);
}

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
        const token = jwt.sign({ id: newCaptain._id }, config.JWT_SECRET, { expiresIn: '7d' });
        res.cookie('captain_token', token);
        // Back-compat: some clients still rely on a generic cookie name.
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
        const token = jwt.sign({ id: captain._id }, config.JWT_SECRET, { expiresIn: '7d' });
        res.cookie('captain_token', token);
        // Back-compat: some clients still rely on a generic cookie name.
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
        const authHeader = req.headers.authorization;
        const [scheme, credentials] = (authHeader ?? '').split(' ');
        const bearerToken = scheme?.toLowerCase() === 'bearer' ? credentials : undefined;

        const token = bearerToken || req.cookies?.captain_token || req.cookies?.token;
        if (!token) {
            return res.status(400).json({ message: 'unauthorized: token is required' });
        }
        if (token) {
            await blacklistTokenModel.create({ token });
        }

        res.clearCookie('captain_token');
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
        // Get token from header or cookies
        const authHeader = req.headers.authorization;
        const [scheme, credentials] = (authHeader ?? '').split(' ');

        const bearerToken =
            scheme?.toLowerCase() === 'bearer'
                ? credentials
                : undefined;

        const token =
            bearerToken ||
            req.cookies?.captain_token ||
            req.cookies?.token;

        if (!token) {
            return res.status(401).json({
                message: 'Unauthorized: token is required',
            });
        }

        // Make sure req.captain exists
        if (!req.captain?._id) {
            return res.status(401).json({
                message: 'Unauthorized captain',
            });
        }

        // Find captain
        const captain = await captainModel.findById(req.captain._id);

        if (!captain) {
            return res.status(404).json({
                message: 'Captain not found',
            });
        }

        // Toggle availability
        captain.isAvailable = !captain.isAvailable;

        await captain.save();

        return res.status(200).json({
            message: 'Availability toggled successfully',
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
        console.error('Toggle Availability Error:', error);

        return res.status(500).json({
            message: 'Error toggling availability',
            error: error.message,
        });
    }
}

export async function pollNewRide(req, res) {
    const timeoutMs = Number(req.query.timeoutMs ?? DEFAULT_LONG_POLL_TIMEOUT_MS);
    const safeTimeoutMs = Number.isFinite(timeoutMs)
        ? Math.min(Math.max(timeoutMs, 1_000), 60_000)
        : DEFAULT_LONG_POLL_TIMEOUT_MS;

    if (pendingRideRequests.length) {
        const payload = pendingRideRequests.shift();
        return res.status(200).json({ message: 'New ride available', data: payload });
    }

    const client = { res, timeoutId: undefined };
    waitingLongPollClients.push(client);

    const cleanup = () => {
        clearTimeout(client.timeoutId);
        const index = waitingLongPollClients.indexOf(client);
        if (index !== -1) waitingLongPollClients.splice(index, 1);
    };

    req.on('close', cleanup);
    res.on('close', cleanup);

    client.timeoutId = setTimeout(() => {
        cleanup();
        if (!res.headersSent && !res.writableEnded) {
            res.status(200).json({ message: 'No new ride available', data: null });
        }
    }, safeTimeoutMs);
}

void subscribeToQueue("new_ride_requests", async (payload) => {
    console.log("Received message in captain service:", payload);
    deliverRideRequest(payload);
}).catch((error) => {
    console.error("Failed to subscribe to 'new_ride_requests':", error);
});




export default {
    registerCaptain,
    loginCaptain,
    logoutCaptain,
    captainProfile,
    toggleAvailability,
    pollNewRide
};