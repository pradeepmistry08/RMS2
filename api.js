/*  ============================================================
    RMS v4 — API Layer (api.js)
    ------------------------------------------------------------
    Pure communication layer between the frontend and the Google
    Apps Script backend (apps_script.gs). Contains NO DOM
    manipulation, NO rendering, NO alerts, NO business logic —
    only request/response handling.

    - Reads  (GET)  -> query-string params appended to API_URL
    - Writes (POST) -> JSON body { action, data }, sent with
      "text/plain;charset=utf-8" so the browser treats it as a
      simple request and skips a CORS pre-flight (OPTIONS),
      which Apps Script Web Apps do not handle. Apps Script
      still parses e.postData.contents as JSON correctly.

    Every method resolves to either:
      { success: true, ... }
      { success: false, message: "..." }
    Network errors, timeouts, invalid JSON, and HTTP failures
    are all normalized into that same shape — nothing here ever
    throws a raw exception at the caller.
    ============================================================ */

(function (global) {
  'use strict';

  /* ── 1. CONFIGURE THIS ──────────────────────────────────────
     Paste your deployed Apps Script Web App URL here:
     https://script.google.com/macros/s/AKfycb.../exec
  ------------------------------------------------------------- */
  const API_URL = "https://script.google.com/macros/s/AKfycbw0XGZrzPeOrHFZAblh2zU7M9fi7R88CyQ6fjtualmuz0wIZ2kD7d7yjpR5hRymkQLG/exec";

  const REQUEST_TIMEOUT_MS = 15000;
  const MAX_RETRIES = 2; // retries in addition to the first attempt
  const RETRY_DELAY_MS = 600;

  const SESSION_KEY = 'rmsUser';

  /* ── 2. LOW-LEVEL TRANSPORT ─────────────────────────────────── */

  function isConfigured() {
    return typeof API_URL === 'string' &&
      API_URL.indexOf('YOUR_DEPLOYMENT_ID') === -1 &&
      API_URL.indexOf('script.google.com') !== -1;
  }

  function buildQueryString(params) {
    const qs = new URLSearchParams();
    Object.keys(params || {}).forEach(function (key) {
      const val = params[key];
      if (val === undefined || val === null) return;
      qs.append(key, val);
    });
    return qs.toString();
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function normalizeSuccessShape(data) {
    if (typeof data !== 'object' || data === null) {
      return { success: false, message: 'Unexpected response format from server.' };
    }
    if (typeof data.success !== 'boolean') {
      data = Object.assign({}, data, {
        success: false,
        message: data.message || 'Malformed response from server.'
      });
    }
    return data;
  }

  /* Performs exactly one network attempt. Never throws — always
     resolves to either a parsed backend response object or an
     internal marker describing why the attempt failed, so the
     retry wrapper can decide whether to retry. */
  async function attemptOnce(action, params, method) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);

    try {
      let response;

      if (method === 'GET') {
        const qs = buildQueryString(Object.assign({ action: action }, params));
        response = await fetch(API_URL + '?' + qs, {
          method: 'GET',
          signal: controller.signal
        });
      } else {
        response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: action, data: params }),
          signal: controller.signal
        });
      }

      if (!response.ok) {
        const retryable = response.status >= 500 && response.status < 600;
        return {
          ok: false,
          retryable: retryable,
          result: { success: false, message: 'Server error (HTTP ' + response.status + '). Please try again.' }
        };
      }

      let rawText;
      try {
        rawText = await response.text();
      } catch (readErr) {
        return { ok: false, retryable: true, result: { success: false, message: 'Failed to read server response.' } };
      }

      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseErr) {
        return { ok: false, retryable: false, result: { success: false, message: 'Invalid response from server.' } };
      }

      return { ok: true, retryable: false, result: normalizeSuccessShape(data) };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, retryable: true, result: { success: false, message: 'Request timed out. Please check your connection and try again.' } };
      }
      return {
        ok: false,
        retryable: true,
        result: { success: false, message: 'Network error: ' + (err && err.message ? err.message : 'unable to reach server.') }
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Core request function every public method funnels through.
     Retries network failures and HTTP 5xx responses up to
     MAX_RETRIES additional times with a short delay between
     attempts. Never throws. */
  async function request(action, params, method) {
    params = params || {};
    method = method || 'GET';

    if (!isConfigured()) {
      return {
        success: false,
        message: 'API_URL is not configured. Open api.js and paste your Apps Script Web App URL into the API_URL constant.'
      };
    }

    let lastResult = { success: false, message: 'Request failed.' };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const outcome = await attemptOnce(action, params, method);
      if (outcome.ok) return outcome.result;
      lastResult = outcome.result;
      if (!outcome.retryable || attempt === MAX_RETRIES) break;
      await sleep(RETRY_DELAY_MS * (attempt + 1));
    }

    return lastResult;
  }

  /* ── 3. SESSION HELPERS (storage only, no business logic) ──── */

  function saveSession(user) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(user));
      return { success: true };
    } catch (err) {
      return { success: false, message: 'Could not save session: ' + err.message };
    }
  }

  function getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return { success: true, user: null };
      return { success: true, user: JSON.parse(raw) };
    } catch (err) {
      return { success: false, message: 'Could not read session: ' + err.message };
    }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      return { success: true };
    } catch (err) {
      return { success: false, message: 'Could not clear session: ' + err.message };
    }
  }

  /* ── 4. PUBLIC API METHODS ──────────────────────────────────── */

  const API = {

    isConfigured,

    async ping() {
      return request('ping', {}, 'GET');
    },

    /* -------------------- AUTH -------------------- */
    async login(userId, password) {
      return request('login', { userId, password }, 'POST');
    },

    async logout() {
      // Stateless backend: nothing to invalidate server-side.
      return { success: true };
    },

    async changePassword(userId, isAdmin, newPassword) {
      return request('changePassword', { userId, isAdmin: !!isAdmin, newPassword }, 'POST');
    },

    /* -------------------- DASHBOARD -------------------- */
    async getDashboard(isAdmin, userId) {
      return request('dashboard', { isAdmin: !!isAdmin, userId }, 'GET');
    },

    /* -------------------- SETTINGS -------------------- */
    async getSettings() {
      return request('getSettings', {}, 'GET');
    },

    async updateSettings(key, value) {
      return request('updateSettings', { key, value }, 'POST');
    },

    /* -------------------- RIDERS -------------------- */
    async getRiders() {
      return request('getRiders', {}, 'GET');
    },

    async getRider(riderId) {
      return request('getRider', { riderId }, 'GET');
    },

    async addRider(riderData) {
      return request('addRider', riderData, 'POST');
    },

    async updateRider(riderData) {
      return request('updateRider', riderData, 'POST');
    },

    async deleteRider(riderId) {
      return request('deleteRider', { riderId }, 'POST');
    },

    /* -------------------- TRIPS -------------------- */
    async getTrips(filters) {
      return request('getTrips', filters || {}, 'GET');
    },

    async getTrip(tripId) {
      return request('getTrip', { tripId }, 'GET');
    },

    async addTrip(tripData) {
      return request('addTrip', tripData, 'POST');
    },

    async updateTrip(tripData) {
      return request('updateTrip', tripData, 'POST');
    },

    async deleteTrip(tripId) {
      return request('deleteTrip', { tripId }, 'POST');
    },

    /* -------------------- PAYMENTS -------------------- */
    async getPayments(filters) {
      return request('getPayments', filters || {}, 'GET');
    },

    async addPayment(paymentData) {
      return request('addPayment', paymentData, 'POST');
    },

    async updatePayment(paymentData) {
      return request('updatePayment', paymentData, 'POST');
    },

    async deletePayment(paymentId) {
      return request('deletePayment', { paymentId }, 'POST');
    },

    /* -------------------- REPORTS --------------------
       No dedicated backend action exists for reports; the
       backend's getTrips already supports month / date-range /
       status filtering server-side, so report generation reuses
       it directly rather than duplicating logic. This keeps the
       spreadsheet as the single source of truth and avoids
       fetching more data than the report needs. */
    async generateReport(options) {
      options = options || {};
      const filters = { isAdmin: !!options.isAdmin, userId: options.userId };

      if (options.type === 'month' && options.month) {
        filters.month = options.month;
      } else if (options.type === 'daterange' && options.dateFrom && options.dateTo) {
        filters.dateFrom = options.dateFrom;
        filters.dateTo = options.dateTo;
      } else if (options.type === 'outstanding') {
        filters.status = 'Balance';
      }
      // type === 'all' (or unrecognized) → no extra filters.

      const result = await request('getTrips', filters, 'GET');
      if (!result.success) return result;
      return { success: true, trips: result.trips || [] };
    },

    /* -------------------- SESSION (local persistence only) -------------------- */
    saveSession,
    getSession,
    clearSession
  };

  global.API = API;
})(window);
