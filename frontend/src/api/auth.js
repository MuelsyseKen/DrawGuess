import apiClient from './client';

export function register(username, password) {
  return apiClient.post('/auth/register', { username, password }).then((res) => res.data);
}

export function login(username, password) {
  return apiClient.post('/auth/login', { username, password }).then((res) => res.data);
}

export function logout() {
  return apiClient.post('/auth/logout').then((res) => res.data);
}

export function fetchMe() {
  return apiClient.get('/auth/me').then((res) => res.data);
}
