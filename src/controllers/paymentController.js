import crypto from "crypto";
import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";

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
// @access  Customer
// ---------------------------------------------------------------------------
export const checkoutPayment = async (req, res) => {
  try {
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid bookingId",
      });
    }

    // Find booking and verify it belongs to the logged-in customer
    const booking = await Booking.findOne({
      _id: bookingId,
      customer: req.user._id,
    }).populate("car");

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: "Booking not found or does not belong to the current user",
      });
    }

    if (booking.paymentStatus === "PAID") {
      return res.status(400).json({
        success: false,
        message: "This booking has already been paid",
      });
    }

    // Build a unique order_id tied to this booking
    const orderId = `ORDER-${booking._id}-${Date.now()}`;

    // Build the payload to encrypt (per Baray spec)
    const payload = {
      amount: booking.totalPrice.toFixed(2),
      currency: "USD",
      order_id: orderId,
      tracking: {
        customer_id: req.user._id.toString(),
        booking_id: booking._id.toString(),
        car: booking.car?.make
          ? `${booking.car.make} ${booking.car.model}`
          : "Car Rental",
      },
      order_details: {
        items: [
          {
            name: booking.car?.make
              ? `${booking.car.make} ${booking.car.model} — ${booking.totalDays} day(s)`
              : `Car Rental — ${booking.totalDays} day(s)`,
            price: booking.totalPrice,
          },
        ],
      },
      custom_success_url: `${process.env.CLIENT_URL || "http://localhost:3000"}/booking/success?bookingId=${booking._id}`,
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
        message: errorBody.error || "Failed to create payment intent with Baray",
      });
    }

    const intent = await barayResponse.json();
    const paymentUrl = `https://pay.baray.io/${intent._id}`;

    // Store Baray intent details on the booking (still PENDING until webhook confirms)
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
      amount: booking.totalPrice,
      currency: "USD",
      status: "PENDING",
      paymentMethod: "KHQR",
      barayOrderId: orderId,
      barayIntentId: intent._id,
    });

    return res.status(200).json({
      success: true,
      message: "Payment intent created. Redirect customer to paymentUrl.",
      checkout: {
        paymentId: paymentRecord._id,
        bookingId: booking._id,
        orderId,
        intentId: intent._id,
        amount: booking.totalPrice,
        currency: "USD",
        paymentUrl,       // Frontend redirects customer here
        status: booking.paymentStatus,
      },
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
    const payments = await Payment.find()
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
// @access  Protected
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

