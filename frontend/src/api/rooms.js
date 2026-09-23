import apiClient from './client';

export function fetchPublicRooms(mode) {
  return apiClient.get('/rooms/public', { params: mode ? { mode } : {} }).then((res) => res.data);
}

export function fetchWordbanks() {
  return apiClient.get('/wordbanks').then((res) => res.data);
}
