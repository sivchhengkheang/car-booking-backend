import crypto from "crypto";
import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";
import { releaseCarLock, invalidateCarCache } from "../services/redisService.js";

// ---------------------------------------------------------------------------
// Baray AES-256-CBC Decryption
// Decrypts the encrypted_order_id received from Baray's webhook payload
// ---------------------------------------------------------------------------
function decryptOrderId(encryptedOrderId) {
  const sk = process.env.BARAY_SK;
  const iv = process.env.BARAY_IV;

  if (!sk || !iv) {
    throw new Error("BARAY_SK and BARAY_IV environment variables are required");
  }

  const key = Buffer.from(sk, "base64");
  const ivBuffer = Buffer.from(iv, "base64");
  const encryptedData = Buffer.from(encryptedOrderId, "base64");

  const decipher = crypto.createDecipheriv("aes-256-cbc", key, ivBuffer);
  let decrypted = decipher.update(encryptedData);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}

// ---------------------------------------------------------------------------
// @desc    Receive Baray webhook and confirm booking on successful payment
// @route   POST /api/v1/payments/webhook/baray
// @access  Public (Baray calls this — no auth token)
// ---------------------------------------------------------------------------
export const barayWebhook = async (req, res) => {
  // Always respond 200 quickly — Baray will retry if we don't
  try {
    const { encrypted_order_id, bank } = req.body;

    if (!encrypted_order_id) {
      console.warn("Baray webhook: missing encrypted_order_id");
      return res.status(200).send("OK");
    }

    // Decrypt to get our original order_id (e.g. "ORDER-<bookingId>-<timestamp>")
    let orderId;
    try {
      orderId = decryptOrderId(encrypted_order_id);
    } catch (decryptErr) {
      console.error("Baray webhook decryption failed:", decryptErr.message);
      // Respond 200 anyway — bad payload, nothing we can do
      return res.status(200).send("OK");
    }

    console.log(`Baray webhook received — orderId: ${orderId}, bank: ${bank}`);

    // Look up the booking by barayOrderId, or via payment record
    let booking = await Booking.findOne({
      "paymentDetails.barayOrderId": orderId,
    });

    let payment = await Payment.findOne({ barayOrderId: orderId });
    if (!booking && payment?.booking) {
      booking = await Booking.findById(payment.booking);
    }

    if (!booking) {
      console.warn(`Baray webhook: no booking found for orderId=${orderId}`);
      return res.status(200).send("OK");
    }

    // Update or create payment record in the payments collection
    const paidDate = new Date();
    if (payment) {
      payment.status = "COMPLETED";
      payment.bank = bank || null;
      payment.paidAt = paidDate;
      await payment.save();
    } else {
      payment = await Payment.create({
        booking: booking._id,
        user: booking.customer,
        amount: booking.totalPrice,
        currency: "USD",
        status: "COMPLETED",
        paymentMethod: "KHQR",
        barayOrderId: orderId,
        barayIntentId: booking.paymentDetails?.barayIntentId,
        bank: bank || null,
        paidAt: paidDate,
      });
    }

    // Idempotency guard — skip booking update if already paid
    if (booking.paymentStatus === "PAID") {
      console.log(`Baray webhook: booking ${booking._id} already confirmed, skipping`);
      return res.status(200).send("OK");
    }

    // Confirm the booking
    booking.paymentStatus = "PAID";
    booking.status = "CONFIRMED";
    booking.paymentDetails.bank = bank || null;
    booking.paymentDetails.paidAt = paidDate;

    await booking.save();

    // Release temporary 15-minute checkout lock & invalidate car caches
    if (booking.car) {
      const carId = booking.car._id
        ? booking.car._id.toString()
        : booking.car.toString();
      await releaseCarLock(carId);
      await invalidateCarCache(carId);
    }

    console.log(`Booking ${booking._id} confirmed & Payment ${payment._id} updated via Baray webhook (bank: ${bank})`);

    return res.status(200).send("OK");
  } catch (error) {
    console.error("Baray Webhook Error:", error);
    // Always respond 200 so Baray doesn't keep retrying indefinitely
    return res.status(200).send("OK");
  }
};

