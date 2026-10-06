// Colored pill for any CloudResQ status (HEALTHY, FAILED, RECOVERING, ...)
export default function StatusBadge({ status }) {
  return <span className={`badge badge-${String(status).toLowerCase()}`}>{status}</span>;
}