import redisClient from "../config/redis.js";

/**
 * Default cache TTLs (in seconds)
 */
export const CACHE_TTL = {
  CARS_LIST: 600,       // 10 minutes for car browse/filter results
  CAR_DETAILS: 1800,    // 30 minutes for single car details
  BOOKED_DATES: 600,    // 10 minutes for booked date calendar ranges
  RESERVATION_LOCK: 900 // 15 minutes (900 seconds) for checkout lock
};

/**
 * Retrieve cached JSON data by key
 */
export const getCache = async (key) => {
  try {
    if (!redisClient.isReady) return null;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.warn(`Redis getCache error for key [${key}]:`, error.message);
    return null;
  }
};

/**
 * Store data in cache with TTL
 */
export const setCache = async (key, data, ttlSeconds = CACHE_TTL.CARS_LIST) => {
  try {
    if (!redisClient.isReady) return false;
    await redisClient.set(key, JSON.stringify(data), { EX: ttlSeconds });
    return true;
  } catch (error) {
    console.warn(`Redis setCache error for key [${key}]:`, error.message);
    return false;
  }
};

/**
 * Delete a specific cache key
 */
export const delCache = async (key) => {
  try {
    if (!redisClient.isReady) return false;
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.warn(`Redis delCache error for key [${key}]:`, error.message);
    return false;
  }
};

/**
 * Invalidate multiple cache keys matching a pattern (e.g. "cars:list:*")
 */
export const deleteCachePattern = async (pattern) => {
  try {
    if (!redisClient.isReady) return;
    const keysToDelete = [];
    for await (const chunk of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(chunk)) {
        keysToDelete.push(...chunk);
      } else if (chunk) {
        keysToDelete.push(chunk);
      }
    }

    if (keysToDelete.length > 0) {
      for (const k of keysToDelete) {
        await redisClient.del(k);
      }
    }
  } catch (error) {
    console.warn(`Redis deleteCachePattern error for pattern [${pattern}]:`, error.message);
  }
};


/**
 * Invalidate all car-related caches (list, detail, booked dates)
 */
export const invalidateCarCache = async (carId = null) => {
  await deleteCachePattern("cars:list:*");
  if (carId) {
    await delCache(`cars:detail:${carId}`);
    await delCache(`cars:booked:${carId}`);
  }
};

// ---------------------------------------------------------------------------
// 15-Minute Reservation Lock (Atomic Checkout Hold)
// ---------------------------------------------------------------------------

/**
 * Acquire an atomic lock on a car for checkout (SET key value NX EX seconds).
 *
 * @param {string} carId - The ID of the car being reserved.
 * @param {Object} lockData - { bookingId, customerId, startDate, endDate }
 * @param {number} ttlSeconds - Expiration in seconds (default 900 = 15 minutes)
 * @returns {Promise<{ acquired: boolean, heldByOther: boolean, lock?: Object }>}
 */
export const acquireCarLock = async (
  carId,
  lockData,
  ttlSeconds = CACHE_TTL.RESERVATION_LOCK
) => {
  const lockKey = `lock:car:${carId}`;

  try {
    if (!redisClient.isReady) {
      // If Redis is temporarily down, allow operation so users aren't completely blocked
      console.warn("Redis client not ready, bypassing checkout lock");
      return { acquired: true, bypassed: true };
    }

    const payload = {
      ...lockData,
      lockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };

    // Check if lock already exists
    const existingLockStr = await redisClient.get(lockKey);
    if (existingLockStr) {
      let existingLock;
      try {
        existingLock = JSON.parse(existingLockStr);
      } catch {
        existingLock = { bookingId: existingLockStr };
      }

      // Check if current user / booking already owns this lock
      const isOwner =
        (lockData.bookingId && String(existingLock.bookingId) === String(lockData.bookingId)) ||
        (lockData.customerId && String(existingLock.customerId) === String(lockData.customerId));

      if (isOwner) {
        // Re-entrant: Refresh TTL
        await redisClient.set(lockKey, JSON.stringify(payload), { EX: ttlSeconds });
        return { acquired: true, isReentrant: true, lock: payload };
      }

      // Held by another customer
      return { acquired: false, heldByOther: true, lock: existingLock };
    }

    // Attempt atomic lock acquisition with NX (Only set if not exists) and EX (expire seconds)
    const result = await redisClient.set(lockKey, JSON.stringify(payload), {
      NX: true,
      EX: ttlSeconds,
    });

    if (result === "OK") {
      return { acquired: true, lock: payload };
    }

    // If result was null, another request set the lock concurrently in the milliseconds between
    const currentLock = await getCache(lockKey);
    return { acquired: false, heldByOther: true, lock: currentLock };
  } catch (error) {
    console.error(`Error acquiring reservation lock for car [${carId}]:`, error.message);
    // In case of error, fail open or return acquired: true so service is not halted
    return { acquired: true, bypassed: true };
  }
};

/**
 * Release an active reservation lock.
 *
 * @param {string} carId - The ID of the car.
 * @param {string|null} ownerIdentifier - Optional bookingId or customerId to ensure only owner releases.
 */
export const releaseCarLock = async (carId, ownerIdentifier = null) => {
  const lockKey = `lock:car:${carId}`;

  try {
    if (!redisClient.isReady) return false;

    if (ownerIdentifier) {
      const currentLockStr = await redisClient.get(lockKey);
      if (currentLockStr) {
        let currentLock;
        try {
          currentLock = JSON.parse(currentLockStr);
        } catch {
          currentLock = { bookingId: currentLockStr };
        }

        const isOwner =
          String(currentLock.bookingId) === String(ownerIdentifier) ||
          String(currentLock.customerId) === String(ownerIdentifier);

        if (!isOwner) {
          // Lock belongs to someone else; do not delete
          return false;
        }
      }
    }

    await redisClient.del(lockKey);
    return true;
  } catch (error) {
    console.error(`Error releasing reservation lock for car [${carId}]:`, error.message);
    return false;
  }
};

/**
 * Get active reservation lock details for a car, or null if unlocked.
 */
export const getCarLock = async (carId) => {
  return await getCache(`lock:car:${carId}`);
};
