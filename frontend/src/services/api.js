import axios from 'axios';

// Single axios instance. React talks ONLY to the Node backend, never to Docker.
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
  timeout: 5000,
});

export const getBackendHealth = async () => {
  const { data } = await api.get('/health');
  return data;
};

export default api;