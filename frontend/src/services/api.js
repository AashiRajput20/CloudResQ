import axios from 'axios';

// Single axios instance. React talks ONLY to the Node backend, never to Docker.
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
  timeout: 5000,
});

export const getBackendHealth = async () => (await api.get('/health')).data;

export const getServices = async () => (await api.get('/services')).data;
export const getService = async (id) => (await api.get(`/services/${id}`)).data;
export const getServiceInstances = async (id) => (await api.get(`/services/${id}/instances`)).data;
export const createService = async (payload) => (await api.post('/services', payload)).data;
export const deleteService = async (id) => (await api.delete(`/services/${id}`)).data;

// Pulls the readable message out of an axios error.
export const errorMessage = (err) => err.response?.data?.error || err.message;

export default api;