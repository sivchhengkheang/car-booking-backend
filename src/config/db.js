import mongoose from "mongoose";

export const dbConnection = async () => {
  const mongoUri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/car_booking";
  try {
    const conn = await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.warn(`MongoDB Connection Warning (${error.message}). Server running with API routes active.`);
  }
};
