import express from "express";
import {
  getCars,
  getCarById,
  createCar,
} from "../controllers/carController.js";
import { protect, authorize } from "../middlewares/authMiddleware.js";
import { uploadCarPhotos } from "../middlewares/uploadMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getCars);
router.get("/:id", getCarById);

// Host / Admin route for listing new cars with photos
router.post("/", protect, authorize("HOST", "ADMIN"), uploadCarPhotos, createCar);

export default router;
