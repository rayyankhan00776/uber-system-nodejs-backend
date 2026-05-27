import jwt from "jsonwebtoken";
import axios from "axios";
export async function authMiddleware(req, res, next) {
    try {
        const token = req.cookies.token || req.headers.authorization?.split(" ")[1];

        if (!token) {
            return res.status(401).json({ message: "No token provided" });
        }

        const decoded = jwt.verify(token, config.JWT_SECRET);
        const response = await axios.get(`${config.BASE_URL}/v1/api/user/profile`, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        const user = response.data;
        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        req.user = user;

        next();
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}
export default authMiddleware;
