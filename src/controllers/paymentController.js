import crypto from "crypto";
import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";
import { Car } from "../models/Car.js";
import {
  acquireCarLock,
  releaseCarLock,
  invalidateCarCache,
} from "../services/redisService.js";

// ---------------------------------------------------------------------------
// Baray AES-256-CBC Encryption
// Encrypts the payment payload before sending to Baray API
// ---------------------------------------------------------------------------
function encryptPayload(payload) {
  const sk = process.env.BARAY_SK;
  const iv = process.env.BARAY_IV;

  if (!sk || !iv) {
    throw new Error("BARAY_SK and BARAY_IV environment variables are required");
  }

  const key = Buffer.from(sk, "base64");
  const ivBuffer = Buffer.from(iv, "base64");
  const plaintext = JSON.stringify(payload);

  const cipher = crypto.createCipheriv("aes-256-cbc", key, ivBuffer);
  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return encrypted.toString("base64");
}

// ---------------------------------------------------------------------------
// @desc    Create Baray payment intent for a booking
// @route   POST /api/v1/payments/checkout
// @access  Customer / Authenticated
// ---------------------------------------------------------------------------
export const checkoutPayment = async (req, res) => {
  try {
    const rawBody = req.body || {};
    const bookingId =
      rawBody.bookingId ||
      rawBody.booking_id ||
      rawBody.id ||
      rawBody.booking?._id ||
      (typeof rawBody === "string" ? rawBody : null);

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid bookingId",
      });
    }

    // Find booking with car and customer
    const booking = await Booking.findById(bookingId)
      .populate("car")
      .populate("customer");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    // Verify ownership (allow customer owner by _id or sub, or Admin)
    const bookingCustomerId =
      booking.customer?._id?.toString() || booking.customer?.toString();
    const isOwner =
      bookingCustomerId === req.user._id.toString() ||
      (req.user.sub && booking.customer?.sub === req.user.sub);
    const isAdmin = req.user.role === "ADMIN";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "This booking does not belong to your account",
      });
    }

    if (booking.paymentStatus === "PAID" || booking.status === "PAID") {
      return res.status(400).json({
        success: false,
        message: "This booking has already been paid",
      });
    }

    if (booking.status === "CANCELLED") {
      return res.status(400).json({
        success: false,
        message: "This booking has been cancelled and cannot be paid",
      });
    }

    // Check if 15-minute checkout reservation hold has expired
    const carId = booking.car?._id?.toString() || booking.car?.toString();
    if (
      booking.holdExpiresAt &&
      new Date() > new Date(booking.holdExpiresAt) &&
      booking.paymentStatus !== "PAID"
    ) {
      if (carId) {
        await releaseCarLock(carId);
        await invalidateCarCache(carId);
      }
      await Payment.deleteMany({ booking: booking._id, status: { $ne: "COMPLETED" } });
      await Booking.findByIdAndDelete(booking._id);

      return res.status(409).json({
        success: false,
        message:
          "Your 15-minute reservation hold has expired and the booking has been cancelled. Please select a car and re-book.",
      });
    }

    // 15-Minute Reservation Lock validation & refresh during checkout
    if (carId) {
      const lockResult = await acquireCarLock(carId, {
        bookingId: booking._id.toString(),
        customerId: req.user._id.toString(),
        startDate: booking.startDate?.toISOString(),
        endDate: booking.endDate?.toISOString(),
      });

      if (!lockResult.acquired && lockResult.heldByOther) {
        return res.status(409).json({
          success: false,
          message:
            "Your 15-minute reservation hold has expired and this vehicle is now held by another customer. Please select another car.",
        });
      }
    }

    const priceNum = Number(booking.totalPrice);
    if (isNaN(priceNum) || priceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid booking total price for payment",
      });
    }

    // Build a unique order_id tied to this booking
    const orderId = `ORDER-${booking._id}-${Date.now()}`;

    const carBrand = booking.car?.brand || booking.car?.make || "Car";
    const carModel = booking.car?.modelName || booking.car?.model || "Rental";
    const carName = `${carBrand} ${carModel}`.trim();

    const clientUrl = process.env.CLIENT_URL || "http://localhost:3000";
    const successUrl =
      rawBody.successUrl ||
      `${clientUrl}/booking/success?bookingId=${booking._id}`;

    // Build the payload to encrypt (per Baray spec)
    const payload = {
      amount: priceNum.toFixed(2),
      currency: "USD",
      order_id: orderId,
      tracking: {
        customer_id: req.user._id.toString(),
        booking_id: booking._id.toString(),
        car: carName,
      },
      order_details: {
        items: [
          {
            name: `${carName} — ${booking.totalDays || 1} day(s)`,
            price: priceNum,
          },
        ],
      },
      custom_success_url: successUrl,
    };

    // Encrypt the payload with AES-256-CBC
    const encryptedData = encryptPayload(payload);

    // POST to Baray API
    const barayResponse = await fetch("https://api.baray.io/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.BARAY_API_KEY,
      },
      body: JSON.stringify({ data: encryptedData }),
    });

    if (!barayResponse.ok) {
      const errorBody = await barayResponse.json().catch(() => ({}));
      console.error("Baray API error:", errorBody);
      return res.status(502).json({
        success: false,
        message:
          errorBody.error ||
          errorBody.message ||
          "Failed to create payment intent with Baray",
      });
    }

    const intent = await barayResponse.json();
    const paymentUrl = `https://pay.baray.io/${intent._id}`;

    // Refresh 15-minute hold and store Baray intent details on booking
    booking.holdExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    booking.paymentDetails = {
      barayIntentId: intent._id,
      barayOrderId: orderId,
      barayPaymentUrl: paymentUrl,
      paymentMethod: "KHQR",
    };
    await booking.save();

    // Record transaction in payments collection referencing booking & user
    const paymentRecord = await Payment.create({
      booking: booking._id,
      user: req.user._id,
      amount: priceNum,
      currency: "USD",
      status: "PENDING",
      paymentMethod: "KHQR",
      barayOrderId: orderId,
      barayIntentId: intent._id,
    });

    const responsePayload = {
      paymentId: paymentRecord._id,
      bookingId: booking._id,
      orderId,
      intentId: intent._id,
      amount: priceNum,
      currency: "USD",
      paymentUrl, // Frontend redirects customer here
      status: booking.paymentStatus,
    };

    return res.status(200).json({
      success: true,
      message: "Payment intent created. Redirect customer to paymentUrl.",
      paymentUrl,
      intentId: intent._id,
      checkout: responsePayload,
      data: responsePayload,
    });
  } catch (error) {
    console.error("Checkout Payment Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Booking not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while processing checkout payment",
    });
  }
};

// ---------------------------------------------------------------------------
// @desc    Get user's payment transaction history
// @route   GET /api/v1/payments/my
// @access  Customer
// ---------------------------------------------------------------------------
export const getMyPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.user._id })
      .populate({
        path: "booking",
        populate: { path: "car" },
      })
      .populate("user", "name email phoneNumber")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Get My Payments Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching payment history",
    });
  }
};

// ---------------------------------------------------------------------------
// @desc    Get all payment records
// @route   GET /api/v1/payments
// @access  Admin
// ---------------------------------------------------------------------------
export const getAllPayments = async (req, res) => {
  try {
    const { status, from, to, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (status) filter.status = status.toUpperCase();
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate({
          path: "booking",
          populate: { path: "car" },
        })
        .populate("user", "name email phoneNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      Payment.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: payments.length,
      payments,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get All Payments Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching all payments",
    });
  }
};

// ---------------------------------------------------------------------------
// @desc    Get single payment record by ID
// @route   GET /api/v1/payments/:id
// @access  Protected (Owner / Admin)
// ---------------------------------------------------------------------------
export const getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate({
        path: "booking",
        populate: { path: "car" },
      })
      .populate("user", "name email phoneNumber");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Verify ownership (must be payment owner or Admin)
    if (
      payment.user._id.toString() !== req.user._id.toString() &&
      req.user.role !== "ADMIN"
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to access this payment record",
      });
    }

    return res.status(200).json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("Get Payment By ID Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Payment record not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching payment details",
    });
  }
};

// ---------------------------------------------------------------------------
// @desc    Get payment status for a booking (Frontend polls after Baray redirect)
// @route   GET /api/v1/payments/booking/:bookingId
// @access  Protected (Owner / Admin)
// ---------------------------------------------------------------------------
export const getPaymentByBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const booking = await Booking.findById(bookingId)
      .populate("car")
      .populate("customer");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found",
      });
    }

    const bookingCustomerId =
      booking.customer?._id?.toString() || booking.customer?.toString();
    const isCustomer =
      bookingCustomerId === req.user._id.toString() ||
      (req.user.sub && booking.customer?.sub === req.user.sub);
    const isAdmin = req.user.role?.toUpperCase() === "ADMIN";

    if (!isCustomer && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view payment for this booking",
      });
    }

    const payment = await Payment.findOne({ booking: bookingId })
      .sort({ createdAt: -1 })
      .populate("user", "name email phoneNumber");

    return res.status(200).json({
      success: true,
      booking: {
        _id: booking._id,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        paymentDetails: booking.paymentDetails,
        totalPrice: booking.totalPrice,
      },
      payment: payment || null,
    });
  } catch (error) {
    console.error("Get Payment By Booking Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Invalid booking ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching booking payment status",
    });
  }
};

// ---------------------------------------------------------------------------
// @desc    Process refund on a payment (Admin only)
// @route   POST /api/v1/payments/:id/refund
// @access  Admin
// ---------------------------------------------------------------------------
export const refundPayment = async (req, res) => {
  try {
    const { amount, reason } = req.body;
    const payment = await Payment.findById(req.params.id).populate("booking");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    if (payment.status === "REFUNDED") {
      return res.status(400).json({
        success: false,
        message: "This payment has already been refunded",
      });
    }

    payment.status = "REFUNDED";
    await payment.save();

    if (payment.booking) {
      const booking = await Booking.findById(payment.booking._id);
      if (booking) {
        booking.paymentStatus = "REFUNDED";
        if (booking.status !== "COMPLETED") {
          booking.status = "CANCELLED";
          if (reason) booking.cancellationReason = `Refunded: ${reason}`;
        }
        await booking.save();
      }
    }

    return res.status(200).json({
      success: true,
      message: "Payment refunded successfully",
      refundAmount: amount || payment.amount,
      payment,
    });
  } catch (error) {
    console.error("Refund Payment Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Payment not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while processing refund",
    });
  }
};


