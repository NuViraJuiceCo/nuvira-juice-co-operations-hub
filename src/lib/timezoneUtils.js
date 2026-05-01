/**
 * Timezone Utilities for NuVira
 * 
 * Business Timezone: America/Chicago (handles both CST and CDT automatically)
 * Storage: All timestamps stored in UTC (ISO 8601 format)
 * Display: Convert UTC to America/Chicago for customer/admin-facing times
 */

// Business timezone constant
const BUSINESS_TIMEZONE = 'America/Chicago';

/**
 * Get current time in business timezone
 * @returns {Date} Current moment
 */
export function getNowInBusinessTZ() {
  return new Date();
}

/**
 * Format a UTC timestamp as a business timezone date string
 * Format: MMM d, yyyy (e.g., "May 1, 2026")
 * 
 * @param {string|Date|number} utcTimestamp - ISO string, Date object, or Unix seconds
 * @returns {string} Formatted date in business timezone
 */
export function formatDeliveryDate(utcTimestamp) {
  if (!utcTimestamp) return '';
  
  let date;
  if (typeof utcTimestamp === 'number') {
    // Unix seconds (from Stripe)
    date = new Date(utcTimestamp * 1000);
  } else if (typeof utcTimestamp === 'string') {
    // ISO 8601 string
    date = new Date(utcTimestamp);
  } else {
    // Date object
    date = utcTimestamp;
  }
  
  if (isNaN(date.getTime())) return '';
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: BUSINESS_TIMEZONE,
  });
}

/**
 * Format a UTC timestamp as admin-facing date/time
 * Format: MMM d, yyyy h:mm a z (e.g., "May 1, 2026 2:45 PM CDT")
 * 
 * @param {string|Date|number} utcTimestamp - ISO string, Date object, or Unix seconds
 * @returns {string} Formatted date/time in business timezone
 */
export function formatAdminTimestamp(utcTimestamp) {
  if (!utcTimestamp) return '';
  
  let date;
  if (typeof utcTimestamp === 'number') {
    date = new Date(utcTimestamp * 1000);
  } else if (typeof utcTimestamp === 'string') {
    date = new Date(utcTimestamp);
  } else {
    date = utcTimestamp;
  }
  
  if (isNaN(date.getTime())) return 'Invalid Date';
  
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
  });
}

/**
 * Get current date in business timezone (YYYY-MM-DD)
 * Used for date-based filtering and comparisons
 * 
 * @returns {string} Today's date in business timezone (YYYY-MM-DD)
 */
export function getTodayDateString() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: BUSINESS_TIMEZONE,
  });
  return formatter.format(now);
}

/**
 * Get the current time in business timezone as hours and minutes
 * Used for cutoff logic comparisons
 * 
 * @returns {object} { hours: number, minutes: number }
 */
export function getCurrentTimeInBusinessTZ() {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
    timeZone: BUSINESS_TIMEZONE,
  });
  const parts = formatter.formatToParts(new Date());
  const hour = parseInt(parts.find(p => p.type === 'hour').value);
  const minute = parseInt(parts.find(p => p.type === 'minute').value);
  return { hours: hour, minutes: minute };
}

/**
 * Convert business timezone time to UTC ISO string
 * Used when storing timestamps from business logic
 * 
 * @param {string} dateStr - Date string in YYYY-MM-DD format
 * @param {number} hours - Hours in 24-hour format
 * @param {number} minutes - Minutes (default: 0)
 * @returns {string} ISO 8601 UTC timestamp
 */
export function businessTZToUTC(dateStr, hours = 0, minutes = 0) {
  // Parse date as if it's in business timezone
  // Note: This is approximate—JavaScript doesn't have native timezone-aware parsing
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create a date at midnight UTC, then adjust for timezone offset
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  
  // Get the offset between UTC and business timezone at this date
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(utcDate);
  const tzMonth = parseInt(parts.find(p => p.type === 'month').value);
  const tzDay = parseInt(parts.find(p => p.type === 'day').value);
  const tzHour = parseInt(parts.find(p => p.type === 'hour').value);
  
  // Calculate offset
  const offset = (utcDate.getUTCDate() - tzDay) * 24 + (utcDate.getUTCHours() - tzHour);
  
  // Create the final UTC time
  const resultUTC = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));
  resultUTC.setUTCHours(resultUTC.getUTCHours() - offset);
  
  return resultUTC.toISOString();
}

/**
 * Calculate delivery date based on order cutoff rules
 * 
 * NuVira Delivery Cutoff Rules (all times in America/Chicago):
 * - Sun/Mon/Tue before 2 PM → Wednesday delivery
 * - Tue-Fri 2 PM or later, Wed-Fri before 2 PM → Saturday delivery
 * - Fri-Sat 2 PM or later → Sunday delivery
 * 
 * @param {string|Date} orderDateTime - When the order was placed (ISO 8601 or Date)
 * @returns {string} Delivery date in YYYY-MM-DD format
 */
export function calculateDeliveryDate(orderDateTime) {
  let orderDate = orderDateTime instanceof Date 
    ? orderDateTime 
    : new Date(orderDateTime);
  
  if (isNaN(orderDate.getTime())) {
    console.warn('[TIMEZONE] Invalid order date:', orderDateTime);
    return getTodayDateString(); // Fallback
  }

  // Get day of week and time in business timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: BUSINESS_TIMEZONE,
  });
  
  const parts = formatter.formatToParts(orderDate);
  const tzYear = parseInt(parts.find(p => p.type === 'year').value);
  const tzMonth = parseInt(parts.find(p => p.type === 'month').value);
  const tzDay = parseInt(parts.find(p => p.type === 'day').value);
  const tzHour = parseInt(parts.find(p => p.type === 'hour').value);
  const tzMinute = parseInt(parts.find(p => p.type === 'minute').value);
  
  // Reconstruct as a local date for day-of-week calculation
  const businessTZDate = new Date(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);
  const dayOfWeek = businessTZDate.getDay(); // 0=Sun, 6=Sat
  const isAfter2PM = tzHour >= 14; // 2:00 PM in 24-hour format
  
  let deliveryDayOffset = 0;
  
  // Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6
  if (dayOfWeek === 0) { // Sunday
    // Always → Wednesday (3 days later)
    deliveryDayOffset = 3;
  } else if (dayOfWeek === 1) { // Monday
    // Always → Wednesday (2 days later)
    deliveryDayOffset = 2;
  } else if (dayOfWeek === 2) { // Tuesday
    if (isAfter2PM) {
      // After 2 PM → Saturday (4 days later)
      deliveryDayOffset = 4;
    } else {
      // Before 2 PM → Wednesday (1 day later)
      deliveryDayOffset = 1;
    }
  } else if (dayOfWeek === 3) { // Wednesday
    if (isAfter2PM) {
      // After 2 PM → Saturday (3 days later)
      deliveryDayOffset = 3;
    } else {
      // Before 2 PM → Saturday (3 days later)
      deliveryDayOffset = 3;
    }
  } else if (dayOfWeek === 4) { // Thursday
    if (isAfter2PM) {
      // After 2 PM → Sunday (3 days later)
      deliveryDayOffset = 3;
    } else {
      // Before 2 PM → Saturday (2 days later)
      deliveryDayOffset = 2;
    }
  } else if (dayOfWeek === 5) { // Friday
    if (isAfter2PM) {
      // After 2 PM → Sunday (2 days later)
      deliveryDayOffset = 2;
    } else {
      // Before 2 PM → Saturday (1 day later)
      deliveryDayOffset = 1;
    }
  } else if (dayOfWeek === 6) { // Saturday
    if (isAfter2PM) {
      // After 2 PM → Sunday (1 day later)
      deliveryDayOffset = 1;
    } else {
      // Before 2 PM → Sunday (1 day later)
      deliveryDayOffset = 1;
    }
  }
  
  // Calculate delivery date
  const deliveryDate = new Date(businessTZDate);
  deliveryDate.setDate(deliveryDate.getDate() + deliveryDayOffset);
  
  // Format as YYYY-MM-DD
  const year = deliveryDate.getFullYear();
  const month = String(deliveryDate.getMonth() + 1).padStart(2, '0');
  const day = String(deliveryDate.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Check if a cutoff time (in business timezone) has passed
 * Used to prevent orders after cutoff in Customer App
 * 
 * @param {number} cutoffHour - Hour cutoff (24-hour format, e.g., 14 for 2 PM)
 * @param {number} cutoffMinute - Minute cutoff (default: 0)
 * @returns {boolean} true if current time has passed cutoff
 */
export function isCutoffPassed(cutoffHour = 14, cutoffMinute = 0) {
  const current = getCurrentTimeInBusinessTZ();
  const currentMinutes = current.hours * 60 + current.minutes;
  const cutoffMinutes = cutoffHour * 60 + cutoffMinute;
  return currentMinutes >= cutoffMinutes;
}

/**
 * Validate and ensure timestamp is ISO 8601 UTC format
 * 
 * @param {string|Date|number} timestamp - Any timestamp format
 * @returns {string} ISO 8601 UTC string, or null if invalid
 */
export function ensureUTCTimestamp(timestamp) {
  if (!timestamp) return null;
  
  let date;
  if (typeof timestamp === 'number') {
    // Assume Unix seconds (from Stripe)
    date = new Date(timestamp * 1000);
  } else if (typeof timestamp === 'string') {
    date = new Date(timestamp);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    return null;
  }
  
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}