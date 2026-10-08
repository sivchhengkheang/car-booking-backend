import mongoose from "mongoose";
import { Car } from "../models/Car.js";
import { Booking } from "../models/Booking.js";
import { Review } from "../models/Review.js";
import {
  getCache,
  setCache,
  invalidateCarCache,
  getCarLock,
  CACHE_TTL,
} from "../services/redisService.js";

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
      status: req.body.status ? req.body.status.toUpperCase() : "AVAILABLE",
      isAvailable:
        req.body.isAvailable !== undefined
          ? req.body.isAvailable === true || req.body.isAvailable === "true"
          : req.body.status
          ? req.body.status.toUpperCase() === "AVAILABLE"
          : true,
    });

    const populatedCar = await Car.findById(newCar._id).populate(
      "host",
      "name email phoneNumber"
    );

    // Invalidate car listing caches so newly created car is immediately visible
    await invalidateCarCache();

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

// @desc    Browse cars with query filters, pagination, and sorting
// @route   GET /api/v1/cars
// @access  Public
export const getCars = async (req, res) => {
  try {
    const {
      start,
      end,
      brand,
      category,
      minPrice,
      maxPrice,
      city,
      page = 1,
      limit = 20,
      sort = "createdAt:desc",
    } = req.query;

    const filter = { isAvailable: true, isDeleted: { $ne: true } };

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
        const now = new Date();
        const overlappingBookings = await Booking.find({
          startDate: { $lt: endDate },
          endDate: { $gt: startDate },
          $or: [
            { status: { $in: ["PAID", "CONFIRMED", "ACTIVE"] } },
            {
              status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
              holdExpiresAt: { $gt: now },
            },
          ],
        }).select("car");

        const occupiedCarIds = overlappingBookings.map((b) => b.car);
        filter._id = { $nin: occupiedCarIds };
      }
    }

    // Parse sort
    let sortObj = { createdAt: -1 };
    if (sort) {
      const [field, direction] = String(sort).split(":");
      const dir = direction === "asc" ? 1 : -1;
      if (field === "price" || field === "pricePerDay") {
        sortObj = { pricePerDay: dir };
      } else if (field === "year") {
        sortObj = { year: dir };
      } else if (field === "createdAt") {
        sortObj = { createdAt: dir };
      }
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    // Build deterministic cache key
    const queryKeys = Object.keys(req.query).sort();
    const queryString = queryKeys
      .map((k) => `${k}=${encodeURIComponent(req.query[k])}`)
      .join("&");
    const cacheKey = `cars:list:${queryString || "default"}`;

    // 1. Check Redis cache first
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    const [cars, total] = await Promise.all([
      Car.find(filter)
        .populate("host", "name email phoneNumber")
        .sort(sortObj)
        .skip(skip)
        .limit(pageLimit),
      Car.countDocuments(filter),
    ]);

    const responseData = {
      success: true,
      count: cars.length,
      cars,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    };

    // 2. Cache query results in Redis
    await setCache(cacheKey, responseData, CACHE_TTL.CARS_LIST);

    return res.status(200).json(responseData);
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
    const cacheKey = `cars:detail:${req.params.id}`;

    // 1. Check Redis cache first
    const cachedCar = await getCache(cacheKey);
    if (cachedCar) {
      return res.status(200).json({
        success: true,
        car: cachedCar,
      });
    }

    const car = await Car.findOne({
      _id: req.params.id,
      isDeleted: { $ne: true },
    }).populate("host", "name email phoneNumber driverLicense");

    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    // 2. Cache single car detail in Redis
    await setCache(cacheKey, car, CACHE_TTL.CAR_DETAILS);

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

// @desc    Get booked dates for a car
// @route   GET /api/v1/cars/:id/booked-dates
// @access  Public
export const getCarBookedDates = async (req, res) => {
  try {
    const cacheKey = `cars:booked:${req.params.id}`;

    // 1. Check Redis cache first
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.status(200).json(cachedData);
    }

    const now = new Date();
    const bookings = await Booking.find({
      car: req.params.id,
      endDate: { $gte: now }, // only future/ongoing bookings
      $or: [
        { status: { $in: ["PAID", "CONFIRMED", "ACTIVE"] } },
        {
          status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
          holdExpiresAt: { $gt: now },
        },
      ],
    }).select("startDate endDate");

    // Check if car currently has an active 15-minute checkout reservation hold
    const activeLock = await getCarLock(req.params.id);

    const responseData = {
      success: true,
      bookedDates: bookings,
      activeHold: activeLock
        ? {
            isHeld: true,
            expiresAt: activeLock.expiresAt,
          }
        : null,
      holdExpiresAt: activeLock ? activeLock.expiresAt : null,
    };

    // 2. Cache booked dates in Redis
    await setCache(cacheKey, responseData, CACHE_TTL.BOOKED_DATES);

    return res.status(200).json(responseData);
  } catch (error) {
    console.error("Get Car Booked Dates Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching booked dates",
    });
  }
};

// @desc    Update car information, status, and photos
// @route   PUT /api/v1/cars/:id or PATCH /api/v1/cars/:id
// @access  Host (Owner only) / Admin
export const updateCar = async (req, res) => {
  try {
    const { id } = req.params;

    const car = await Car.findById(id);
    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    // Role & Ownership check: Host must own the car, Admin can edit any car
    const isOwner = car.host && car.host.toString() === req.user._id.toString();
    const isAdmin = req.user?.role?.toUpperCase() === "ADMIN";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update this vehicle listing",
      });
    }

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
      isAvailable,
      status,
    } = req.body;

    // License plate update check
    if (licensePlate && licensePlate.trim()) {
      const normalizedPlate = licensePlate.trim().toUpperCase();
      if (normalizedPlate !== car.licensePlate) {
        const existingCar = await Car.findOne({
          licensePlate: normalizedPlate,
          _id: { $ne: car._id },
        });
        if (existingCar) {
          return res.status(400).json({
            success: false,
            message: "A car with this license plate already exists",
          });
        }
        car.licensePlate = normalizedPlate;
      }
    }

    // Update string & numeric fields if provided
    if (brand !== undefined) car.brand = brand.trim();
    if (modelName !== undefined) car.modelName = modelName.trim();
    if (year !== undefined) car.year = Number(year);
    if (category !== undefined) car.category = category;
    if (seats !== undefined) car.seats = Number(seats);
    if (transmission !== undefined) car.transmission = transmission;
    if (fuelType !== undefined) car.fuelType = fuelType;
    if (pricePerDay !== undefined) car.pricePerDay = Number(pricePerDay);
    if (description !== undefined) car.description = description;

    // Status & Availability updates
    if (status !== undefined) {
      const normalizedStatus = String(status).toUpperCase();
      if (!["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"].includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Allowed values are AVAILABLE, UNAVAILABLE, or MAINTENANCE",
        });
      }
      car.status = normalizedStatus;
      car.isAvailable = normalizedStatus === "AVAILABLE";
    }

    if (isAvailable !== undefined) {
      const isAvail = isAvailable === true || isAvailable === "true";
      car.isAvailable = isAvail;
      if (status === undefined) {
        car.status = isAvail ? "AVAILABLE" : "UNAVAILABLE";
      }
    }

    // Location update
    if (location !== undefined) {
      let parsedLocation = {};
      if (typeof location === "string") {
        try {
          parsedLocation = JSON.parse(location);
        } catch (err) {
          parsedLocation = { address: location };
        }
      } else if (typeof location === "object" && location !== null) {
        parsedLocation = location;
      }
      const existingLocation = car.location ? car.location.toObject?.() || car.location : {};
      car.location = { ...existingLocation, ...parsedLocation };
    }

    // Features update
    if (features !== undefined) {
      let parsedFeatures = [];
      if (typeof features === "string") {
        try {
          parsedFeatures = JSON.parse(features);
        } catch (err) {
          parsedFeatures = features.split(",").map((f) => f.trim()).filter(Boolean);
        }
      } else if (Array.isArray(features)) {
        parsedFeatures = features;
      }
      car.features = parsedFeatures;
    }

    // Photos update
    let newPhotos = [];
    if (req.files && req.files.length > 0) {
      newPhotos = req.files.map((file) => `/uploads/cars/${file.filename}`);
    }

    if (req.body.photos !== undefined) {
      let specifiedPhotos = [];
      if (typeof req.body.photos === "string") {
        try {
          specifiedPhotos = JSON.parse(req.body.photos);
        } catch (err) {
          specifiedPhotos = [req.body.photos];
        }
      } else if (Array.isArray(req.body.photos)) {
        specifiedPhotos = req.body.photos;
      }
      car.photos = [...specifiedPhotos, ...newPhotos];
    } else if (newPhotos.length > 0) {
      // Append newly uploaded photos to existing photos
      car.photos = [...car.photos, ...newPhotos];
    }

    await car.save();

    // Invalidate Redis caches for this car and lists
    await invalidateCarCache(car._id.toString());

    const populatedCar = await Car.findById(car._id).populate(
      "host",
      "name email phoneNumber driverLicense"
    );

    return res.status(200).json({
      success: true,
      message: "Car updated successfully",
      car: populatedCar,
    });
  } catch (error) {
    console.error("Update Car Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Car not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while updating car listing",
    });
  }
};

// @desc    Update car status / availability only
// @route   PATCH /api/v1/cars/:id/status
// @access  Host (Owner only) / Admin
export const updateCarStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, isAvailable } = req.body;

    if (status === undefined && isAvailable === undefined) {
      return res.status(400).json({
        success: false,
        message: "Please provide 'status' (AVAILABLE, UNAVAILABLE, MAINTENANCE) or 'isAvailable' (boolean)",
      });
    }

    const car = await Car.findById(id);
    if (!car) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    // Role & Ownership check
    const isOwner = car.host && car.host.toString() === req.user._id.toString();
    const isAdmin = req.user?.role?.toUpperCase() === "ADMIN";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to update status for this vehicle",
      });
    }

    if (status !== undefined) {
      const normalizedStatus = String(status).toUpperCase();
      if (!["AVAILABLE", "UNAVAILABLE", "MAINTENANCE"].includes(normalizedStatus)) {
        return res.status(400).json({
          success: false,
          message: "Invalid status. Allowed values are AVAILABLE, UNAVAILABLE, or MAINTENANCE",
        });
      }
      car.status = normalizedStatus;
      car.isAvailable = normalizedStatus === "AVAILABLE";
    }

    if (isAvailable !== undefined) {
      const isAvail = isAvailable === true || isAvailable === "true";
      car.isAvailable = isAvail;
      if (status === undefined) {
        car.status = isAvail ? "AVAILABLE" : "UNAVAILABLE";
      }
    }

    await car.save();

    // Invalidate Redis caches
    await invalidateCarCache(car._id.toString());

    const populatedCar = await Car.findById(car._id).populate(
      "host",
      "name email phoneNumber driverLicense"
    );

    return res.status(200).json({
      success: true,
      message: `Car status updated to ${car.status}`,
      car: populatedCar,
    });
  } catch (error) {
    console.error("Update Car Status Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Car not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while updating car status",
    });
  }
};

// @desc    Get host's own car listings
// @route   GET /api/v1/cars/my
// @access  Host / Admin
export const getMyCars = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { host: req.user._id, isDeleted: { $ne: true } };

    if (status) {
      filter.status = status.toUpperCase();
    }

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [cars, total] = await Promise.all([
      Car.find(filter)
        .populate("host", "name email phoneNumber")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      Car.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      count: cars.length,
      cars,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get My Cars Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching host cars",
    });
  }
};

// @desc    Soft delete a car listing
// @route   DELETE /api/v1/cars/:id
// @access  Host (Owner only) / Admin
export const deleteCar = async (req, res) => {
  try {
    const { id } = req.params;
    const car = await Car.findById(id);

    if (!car || car.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    const isOwner = car.host && car.host.toString() === req.user._id.toString();
    const isAdmin = req.user?.role?.toUpperCase() === "ADMIN";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to delete this vehicle listing",
      });
    }

    // Check if active or future bookings exist
    const now = new Date();
    const activeBookings = await Booking.find({
      car: car._id,
      endDate: { $gte: now },
      $or: [
        { status: { $in: ["CONFIRMED", "ACTIVE", "PAID"] } },
        {
          status: { $in: ["PROVISIONAL", "PENDING_PAYMENT"] },
          holdExpiresAt: { $gt: now },
        },
      ],
    });

    if (activeBookings.length > 0) {
      return res.status(409).json({
        success: false,
        error: {
          code: "CAR_HAS_ACTIVE_BOOKINGS",
          message: "Cannot delete vehicle with active or upcoming bookings. Complete or cancel them first.",
        },
      });
    }

    car.isDeleted = true;
    car.isAvailable = false;
    car.status = "UNAVAILABLE";
    await car.save();

    await invalidateCarCache(car._id.toString());

    return res.status(200).json({
      success: true,
      message: "Vehicle listing deleted successfully",
    });
  } catch (error) {
    console.error("Delete Car Error:", error);
    if (error.kind === "ObjectId") {
      return res.status(404).json({
        success: false,
        message: "Car not found - invalid ID format",
      });
    }
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while deleting car",
    });
  }
};

// @desc    Remove one photo from car
// @route   DELETE /api/v1/cars/:id/photos/:photoId
// @access  Host (Owner only) / Admin
export const deleteCarPhoto = async (req, res) => {
  try {
    const { id, photoId } = req.params;
    const car = await Car.findById(id);

    if (!car || car.isDeleted) {
      return res.status(404).json({
        success: false,
        message: "Car not found",
      });
    }

    const isOwner = car.host && car.host.toString() === req.user._id.toString();
    const isAdmin = req.user?.role?.toUpperCase() === "ADMIN";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to modify this vehicle listing",
      });
    }

    const decodedTarget = decodeURIComponent(photoId);
    // Support photoId as index (0, 1, ...) or by path/filename match
    const photoIndex = Number(photoId);
    if (!isNaN(photoIndex) && photoIndex >= 0 && photoIndex < car.photos.length) {
      car.photos.splice(photoIndex, 1);
    } else {
      car.photos = car.photos.filter((p) => !p.includes(decodedTarget));
    }

    await car.save();
    await invalidateCarCache(car._id.toString());

    return res.status(200).json({
      success: true,
      message: "Photo deleted successfully",
      photos: car.photos,
    });
  } catch (error) {
    console.error("Delete Car Photo Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while deleting photo",
    });
  }
};

// @desc    Get reviews for a car
// @route   GET /api/v1/cars/:id/reviews
// @access  Public
export const getCarReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const currentPage = Math.max(1, Number(page) || 1);
    const pageLimit = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageLimit;

    const [reviews, total] = await Promise.all([
      Review.find({ car: id })
        .populate("customer", "name email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageLimit),
      Review.countDocuments({ car: id }),
    ]);

    // Calculate average rating
    const ratingAggregate = await Review.aggregate([
      { $match: { car: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: null, avgRating: { $avg: "$rating" } } },
    ]);
    const averageRating =
      ratingAggregate.length > 0
        ? Number(ratingAggregate[0].avgRating.toFixed(1))
        : 0;

    return res.status(200).json({
      success: true,
      count: reviews.length,
      averageRating,
      reviews,
      meta: {
        page: currentPage,
        limit: pageLimit,
        total,
        totalPages: Math.ceil(total / pageLimit) || 1,
      },
    });
  } catch (error) {
    console.error("Get Car Reviews Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Server error while fetching car reviews",
    });
  }
};



