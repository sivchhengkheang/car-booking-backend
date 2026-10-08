import { createClient } from "redis";
import dotenv from "dotenv";

dotenv.config();

let redisUrl = process.env.REDIS_URL;

if (!redisUrl && process.env.UPSTASH_REDIS_REST_URL) {
  try {
    const parsed = new URL(process.env.UPSTASH_REDIS_REST_URL);
    const token = process.env.UPSTASH_REDIS_REST_TOKEN || "";
    if (parsed.protocol === "https:" && token) {
      redisUrl = `rediss://default:${token}@${parsed.hostname}:6379`;
    } else {
      redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    }
  } catch (err) {
    redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  }
}

if (!redisUrl) {
  redisUrl = "redis://localhost:6379";
}

const redisClient = createClient({
  url: redisUrl,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        return new Error("Redis reconnect limit reached");
      }
      return Math.min(retries * 100, 3000);
    },
  },
});

redisClient.on("connect", () => {
  console.log("Redis connected successfully");
});

redisClient.on("error", (err) => {
  console.error("Redis client error:", err.message);
});

try {
  await redisClient.connect();
} catch (err) {
  console.error("Initial Redis connection failed:", err.message);
}

export default redisClient;