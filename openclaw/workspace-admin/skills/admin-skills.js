/**
 * admin-skills.js — CeloPay admin skill
 * All admin queries hit the shared backend
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_SECRET || 'dev-admin';

async function adminGet(path) {
  const res = await fetch(`${BACKEND}${path}`, {
    headers: { 'X-Admin-Key': ADMIN_KEY }
  });
  if (!res.ok) throw new Error(`Admin request failed: ${res.status}`);
  return res.json();
}

async function adminPost(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Key': ADMIN_KEY },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Admin request failed');
  return data;
}

// ─── Transactions ─────────────────────────────────────────────────────────────

export async function getStats() {
  return adminGet('/admin/stats');
}

export async function getTransactions(period = 'today', status = null) {
  const params = new URLSearchParams({ period });
  if (status) params.append('status', status);
  return adminGet(`/admin/transactions?${params}`);
}

export async function getLargeTransactions(threshold = 500) {
  return adminGet(`/admin/transactions?minAmount=${threshold}`);
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function getUsers(filter = 'all') {
  return adminGet(`/admin/users?filter=${filter}`);
}

export async function getUserInfo(username) {
  return adminGet(`/admin/users/${encodeURIComponent(username)}`);
}

export async function flagUser(username) {
  return adminPost(`/admin/users/${encodeURIComponent(username)}/flag`, {});
}

// ─── Circles ─────────────────────────────────────────────────────────────────

export async function getAllCircles() {
  return adminGet('/admin/circles');
}

export async function getCircleDetail(circleId) {
  return adminGet(`/admin/circles/${circleId}`);
}
