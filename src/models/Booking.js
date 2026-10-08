import mongoose from "mongoose";

const bookingSchema = new mongoose.Schema(
  {
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    car: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Car",
      required: true,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    totalDays: {
      type: Number,
      required: true,
      min: 1,
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: [
        "PROVISIONAL",
        "PENDING_PAYMENT",
        "PAID",
        "CONFIRMED",
        "ACTIVE",
        "COMPLETED",
        "CANCELLED",
        "EXPIRED",
      ],
      default: "PENDING_PAYMENT",
    },
    holdExpiresAt: {
      type: Date,
    },
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REFUNDED", "EXPIRED"],
      default: "PENDING",
    },
    paymentDetails: {
      barayIntentId: { type: String },   // itn-{uuid} from Baray
      barayOrderId: { type: String },    // our unique order_id sent to Baray
      barayPaymentUrl: { type: String }, // https://pay.baray.io/{intent_id}
      bank: { type: String },            // bank code from webhook (aba, acleda, spn, wing)
      paidAt: { type: Date },
      paymentMethod: { type: String, default: "KHQR" },
    },
    pickupConfirmedAt: {
      type: Date,
    },
    confirmedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    completedAt: {
      type: Date,
    },
    returnNotes: {
      type: String,
      trim: true,
    },
    damageReported: {
      type: Boolean,
      default: false,
    },
    fuelLevel: {
      type: String,
    },
    mileage: {
      type: Number,
    },
    cancellationReason: {
      type: String,
      trim: true,
    },
    idempotencyKey: {
      type: String,
    },
  },
  { timestamps: true }
);

// Index for date range overlaps and customer queries
bookingSchema.index({ car: 1, startDate: 1, endDate: 1, status: 1 });
bookingSchema.index({ customer: 1, createdAt: -1 });
bookingSchema.index({ "paymentDetails.barayOrderId": 1 }); // fast lookup by Baray order_id
bookingSchema.index({ holdExpiresAt: 1, status: 1 }); // fast lookup for 15-minute expiration worker

export const Booking = mongoose.model("Booking", bookingSchema);
