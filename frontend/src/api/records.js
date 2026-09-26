import apiClient from './client';

export function fetchMyRecords({ mode, limit, offset } = {}) {
  const params = {};
  if (mode) params.mode = mode;
  if (limit) params.limit = limit;
  if (offset) params.offset = offset;
  return apiClient.get('/records/me', { params }).then((res) => res.data);
}

export function fetchLeaderboard({ mode, limit } = {}) {
  const params = {};
  if (mode) params.mode = mode;
  if (limit) params.limit = limit;
  return apiClient.get('/records/leaderboard', { params }).then((res) => res.data);
}

export function fetchMyDrawings({ limit, offset } = {}) {
  const params = {};
  if (limit) params.limit = limit;
  if (offset) params.offset = offset;
  return apiClient.get('/records/drawings', { params }).then((res) => res.data);
}

export function fetchDrawingDetail(id) {
  return apiClient.get(`/records/drawings/${id}`).then((res) => res.data);
}
