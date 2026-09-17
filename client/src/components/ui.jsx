import { useEffect, useState } from 'react';

export function StatusBadge({ status }) {
  return <span className={`badge ${status}`}>{status}</span>;
}

/** Clickable table header that toggles sort key / order. */
export function SortTh({ label, field, sort, order, onSort, className }) {
  const active = sort === field;
  return (
    <th className={className}>
      <button className={`sort ${active ? 'active' : ''}`} onClick={() => onSort(field, active && order === 'asc' ? 'desc' : 'asc')}>
        {label} <span aria-hidden>{active ? (order === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

export function Pagination({ page, totalPages, total, limit, onPage, onLimit }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="pagination">
      <span className="muted">{from}–{to} of {total}</span>
      <div className="row">
        <select value={limit} onChange={(e) => onLimit(Number(e.target.value))} aria-label="Rows per page">
          {[5, 10, 20, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
        <span>Page {page} / {totalPages}</span>
        <button className="btn ghost sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next ›</button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  const details = error.details ? Object.values(error.details) : [];
  return (
    <div className="alert">
      {error.message}
      {details.length > 0 && <ul>{details.map((d) => <li key={d}>{d}</li>)}</ul>}
    </div>
  );
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
