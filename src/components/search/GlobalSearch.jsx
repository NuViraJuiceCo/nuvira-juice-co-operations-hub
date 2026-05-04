import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Search, X, Loader2 } from 'lucide-react';
import { globalSearch } from '@/lib/globalSearch';
import { useAuth } from '@/lib/AuthContext';
import SearchResultItem from './SearchResultItem';

const DEBOUNCE_MS = 350;

export default function GlobalSearch({ mobile = false }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');

  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const debounceRef = useRef(null);

  // Auto-close on route change (handles nav, result clicks, back/forward)
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(''); setResults({}); setActiveCategory('All'); }
  }, [open]);

  // Click outside to close (desktop only)
  useEffect(() => {
    if (!open || mobile) return;
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, mobile]);

  const runSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 2) { setResults({}); setLoading(false); return; }
    setLoading(true);
    const res = await globalSearch(q, { isAdmin, includeArchived });
    setResults(res);
    setLoading(false);
  }, [isAdmin, includeArchived]);

  const handleChange = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(val), DEBOUNCE_MS);
  };

  const clearQuery = () => { setQuery(''); setResults({}); inputRef.current?.focus(); };
  const close = () => setOpen(false);

  const allCategories = ['All', ...Object.keys(results)];
  const displayResults = activeCategory === 'All'
    ? results
    : activeCategory in results
      ? { [activeCategory]: results[activeCategory] }
      : {};

  const totalCount = Object.values(results).reduce((s, arr) => s + arr.length, 0);

  // ── Mobile: icon button that opens full-screen overlay ──────────────────
  if (mobile) {
    return (
      <>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center justify-center h-9 w-9 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Search"
        >
          <Search className="h-5 w-5" />
        </button>

        {open && (
          <div
            className="fixed inset-0 z-[60] bg-background flex flex-col"
            style={{ paddingTop: 'env(safe-area-inset-top)' }}
          >
            {/* Search bar row */}
            <div className="flex items-center gap-3 px-4 border-b border-border" style={{ minHeight: '56px' }}>
              {loading
                ? <Loader2 className="h-5 w-5 text-muted-foreground animate-spin shrink-0" />
                : <Search className="h-5 w-5 text-muted-foreground shrink-0" />
              }
              <input
                ref={inputRef}
                value={query}
                onChange={handleChange}
                placeholder="Search orders, customers, batches..."
                className="flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground outline-none py-4"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck="false"
              />
              {query ? (
                <button
                  onClick={clearQuery}
                  className="flex items-center justify-center h-8 w-8 rounded-full bg-muted text-muted-foreground shrink-0"
                  aria-label="Clear"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <button
                onClick={close}
                className="shrink-0 text-base font-semibold text-primary px-2 py-3 min-w-[60px] text-right"
                aria-label="Cancel search"
              >
                Cancel
              </button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-hidden flex flex-col">
              <SearchBody
                query={query}
                results={displayResults}
                allResults={results}
                allCategories={allCategories}
                activeCategory={activeCategory}
                setActiveCategory={setActiveCategory}
                loading={loading}
                totalCount={totalCount}
                isAdmin={isAdmin}
                includeArchived={includeArchived}
                setIncludeArchived={setIncludeArchived}
                onClose={close}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Desktop: inline bar + dropdown ──────────────────────────────────────
  return (
    <div ref={containerRef} className="relative hidden lg:block w-72 xl:w-96">
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-muted/50 hover:bg-muted text-sm text-muted-foreground transition-colors"
      >
        <Search className="h-4 w-4 shrink-0" />
        <span className="flex-1 text-left">Search everything...</span>
        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono bg-background border border-border text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="absolute top-10 left-0 right-0 bg-card border border-border rounded-xl shadow-2xl z-50 flex flex-col max-h-[80vh] overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={handleChange}
              placeholder="Search orders, customers, batches, pages, logs..."
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            />
            {loading && <Loader2 className="h-4 w-4 text-muted-foreground animate-spin shrink-0" />}
            {query && !loading && (
              <button onClick={clearQuery} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <SearchBody
            query={query}
            results={displayResults}
            allResults={results}
            allCategories={allCategories}
            activeCategory={activeCategory}
            setActiveCategory={setActiveCategory}
            loading={loading}
            totalCount={totalCount}
            isAdmin={isAdmin}
            includeArchived={includeArchived}
            setIncludeArchived={setIncludeArchived}
            onClose={close}
          />
        </div>
      )}
    </div>
  );
}

function SearchBody({ query, results, allResults, allCategories, activeCategory, setActiveCategory, loading, totalCount, isAdmin, includeArchived, setIncludeArchived, onClose }) {
  const hasQuery = query.trim().length >= 2;
  const hasResults = totalCount > 0;

  return (
    <div className="flex flex-col overflow-hidden flex-1">
      {/* Category filter tabs */}
      {hasQuery && Object.keys(allResults).length > 0 && (
        <div className="flex gap-1 px-3 py-2 overflow-x-auto border-b border-border scrollbar-none">
          {allCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {cat}
              {cat !== 'All' && allResults[cat] && (
                <span className="ml-1 opacity-70">({allResults[cat].length})</span>
              )}
              {cat === 'All' && (
                <span className="ml-1 opacity-70">({totalCount})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="overflow-y-auto flex-1 p-2">
        {!hasQuery && (
          <div className="px-3 py-8 text-center">
            <Search className="h-8 w-8 text-muted mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Orders, batches, customers, pages & more</p>
          </div>
        )}

        {hasQuery && loading && (
          <div className="px-3 py-8 text-center">
            <Loader2 className="h-6 w-6 text-primary animate-spin mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Searching...</p>
          </div>
        )}

        {hasQuery && !loading && !hasResults && (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">No matching records found.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Try a different query or check spelling</p>
          </div>
        )}

        {!loading && Object.entries(results).map(([category, items]) => (
          <div key={category} className="mb-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-3 py-1">
              {category}
            </p>
            <div className="space-y-0.5">
              {items.map(result => (
                <SearchResultItem key={result.id} result={result} query={query} onClose={onClose} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      {isAdmin && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/30">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={e => setIncludeArchived(e.target.checked)}
              className="h-3 w-3 rounded accent-primary"
            />
            Include archived / system records
          </label>
          <span className="text-[10px] text-muted-foreground/50">Read-only</span>
        </div>
      )}
    </div>
  );
}