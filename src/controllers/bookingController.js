import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";
import { Car } from "../models/Car.js";
import { Review } from "../models/Review.js";
import {
  acquireCarLock,
  releaseCarLock,
  getCarLock,
  invalidateCarCache,
} from "../services/redisService.js";

// @desc    Price preview (days × rate, fees, deposit). Creates nothing.
// @route   POST /api/v1/bookings/quote
// @access  Customer
export const quoteBooking = async (req, res) => {
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

    const car = await Car.findOne({ _id: carId, isDeleted: { $ne: true } });
    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    const diffTime = Math.abs(end - start);
    const totalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const dailyRate = car.pricePerDay;
    const subtotal = totalDays * dailyRate;
    const deposit = 0; // Deposit policy
    const totalPrice = subtotal + deposit;

    return res.status(200).json({
      success: true,
      quote: {
        car: {
          _id: car._id,
          brand: car.brand,
          modelName: car.modelName,
          category: car.category,
          pricePerDay: car.pricePerDay,
          photos: car.photos,
        },
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        totalDays,
        dailyRate,
        subtotal,
        deposit,
        totalPrice,
        currency: "USD",
      },
    });
  } catch (error) {
    console.error("Quote Booking Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while generating booking quote",
    });
  }
};

// @desc    Create a provisional booking with 15-minute checkout hold
// @route   POST /api/v1/bookings
// @access  Customer
export const createBooking = async (req, res) => {
  try {
    const { carId, startDate, endDate } = req.body;
    const idempotencyKey = req.headers["idempotency-key"] || req.body.idempotencyKey;

    if (!carId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: "Please provide carId, startDate, and endDate",
      });
    }

    // Check Idempotency Key
    if (idempotencyKey) {
      const existing = await Booking.findOne({
        customer: req.user._id,
        idempotencyKey,
      }).populate("car");
      if (existing) {
        return res.status(200).json({
          success: true,
          message: "Idempotent request: returning existing booking",
          booking: existing,
          holdExpiresAt: existing.holdExpiresAt,
        });
      }
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
    const car = await Car.findOne({ _id: carId, isDeleted: { $ne: true } });
    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    if (!car.isAvailable || car.status !== "AVAILABLE") {
      return res.status(400).json({
        success: false,
        message: "This car is currently unavailable for booking",
      });
    }

    // 1. Check Redis 15-Minute Reservation Lock
    const existingLock = await getCarLock(carId);
    if (
      existingLock &&
      existingLock.customerId &&
      String(existingLock.customerId) !== String(req.user._id)
    ) {
      return res.status(409).json({
        success: false,
        message:
          "This car is currently held by another customer at checkout. Please try again in 15 minutes or select another car.",
        heldUntil: existingLock.expiresAt,
      });
    }

    // 2. Check for date overlap with active or unexpired provisional bookings
    const now = new Date();
    const overlappingBooking = await Booking.findOne({
      car: carId,
      startDate: { $lt: end },
      endDate: { $gt: start },
      $or: [
        { status: { $in: ["PAID", "CONFIRMED", "ACTIVE"] } },
        {
          status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
          holdExpiresAt: { $gt: now },
          customer: { $ne: req.user._id },
        },
      ],
    });

    if (overlappingBooking) {
      return res.status(409).json({
        success: false,
        message: "The car is already booked or held for checkout for the specified dates",
      });
    }

    // Calculate duration in days (minimum 1 day)
    const diffTime = Math.abs(end - start);
    const totalDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const totalPrice = totalDays * car.pricePerDay;
    const holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    const booking = await Booking.create({
      customer: req.user._id,
      car: carId,
      startDate: start,
      endDate: end,
      totalDays,
      totalPrice,
      status: "PENDING_PAYMENT",
      paymentStatus: "PENDING",
      holdExpiresAt,
      idempotencyKey,
    });

    // 3. Atomically acquire 15-Minute Reservation Lock (NX EX 900)
    const lockResult = await acquireCarLock(carId, {
      bookingId: booking._id.toString(),
      customerId: req.user._id.toString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    if (!lockResult.acquired && lockResult.heldByOther) {
      // Rollback newly created provisional booking
      await Booking.findByIdAndDelete(booking._id);
      return res.status(409).json({
        success: false,
        message:
          "This car was just held by another customer at checkout. Please try again later or choose another car.",
      });
    }

    // Invalidate car caches so calendar and listings reflect reservation
    await invalidateCarCache(carId);

    const populatedBooking = await Booking.findById(booking._id)
      .populate("car")
      .populate("customer", "name email phoneNumber");

    return res.status(201).json({
      success: true,
      message: "Provisional booking created and 15-minute checkout hold acquired",
      booking: populatedBooking,
      holdExpiresAt,
      reservationHoldExpiresAt: lockResult.lock?.expiresAt || holdExpiresAt,
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
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { customer: req.user._id };

    if (status) {
      filter.status = status.toUpperCase();
    }

    // Exclude expired unpaid bookings whose 15-minute checkout window has elapsed
    const now = new Date();
    filter.$or = [
      { status: { $nin: ["PENDING_PAYMENT", "PROVISIONAL"] } },
      { paymentStatus: "PAID" },
      { holdExpiresAt: { $gt: now } },
    ];

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate({
          path: "car",
          populate: {
            path: "host",
            select: "name email phoneNumber",
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get My Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching booking history",
    });
  }
};

// @desc    View bookings for the host's cars
// @route   GET /api/v1/bookings/host
// @access  Host / Admin
export const getHostBookings = async (req, res) => {
  try {
    const { status, carId, page = 1, limit = 20 } = req.query;

    const hostCars = await Car.find({ host: req.user._id }).select("_id");
    const hostCarIds = hostCars.map((c) => c._id);

    const filter = { car: { $in: hostCarIds } };

    if (carId) {
      filter.car = carId;
    }

    if (status) {
      filter.status = status.toUpperCase();
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate("car")
        .populate("customer", "name email phoneNumber driverLicense")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get Host Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching host bookings",
    });
  }
};

// @desc    Get all bookings (Admin only)
// @route   GET /api/v1/bookings
// @access  Admin
export const getAllBookings = async (req, res) => {
  try {
    const { status, carId, userId, from, to, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status.toUpperCase();
    if (carId) filter.car = carId;
    if (userId) filter.customer = userId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate("car")
        .populate("customer", "name email phoneNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      Booking.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: bookings.length,
      bookings,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get All Bookings Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching all bookings",
    });
  }
};

// @desc    Get single booking detail
// @route   GET /api/v1/bookings/:id
// @access  Customer (Owner) / Host of Car / Admin
export const getBookingById = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate({
        path: "car",
        populate: { path: "host", select: "name email phoneNumber" },
      })
      .populate("customer", "name email phoneNumber driverLicense");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const isCustomer =
      String(booking.customer?._id) === String(req.user._id) ||
      Boolean(req.user.sub && booking.customer?.sub === req.user.sub);
    const isHost =
      booking.car &&
      booking.car.host &&
      String(booking.car.host._id) === String(req.user._id);
    const isAdmin = req.user.role?.toUpperCase() === "ADMIN";

    if (!isCustomer && !isHost && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view this booking",
      });
    }

    // Check if 15-minute checkout reservation hold has expired
    if (
      booking.status === "PENDING_PAYMENT" &&
      booking.paymentStatus !== "PAID" &&
      booking.holdExpiresAt &&
      new Date() > new Date(booking.holdExpiresAt)
    ) {
      const carId = booking.car?._id ? booking.car._id.toString() : booking.car?.toString();
      if (carId) {
        await releaseCarLock(carId);
        await invalidateCarCache(carId);
      }
      await Payment.deleteMany({ booking: booking._id, status: { $ne: "COMPLETED" } });
      await Booking.findByIdAndDelete(booking._id);

      return res.status(410).json({
        success: false,
        message: "Your 15-minute reservation hold has expired and the booking has been cancelled.",
        expired: true,
      });
    }

    return res.status(200).json({
      success: true,
      booking,
    });
  } catch (error) {
    console.error("Get Booking By ID Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Booking not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching booking details",
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

    // Invalidate car cache
    if (booking.car) {
      await invalidateCarCache(booking.car._id.toString());
    }

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

// @desc    Confirm return of vehicle & mark booking COMPLETED
// @route   PATCH /api/v1/bookings/:id/complete
// @access  Host (Owner) / Admin
export const completeBooking = async (req, res) => {
  try {
    const { returnNotes, damageReported, fuelLevel, mileage } = req.body;
    const booking = await Booking.findById(req.params.id).populate("car");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const isHost =
      booking.car &&
      booking.car.host &&
      booking.car.host.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "ADMIN";

    if (!isHost && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to complete this booking",
      });
    }

    if (booking.status !== "ACTIVE") {
      return res.status(400).json({
        success: false,
        message: `Only ACTIVE bookings can be marked as COMPLETED. Current status: ${booking.status}`,
      });
    }

    booking.status = "COMPLETED";
    booking.completedAt = new Date();
    if (returnNotes !== undefined) booking.returnNotes = returnNotes;
    if (damageReported !== undefined) booking.damageReported = Boolean(damageReported);
    if (fuelLevel !== undefined) booking.fuelLevel = fuelLevel;
    if (mileage !== undefined) booking.mileage = Number(mileage);

    await booking.save();

    if (booking.car) {
      const carId = booking.car._id.toString();
      await releaseCarLock(carId, booking._id.toString());
      await invalidateCarCache(carId);
    }

    const updatedBooking = await Booking.findById(booking._id)
      .populate("car")
      .populate("customer", "name email phoneNumber");

    return res.status(200).json({
      success: true,
      message: "Vehicle return confirmed and booking completed successfully",
      booking: updatedBooking,
    });
  } catch (error) {
    console.error("Complete Booking Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Booking not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while completing booking",
    });
  }
};

// @desc    Cancel a booking and release 15-minute hold
// @route   PATCH /api/v1/bookings/:id/cancel
// @access  Customer (Owner) / Host (Owner) / Admin
export const cancelBooking = async (req, res) => {
  try {
    const { reason } = req.body;
    const booking = await Booking.findById(req.params.id).populate("car");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking record not found",
      });
    }

    const isCustomer = booking.customer.toString() === req.user._id.toString();
    const isHost =
      booking.car &&
      booking.car.host &&
      booking.car.host.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "ADMIN";

    if (!isCustomer && !isHost && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to cancel this booking",
      });
    }

    booking.status = "CANCELLED";
    if (reason) booking.cancellationReason = reason;
    await booking.save();

    // Release 15-minute reservation lock in Redis immediately
    if (booking.car) {
      const carId = booking.car._id.toString();
      await releaseCarLock(carId, booking._id.toString());
      await invalidateCarCache(carId);
    }

    return res.status(200).json({
      success: true,
      message: "Booking cancelled and reservation hold released",
      booking,
    });
  } catch (error) {
    console.error("Cancel Booking Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Booking not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while cancelling booking",
    });
  }
};

// @desc    Customer review for completed booking
// @route   POST /api/v1/bookings/:id/review
// @access  Customer (Owner)
export const createBookingReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const { id } = req.params;

    if (!rating) {
      return res.status(400).json({
        success: false,
        message: "Please provide a rating between 1 and 5",
      });
    }

    const numRating = Number(rating);
    if (isNaN(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({
        success: false,
        message: "Rating must be an integer between 1 and 5",
      });
    }

    const booking = await Booking.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Only the customer who booked the vehicle can review
    if (String(booking.customer) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to review this booking",
      });
    }

    // Only COMPLETED bookings can be reviewed
    if (booking.status !== "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Only COMPLETED bookings can be reviewed",
      });
    }

    // Check if review already exists
    const existingReview = await Review.findOne({ booking: id });
    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: "A review has already been submitted for this booking",
      });
    }

    const review = await Review.create({
      booking: id,
      car: booking.car,
      customer: req.user._id,
      rating: numRating,
      comment: comment || "",
    });

    const populatedReview = await Review.findById(review._id)
      .populate("customer", "name")
      .populate("car", "brand modelName");

    return res.status(201).json({
      success: true,
      message: "Review submitted successfully",
      review: populatedReview,
    });
  } catch (error) {
    console.error("Create Booking Review Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Booking not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while creating review",
    });
  }
};
