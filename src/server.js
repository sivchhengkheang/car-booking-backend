import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import cookiesParser from "cookie-parser";
import path from "path";
import { dbConnection } from "./config/db.js";

import authRouter from "./routers/authRouter.js";
import carRouter from "./routers/carRouter.js";
import bookingRouter from "./routers/bookingRouter.js";
import paymentRouter from "./routers/paymentRouter.js";

dotenv.config();

const app = express();

// When behind a proxy (Render, Heroku, nginx), trust proxy
app.set("trust proxy", 1);
const PORT = process.env.PORT || 5000;

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use(cookiesParser());

// Serve static uploaded files (car photos)
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// Configure CORS
const rawClientUrls = process.env.CLIENT_URL || "http://localhost:3000,http://localhost:3001";
const allowedOrigins = rawClientUrls
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedOrigin = origin.replace(/\/+$/, "");

    if (allowedOrigins.includes(normalizedOrigin)) return callback(null, true);

    if (
      normalizedOrigin.startsWith("http://localhost:") ||
      normalizedOrigin.startsWith("http://127.0.0.1:") ||
      normalizedOrigin === "http://localhost" ||
      normalizedOrigin === "http://127.0.0.1"
    ) {
      return callback(null, true);
    }

    if (
      process.env.ALLOW_VERCEL_PREVIEWS === "true" ||
      normalizedOrigin.endsWith(".vercel.app")
    ) {
      return callback(null, true);
    }

    if (process.env.NODE_ENV !== "production") return callback(null, true);

    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
  ],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));

// Health check endpoint
app.get("/", (req, res) => {
  res.status(200).json({ status: "OK", message: "Car Booking API Server is running" });
});

// API Routes
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/cars", carRouter);
app.use("/api/v1/bookings", bookingRouter);
app.use("/api/v1/payments", paymentRouter);

// Alias routes for /api/auth
app.use("/api/auth", authRouter);

// 404 Route handler
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global Error Handler:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

const start = async () => {
  try {
    await dbConnection();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server due to DB connection error:", err);
  }
};

start();