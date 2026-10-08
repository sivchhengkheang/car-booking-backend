import mongoose from "mongoose";
import redisClient from "../config/redis.js";
import { User } from "../models/User.js";
import { Car } from "../models/Car.js";
import { Booking } from "../models/Booking.js";
import { Payment } from "../models/Payment.js";

// @desc    Detailed system health status
// @route   GET /api/v1/health
// @access  Public
export const getHealth = async (req, res) => {
  try {
    const dbStatus = mongoose.connection.readyState === 1 ? "CONNECTED" : "DISCONNECTED";
    const redisStatus = redisClient.isReady ? "CONNECTED" : "DISCONNECTED";

    return res.status(200).json({
      success: true,
      status: "HEALTHY",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      services: {
        database: {
          status: dbStatus,
        },
        cache: {
          status: redisStatus,
        },
      },
    });
  } catch (error) {
    console.error("Health check error:", error);
    return res.status(500).json({
      success: false,
      status: "DEGRADED",
      error: error.message,
    });
  }
};

// @desc    Admin dashboard stats and analytics
// @route   GET /api/v1/admin/stats
// @access  Admin
export const getAdminStats = async (req, res) => {
  try {
    const { from, to } = req.query;

    const [
      totalUsers,
      totalCustomers,
      totalHosts,
      totalCars,
      activeCars,
      bookingStatusCounts,
      revenueData,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: "CUSTOMER" }),
      User.countDocuments({ role: "HOST" }),
      Car.countDocuments({ isDeleted: { $ne: true } }),
      Car.countDocuments({ isAvailable: true, status: "AVAILABLE", isDeleted: { $ne: true } }),
      Booking.aggregate([
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ]),
      Payment.aggregate([
        { $match: { status: { $in: ["COMPLETED", "SUCCESS", "PAID"] } } },
        { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
      ]),
    ]);

    // Parse status breakdown into clean object
    const bookingsByStatus = {};
    bookingStatusCounts.forEach((item) => {
      bookingsByStatus[item._id] = item.count;
    });

    // Period revenue if ?from= or ?to= is specified
    let periodRevenue = null;
    if (from || to) {
      const matchCriteria = { status: { $in: ["COMPLETED", "SUCCESS", "PAID"] }, createdAt: {} };
      if (from) matchCriteria.createdAt.$gte = new Date(from);
      if (to) matchCriteria.createdAt.$lte = new Date(to);

      const periodAgg = await Payment.aggregate([
        { $match: matchCriteria },
        { $group: { _id: null, revenue: { $sum: "$amount" } } },
      ]);
      periodRevenue = periodAgg.length > 0 ? periodAgg[0].revenue : 0;
    }

    return res.status(200).json({
      success: true,
      stats: {
        users: {
          total: totalUsers,
          customers: totalCustomers,
          hosts: totalHosts,
        },
        cars: {
          total: totalCars,
          activeAvailable: activeCars,
        },
        bookings: bookingsByStatus,
        revenue: {
          allTime: revenueData.length > 0 ? revenueData[0].totalRevenue : 0,
          periodRevenue,
          currency: "USD",
        },
      },
    });
  } catch (error) {
    console.error("Admin Stats Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while calculating admin stats",
    });
  }
};
