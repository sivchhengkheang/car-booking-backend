import { Booking } from "../models/Booking.js";
import { Car } from "../models/Car.js";

// @desc    Create a provisional booking
// @route   POST /api/v1/bookings
// @access  Customer
export const createBooking = async (req, res) => {
  try {
    const { carId, startDate, endDate } = req.body;

    if (!carId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Please provide carId, startDate, and endDate",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format provided",
      });
    }

    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: "End date must be strictly after start date",
      });
    }

    // Check if car exists and is listed as available
    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    if (!car.isAvailable) {
      return res.status(400).json({
        success: false,
        message: "This car is currently unavailable for booking",
      });
    }

    // Check for date overlap with active or provisional bookings
    const overlappingBooking = await Booking.findOne({
      car: carId,
      status: { $in: ["PROVISIONAL", "CONFIRMED", "ACTIVE"] },
      startDate: { $lt: end },
      endDate: { $gt: start },
    });

    if (overlappingBooking) {
      return res.status(400).json({
        success: false,
        message: "The car is already booked for the specified dates",
      });
    }

    // Calculate duration in days (minimum 1 day)
    const diffTime = Math.abs(end - start);
    const totalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const totalPrice = totalDays * car.pricePerDay;

    const booking = await Booking.create({
      customer: req.user._id,
      car: carId,
      startDate: start,
      endDate: end,
      totalDays,
      totalPrice,
      status: "PROVISIONAL",
      paymentStatus: "PENDING",
    });

    const populatedBooking = await Booking.findById(booking._id)
      .populate("car")
      .populate("customer", "name email phoneNumber");

    return res.status(201).json({
      success: true,
      message: "Provisional booking created successfully",
      booking: populatedBooking,
    });
  } catch (error) {
    console.error("Create Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while creating booking",
    });
  }
};

// @desc    View customer's booking history
// @route   GET /api/v1/bookings/my
// @access  Customer
export const getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ customer: req.user._id })
      .populate({
        path: "car",
        populate: {
          path: "host",
          select: "name email phoneNumber",
        },
      })
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings,
    });
  } catch (error) {
    console.error("Get My Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching booking history",
    });
  }
};

// @desc    Verify pickup and activate rental
// @route   PATCH /api/v1/bookings/:id/confirm
// @access  Host / Admin
export const confirmBookingPickup = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate("car");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking record not found",
      });
    }

    // Verify ownership: req.user must be an Admin OR the host of the booked car
    const isHost =
      booking.car &&
      booking.car.host &&
      booking.car.host.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "ADMIN";

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to verify pickup for this vehicle booking",
      });
    }

    // Update status to ACTIVE
    booking.status = "ACTIVE";
    booking.pickupConfirmedAt = new Date();
    booking.confirmedBy = req.user._id;

    await booking.save();

    const updatedBooking = await Booking.findById(booking._id)
      .populate("car")
      .populate("customer", "name email phoneNumber")
      .populate("confirmedBy", "name email");

    return res.status(200).json({
      success: true,
      message: "Pickup verified and rental activated successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Confirm Booking Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Booking not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while confirming booking pickup",
    });
  }
};
