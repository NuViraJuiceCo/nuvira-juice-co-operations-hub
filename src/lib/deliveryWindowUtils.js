import moment from 'moment-timezone';

const CHICAGO_TZ = 'America/Chicago';

// Official delivery windows
const DELIVERY_WINDOWS = {
  Wednesday: {
    delivery_date_day: 3, // Wednesday
    delivery_window_start: 17, // 5 PM
    delivery_window_end: 20, // 8 PM
    delivery_window_label: '5:00 PM - 8:00 PM',
    delivery_window_timezone: CHICAGO_TZ,
  },
  Saturday: {
    delivery_date_day: 6, // Saturday
    delivery_window_start: 17, // 5 PM
    delivery_window_end: 20, // 8 PM
    delivery_window_label: '5:00 PM - 8:00 PM',
    delivery_window_timezone: CHICAGO_TZ,
  },
  Sunday: {
    delivery_date_day: 0, // Sunday (exception/manual)
    delivery_window_start: null, // No official window yet
    delivery_window_end: null,
    delivery_window_label: 'Manual/Exception',
    delivery_window_timezone: CHICAGO_TZ,
  },
};

/**
 * Given a production day name, return the delivery day and window info
 * @param {string} production_day - 'Tuesday', 'Friday', 'Saturday'
 * @returns {object} delivery day info with date calculation and window
 */
export function getDeliveryWindowForProductionDay(production_day) {
  switch (production_day) {
    case 'Tuesday':
      return {
        delivery_day: 'Wednesday',
        ...DELIVERY_WINDOWS.Wednesday,
      };
    case 'Friday':
      return {
        delivery_day: 'Saturday',
        ...DELIVERY_WINDOWS.Saturday,
      };
    case 'Saturday':
      return {
        delivery_day: 'Sunday',
        ...DELIVERY_WINDOWS.Sunday,
      };
    default:
      return null;
  }
}

/**
 * Calculate actual delivery date string given production date
 * @param {string} production_date - ISO date string (e.g., '2026-05-01')
 * @param {string} production_day - 'Tuesday', 'Friday', 'Saturday'
 * @returns {string} ISO delivery date string
 */
export function calculateDeliveryDate(production_date, production_day) {
  if (!production_date) return null;

  const prodDate = moment(production_date);
  const windowInfo = getDeliveryWindowForProductionDay(production_day);

  if (!windowInfo) return null;

  // Calculate days to add to production date to get delivery date
  let daysToAdd = 0;
  switch (production_day) {
    case 'Tuesday':
      daysToAdd = 1; // Tuesday + 1 = Wednesday
      break;
    case 'Friday':
      daysToAdd = 1; // Friday + 1 = Saturday
      break;
    case 'Saturday':
      daysToAdd = 1; // Saturday + 1 = Sunday
      break;
  }

  return prodDate.add(daysToAdd, 'days').format('YYYY-MM-DD');
}

/**
 * Enrich order/fulfillment row with delivery window info
 * @param {object} row - production planning row
 * @returns {object} enriched row with delivery window fields
 */
export function enrichWithDeliveryWindow(row) {
  if (!row.assigned_production_date) {
    return row;
  }

  const windowInfo = getDeliveryWindowForProductionDay(row.assigned_production_date);

  if (!windowInfo) {
    return row;
  }

  return {
    ...row,
    assigned_delivery_date: calculateDeliveryDate(
      row.production_date || moment().format('YYYY-MM-DD'),
      row.assigned_production_date
    ),
    assigned_delivery_window_start: windowInfo.delivery_window_start,
    assigned_delivery_window_end: windowInfo.delivery_window_end,
    delivery_window_label: windowInfo.delivery_window_label,
    delivery_window_timezone: windowInfo.delivery_window_timezone,
    estimated_delivery_description: `Estimated delivery: ${windowInfo.delivery_day} between ${windowInfo.delivery_window_label}`,
  };
}

/**
 * Format delivery window for display
 * @param {number} start - start hour (0-23)
 * @param {number} end - end hour (0-23)
 * @returns {string} formatted window like "5:00 PM - 8:00 PM"
 */
export function formatDeliveryWindow(start, end) {
  if (start === null || end === null) return 'Manual/Exception';

  const startMoment = moment().hours(start).minutes(0);
  const endMoment = moment().hours(end).minutes(0);

  return `${startMoment.format('h:mm A')} - ${endMoment.format('h:mm A')}`;
}

/**
 * Check if a date falls within a delivery window
 * @param {string} dateStr - ISO date string
 * @param {string} deliveryDay - 'Wednesday', 'Saturday', 'Sunday'
 * @returns {boolean}
 */
export function isWithinDeliveryWindow(dateStr, deliveryDay) {
  const date = moment(dateStr);
  const windowInfo = DELIVERY_WINDOWS[deliveryDay];

  if (!windowInfo) return false;

  return date.day() === windowInfo.delivery_date_day;
}