/**
 * esusu.js — CeloPay skill
 * Esusu circle operations
 */

const BACKEND = process.env.CELOPAY_BACKEND || 'http://localhost:3000';

async function post(path, body) {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

async function get(path) {
  const res = await fetch(`${BACKEND}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export async function createCircle({ adminTelegramId, name, contributionCusd, intervalDays, maxMembers, telegramGroupId }) {
  return post('/api/esusu/create', { adminTelegramId, name, contributionCusd, intervalDays, maxMembers, telegramGroupId });
}

export async function joinCircle({ telegramId, circleId }) {
  return post('/api/esusu/join', { telegramId, circleId });
}

export async function contribute({ telegramId, circleId }) {
  return post('/api/esusu/contribute', { telegramId, circleId });
}

export async function getStatus(circleId) {
  return get(`/api/esusu/${circleId}/status`);
}

export async function getUserCircles(telegramId) {
  return get(`/api/esusu/user/${telegramId}`);
}
