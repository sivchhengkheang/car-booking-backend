import multer from "multer";

// File filter for images only
const fileFilter = (req, file, cb) => {
  if (file.mimetype && file.mimetype.startsWith("image/")) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed!"), false);
  }
};

// Memory storage keeps file buffer in memory for direct cloud upload
const storage = multer.memoryStorage();

export const uploadCarPhotos = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit per file
    files: 5, // max 5 photos
  },
}).array("photos", 5);
