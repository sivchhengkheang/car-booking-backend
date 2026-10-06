import mongoose from "mongoose";

const carSchema = new mongoose.Schema(
  {
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    brand: {
      type: String,
      required: [true, "Car brand is required"],
      trim: true,
    },
    modelName: {
      type: String,
      required: [true, "Car model name is required"],
      trim: true,
    },
    year: {
      type: Number,
      required: [true, "Manufacture year is required"],
    },
    licensePlate: {
      type: String,
      required: [true, "License plate is required"],
      unique: true,
      trim: true,
      uppercase: true,
    },
    category: {
      type: String,
      enum: ["Sedan", "SUV", "Hatchback", "Truck", "Van", "Luxury", "Electric", "Convertible", "Other"],
      default: "Sedan",
    },
    seats: {
      type: Number,
      default: 5,
    },
    transmission: {
      type: String,
      enum: ["Automatic", "Manual"],
      default: "Automatic",
    },
    fuelType: {
      type: String,
      enum: ["Gasoline", "Diesel", "Electric", "Hybrid"],
      default: "Gasoline",
    },
    pricePerDay: {
      type: Number,
      required: [true, "Daily rental price is required"],
      min: [0, "Price per day cannot be negative"],
    },
    photos: [
      {
        type: String,
      },
    ],
    location: {
      address: { type: String, trim: true },
      city: { type: String, trim: true },
      latitude: { type: Number },
      longitude: { type: Number },
    },
    description: {
      type: String,
      trim: true,
    },
    features: [
      {
        type: String,
      },
    ],
    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Index for search/filter queries
carSchema.index({ brand: 1, isAvailable: 1, pricePerDay: 1 });

export const Car = mongoose.model("Car", carSchema);
