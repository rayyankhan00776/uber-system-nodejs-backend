import rideModel from "../model/ride.model.js";

export async function createRide(req, res, next) {
    try {
        const { pickup, destination } = req.body;
        const newRide = new rideModel({
            user: req.user._id,
            pickup,
            destination,
        });
        await newRide.save();


    } catch (error) {
        res.status(500).json({ message: 'Error creating ride', error });

    }
}



export default { createRide };