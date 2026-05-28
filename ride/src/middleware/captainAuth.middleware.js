import jwt from "jsonwebtoken";
import axios from "axios";
import config from "../config/config.js";

export async function captainAuthMiddleware(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        const [scheme, credentials] = (authHeader ?? '').split(' ');
        const bearerToken = scheme?.toLowerCase() === 'bearer' ? credentials : undefined;

        // Prefer Authorization header to avoid cookie collisions with user auth.
        const token = bearerToken || req.cookies?.captain_token;

        if (!token) {
            return res.status(401).json({ message: "No token provided" });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, config.JWT_SECRET);
        } catch (error) {
            return res.status(401).json({ message: "Invalid token" });
        }

        const response = await axios.get(`${config.BASE_URL}/v1/api/captain/profile`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const profile = response.data?.data ?? response.data;
        if (!profile) {
            return res.status(401).json({ message: "Captain not found" });
        }

        const captainId = decoded?.id ?? decoded?._id;
        if (!captainId) {
            return res.status(401).json({ message: "Invalid token" });
        }

        // Ensure downstream code always has req.captain._id.
        req.captain = {
            ...profile,
            _id: captainId,
        };

        next();
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status ?? 500;
            const upstreamMessage = error.response?.data?.message;
            return res.status(status).json({ message: upstreamMessage || error.message });
        }

        return res.status(500).json({ message: error?.message ?? 'Internal Server Error' });
    }
}

export default captainAuthMiddleware;
