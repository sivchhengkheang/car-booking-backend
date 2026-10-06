import { Car } from "../models/Car.js";
import { Booking } from "../models/Booking.js";

// @desc    Add a new car with photo uploads
// @route   POST /api/v1/cars
// @access  Host / Admin
export const createCar = async (req, res) => {
  try {
    const {
      brand,
      modelName,
      year,
      licensePlate,
      category,
      seats,
      transmission,
      fuelType,
      pricePerDay,
      location,
      description,
      features,
    } = req.body;

    // Process photo uploads
    let photos = [];
    if (req.files && req.files.length > 0) {
      photos = req.files.map((file) => `/uploads/cars/${file.filename}`);
    } else if (req.body.photos) {
      photos = Array.isArray(req.body.photos)
        ? req.body.photos
        : [req.body.photos];
    }

    // Parse location if it's sent as JSON string in form-data
    let parsedLocation = {};
    if (typeof location === "string") {
      try {
        parsedLocation = JSON.parse(location);
      } catch (err) {
        parsedLocation = { address: location };
      }
    } else if (location && typeof location === "object") {
      parsedLocation = location;
    }

    // Parse features if sent as string or JSON
    let parsedFeatures = [];
    if (typeof features === "string") {
      try {
        parsedFeatures = JSON.parse(features);
      } catch (err) {
        parsedFeatures = features.split(",").map((f) => f.trim());
      }
    } else if (Array.isArray(features)) {
      parsedFeatures = features;
    }

    // Validate required fields
    if (!brand || !modelName || !year || !licensePlate || !pricePerDay) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: brand, modelName, year, licensePlate, and pricePerDay are required",
      });
    }

    // Check for existing license plate
    const existingCar = await Car.findOne({
      licensePlate: licensePlate.toUpperCase(),
    });
    if (existingCar) {
      return res.status(400).json({
        success: false,
        message: "A car with this license plate already exists",
      });
    }

    const newCar = await Car.create({
      host: req.user._id,
      brand,
      modelName,
      year: Number(year),
      licensePlate: licensePlate.toUpperCase(),
      category: category || "Sedan",
      seats: seats ? Number(seats) : 5,
      transmission: transmission || "Automatic",
      fuelType: fuelType || "Gasoline",
      pricePerDay: Number(pricePerDay),
      photos,
      location: parsedLocation,
      description,
      features: parsedFeatures,
    });

    const populatedCar = await Car.findById(newCar._id).populate(
      "host",
      "name email phoneNumber"
    );

    return res.status(201).json({
      success: true,
      message: "Car listed successfully",
      car: populatedCar,
    });
  } catch (error) {
    console.error("Create Car Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while creating car listing",
    });
  }
};

// @desc    Browse cars with query filters (?start=&end=&brand=)
// @route   GET /api/v1/cars
// @access  Public
export const getCars = async (req, res) => {
  try {
    const { start, end, brand, category, minPrice, maxPrice, city } = req.query;

    const filter = { isAvailable: true };

    // Brand filter (case-insensitive substring match)
    if (brand) {
      filter.brand = new RegExp(brand, "i");
    }

    // Category filter
    if (category) {
      filter.category = category;
    }

    // Price range filter
    if (minPrice || maxPrice) {
      filter.pricePerDay = {};
      if (minPrice) filter.pricePerDay.$gte = Number(minPrice);
      if (maxPrice) filter.pricePerDay.$lte = Number(maxPrice);
    }

    // City filter
    if (city) {
      filter["location.city"] = new RegExp(city, "i");
    }

    // Date range filter for checking car availability against existing bookings
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);

      if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
        // Find cars that are already booked during the specified date range
        const overlappingBookings = await Booking.find({
          status: { $in: ["PROVISIONAL", "CONFIRMED", "ACTIVE"] },
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
        }).select("car");

        const occupiedCarIds = overlappingBookings.map((b) => b.car);
        filter._id = { $nin: occupiedCarIds };
      }
    }

    const cars = await Car.find(filter)
      .populate("host", "name email phoneNumber")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: cars.length,
      cars,
    });
  } catch (error) {
    console.error("Get Cars Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching cars",
    });
  }
};

// @desc    Get single car details & host info
// @route   GET /api/v1/cars/:id
// @access  Public
export const getCarById = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id).populate(
      "host",
      "name email phoneNumber driverLicense"
    );

    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    return res.status(200).json({
      success: true,
      car,
    });
  } catch (error) {
    console.error("Get Car By ID Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Car not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching car details",
    });
  }
};
