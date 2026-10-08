import express from "express";
import {
  getCars,
  getMyCars,
  getCarById,
  getCarBookedDates,
  getCarReviews,
  createCar,
  updateCar,
  updateCarStatus,
  deleteCar,
  deleteCarPhoto,
} from "../controllers/carController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import { uploadCarPhotos } from "../middlewares/uploadMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getCars);

// Host routes (Must be before /:id)
router.get("/my", protect, authorize("HOST", "ADMIN"), getMyCars);

// Single car and related public routes
router.get("/:id", getCarById);
router.get("/:id/booked-dates", getCarBookedDates);
router.get("/:id/reviews", getCarReviews);

// Host / Admin management routes
router.post("/", protect, authorize("HOST", "ADMIN"), uploadCarPhotos, createCar);
router.put("/:id", protect, authorize("HOST", "ADMIN"), uploadCarPhotos, updateCar);
router.patch("/:id", protect, authorize("HOST", "ADMIN"), uploadCarPhotos, updateCar);
router.patch("/:id/status", protect, authorize("HOST", "ADMIN"), updateCarStatus);
router.delete("/:id", protect, authorize("HOST", "ADMIN"), deleteCar);
router.delete("/:id/photos/:photoId", protect, authorize("HOST", "ADMIN"), deleteCarPhoto);

export default router;
