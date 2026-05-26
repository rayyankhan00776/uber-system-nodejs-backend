import mongoose from 'mongoose';

const captainSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    password: {
        type: String,
        required: true,
    },
    isAvailable: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

const captainModel = mongoose.model('Captain', captainSchema);

export default captainModel;