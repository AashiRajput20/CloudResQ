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
export const getDockerContainers = async () => (await api.get('/docker/containers')).data;
// Sync inspects every container (stats take a moment), so it gets a longer timeout.
export const syncFromDocker = async () => (await api.post('/docker/sync', null, { timeout: 15000 })).data;
export const getHealthChecks = async (params = {}) => (await api.get('/health-checks', { params })).data;
export const getMonitorStatus = async () => (await api.get('/monitor/status')).data;

// Pulls the readable message out of an axios error.
export const getFailures = async (params = {}) => (await api.get('/failures', { params })).data;
export const getAnalysis = async (params = {}) => (await api.get('/analysis', { params })).data;
export const getDecisions = async (params = {}) => (await api.get('/decisions', { params })).data;
export const getLiveDecisions = async (params = {}) => (await api.get('/decisions/live', { params })).data;
// Actions can take a while (restart + verification), so they get longer timeouts.
export const restartInstance = async (id) => (await api.post(`/instances/${id}/restart`, null, { timeout: 60000 })).data;
export const replaceInstance = async (id) => (await api.post(`/instances/${id}/replace`, null, { timeout: 90000 })).data;
export const simulateInstance = async (id, type) => (await api.post(`/instances/${id}/simulate`, { type })).data;
export const restartService = async (id) => (await api.post(`/services/${id}/restart`, null, { timeout: 180000 })).data;
export const getRecoveryEvents = async (params = {}) => (await api.get('/recovery-events', { params })).data;
export const getLoadBalancer = async () => (await api.get('/loadbalancer')).data;
export const syncLoadBalancer = async () => (await api.post('/loadbalancer/sync', null, { timeout: 20000 })).data;
export const getEvents = async () => (await api.get('/events')).data;
export const sendTestEvent = async () => (await api.post('/events/test')).data;
export const errorMessage = (err) => err.response?.data?.error || err.message;

export default api;