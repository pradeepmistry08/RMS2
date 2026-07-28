/* ============================================================
   RMS v5 — api.js
   Only file that talks to the Google Apps Script backend.
   ============================================================
   SETUP: paste your deployed Apps Script Web App URL below.
   ============================================================ */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwOYg7-1wEk3NV9vGPnd_cwuumvL7qaQdxw2ZbIXN4A0rbwUerAs86iHLiUdJWXvbjk/exec';

function apiIsConfigured(){
  return typeof APPS_SCRIPT_URL === 'string' && APPS_SCRIPT_URL.indexOf('https://script.google.com') === 0;
}

function cleanParams(params){
  const out = {};
  Object.keys(params || {}).forEach(k=>{
    const val = params[k];
    if(val !== undefined && val !== null && val !== '') out[k] = val;
  });
  return out;
}

async function apiCall(action, params, method){
  const p = cleanParams(params);
  const doFetch = async () => {
    if(method === 'POST'){
      const res = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, data: p })
      });
      if(!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    }
    const qs = new URLSearchParams({ action, ...p }).toString();
    const res = await fetch(`${APPS_SCRIPT_URL}?${qs}`, { method: 'GET' });
    if(!res.ok) throw new Error('HTTP '+res.status);
    return res.json();
  };
  try{
    return await doFetch();
  }catch(err){
    try{ return await doFetch(); }
    catch(err2){ return { success:false, message: 'Network error: '+err2.message }; }
  }
}

window.API = {
  isConfigured: apiIsConfigured,

  login:            (userId, password)          => apiCall('login', { userId, password }, 'POST'),
  logout:           ()                            => Promise.resolve({ success:true }),
  changePassword:   (userId, isAdmin, newPassword)=> apiCall('changePassword', { userId, isAdmin, newPassword }, 'POST'),

  getDashboard:     (isAdmin, userId)             => apiCall('dashboard', { isAdmin, userId }, 'GET'),
  getSettings:      ()                            => apiCall('getSettings', {}, 'GET'),
  updateSettings:   (key, value)                  => apiCall('updateSettings', { key, value }, 'POST'),

  // Riders
  getRiders:        ()                            => apiCall('getRiders', {}, 'GET'),
  getRider:         (riderId)                     => apiCall('getRider', { riderId }, 'GET'),
  addRider:         (data)                        => apiCall('addRider', data, 'POST'),
  updateRider:      (data)                        => apiCall('updateRider', data, 'POST'),
  deleteRider:      (riderId)                     => apiCall('deleteRider', { riderId }, 'POST'),
  getActiveRidersByFrequency: (session)            => apiCall('getActiveRidersByFrequency', { session }, 'GET'),

  // Journeys
  createJourney:    (journeyDate, session, riders, notes) =>
                       apiCall('createJourney', { journeyDate, session, riders: JSON.stringify(riders), notes }, 'POST'),
  getJourneys:      (opts)                        => apiCall('getJourneys', opts || {}, 'GET'),
  getJourney:       (journeyId)                   => apiCall('getJourney', { journeyId }, 'GET'),
  startJourney:     (journeyId)                   => apiCall('startJourney', { journeyId }, 'POST'),
  completeJourney:  (journeyId)                   => apiCall('completeJourney', { journeyId }, 'POST'),
  updateJourneyDetail: (data)                     => apiCall('updateJourneyDetail', data, 'POST'),
  deleteJourney:    (journeyId)                   => apiCall('deleteJourney', { journeyId }, 'POST'),

  // Wallet
  getWallet:        (riderId)                     => apiCall('getWallet', { riderId }, 'GET'),
  getAllWallets:    ()                             => apiCall('getAllWallets', {}, 'GET'),
  addWalletFunds:   (riderId, amount, purpose, notes) => apiCall('addWalletFunds', { riderId, amount, purpose, notes }, 'POST'),
  requestWalletTopup: (riderId, amount, notes)     => apiCall('requestWalletTopup', { riderId, amount, notes }, 'POST'),
  getPendingWalletRequests: ()                     => apiCall('getPendingWalletRequests', {}, 'GET'),
  approveWalletTopupRequest: (transactionId, isAdmin) => apiCall('approveWalletTopupRequest', { transactionId, isAdmin }, 'POST'),
  rejectWalletTopupRequest: (transactionId, isAdmin)  => apiCall('rejectWalletTopupRequest', { transactionId, isAdmin }, 'POST'),
  deductWallet:     (riderId, amount, purpose, journeyId) => apiCall('deductWallet', { riderId, amount, purpose, journeyId }, 'POST'),
  getWalletTransactions: (riderId)                 => apiCall('getWalletTransactions', { riderId }, 'GET'),

  // SMS
  sendJourneySMS:   (journeyId, messageType)       => apiCall('sendJourneySMS', { journeyId, messageType }, 'POST'),
  getSMSLog:        (journeyId)                    => apiCall('getSMSLog', { journeyId }, 'GET'),

  // QR
  getQRPaymentData: (journeyId, riderId)           => apiCall('getQRPaymentData', { journeyId, riderId }, 'GET'),
  getUpiPaymentLink: (detailId)                    => apiCall('getUpiPaymentLink', { detailId }, 'GET'),
  getUpiTopupLink: (amount, riderId)               => apiCall('getUpiTopupLink', { amount, riderId }, 'GET'),
  payOutstandingViaWallet: (detailId, riderId)     => apiCall('payOutstandingViaWallet', { detailId, riderId }, 'POST'),
  reportUpiPayment: (detailId, riderId)            => apiCall('reportUpiPayment', { detailId, riderId }, 'POST'),
  approveUpiPayment: (detailId, isAdmin)           => apiCall('approveUpiPayment', { detailId, isAdmin }, 'POST'),
  rejectUpiPayment: (detailId, isAdmin)            => apiCall('rejectUpiPayment', { detailId, isAdmin }, 'POST'),

  // Reports — rider-specific rows for riders, org-wide for admins.
  // dateFrom/dateTo are plain 'YYYY-MM-DD' strings; statusFilter is 'outstanding' or omitted.
  getMyReport:      (isAdmin, userId, dateFrom, dateTo, statusFilter, filterRiderId) =>
                       apiCall('getMyReport', { isAdmin, userId, dateFrom, dateTo, statusFilter, filterRiderId }, 'GET'),
  getWalletReport:  (isAdmin, userId, dateFrom, dateTo, filterRiderId) =>
                       apiCall('getWalletReport', { isAdmin, userId, dateFrom, dateTo, filterRiderId }, 'GET')
};
