import { useSearchParams } from 'react-router-dom';

/**
 * List state (search, filters, page, limit, sort, order) kept in the URL so
 * it survives refresh and back/forward navigation.
 */
export function useListQuery(defaults) {
  const [params, setParams] = useSearchParams();
  const state = {};
  for (const [k, v] of Object.entries(defaults)) {
    const raw = params.get(k);
    state[k] = raw === null ? v : typeof v === 'number' ? Number(raw) || v : raw;
  }

  const update = (patch, { resetPage = true } = {}) => {
    const next = { ...state, ...(resetPage ? { page: 1 } : {}), ...patch };
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v !== '' && v !== defaults[k]) out.set(k, v);
    }
    setParams(out, { replace: true });
  };

  return [state, update];
}
