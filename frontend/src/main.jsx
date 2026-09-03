import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './charts.css';

// Default to 127.0.0.1 instead of localhost: on Windows, "localhost" can
// resolve to IPv6 ::1 while uvicorn listens on IPv4 only, which makes the
// backend look unreachable even when it is running.
const API = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const MAX_UPLOAD_MB = 50;      // keep in sync with config.MAX_UPLOAD_MB on the API
const GALLERY_PAGE_SIZE = 12;  // page size for the saved-records gallery
const TOUR_KEY = 'lumen-tour-done';
const tourSteps = [
  { id: 'upload', title: 'Upload', text: 'Drop a PNG, JPEG, or WebP here — or click the box to browse your device.' },
  { id: 'analyze', title: 'Analyze', text: 'Runs the full quality analysis. Use "Save to gallery" beside it when you want to keep the record.' },
  { id: 'gallery', title: 'Gallery — select', text: 'Every saved record lives here. Tick the checkbox on a card to select it for comparison.' },
  { id: 'compare', title: 'Compare', text: 'Select two or more records, then compare their metrics side by side.' },
];
const metricLabels = {
  mean_brightness: 'Mean brightness', luminance_brightness: 'Luminance',
  contrast_score: 'Contrast', sharpness_score: 'Sharpness',
  colorfulness_score: 'Colorfulness', entropy_score: 'Entropy',
  underexposed_pct: 'Underexposed %', overexposed_pct: 'Overexposed %',
  saturation_mean: 'Saturation %', aspect_ratio: 'Aspect ratio (w/h)',
  warm_cool_bias: 'Warm/cool bias'
};

// Diff direction per metric: 'higher' (default) = bigger wins, 'lower' =
// smaller wins (exposure leakage), 'neutral' = no inherently better value.
const metricDirection = {
  underexposed_pct: 'lower',
  overexposed_pct: 'lower',
  aspect_ratio: 'neutral',
  warm_cool_bias: 'neutral'
};

function nearlyEqual(a, b) {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

// Hero wordmark rotation. A timer keeps each face on screen for its exact display
// duration (EN 3s -> JA 2.5s -> HI 1s) and the CSS per-letter transition-delay
// staggers the letters, so the word is spelled out one character at a time with a
// smooth 0.4s crossfade between words.
const WORDMARK_WORDS = [
  { cls: 'brand-en', text: 'LUMEN', duration: 3000 },
  { cls: 'brand-ja', text: 'ルーメン', duration: 2500, lang: 'ja' },
  { cls: 'brand-hi', text: 'लुमेन', duration: 1000, lang: 'hi' },
];

// Split into user-perceived characters (grapheme clusters) so combining
// marks in Devanagari stay attached to their base letter.
function splitLetters(text) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map(s => s.segment);
    }
  } catch { /* fall through to a code-point split */ }
  return Array.from(text);
}

function HeroWordmark() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => setIndex(i => (i + 1) % WORDMARK_WORDS.length), WORDMARK_WORDS[index].duration);
    return () => window.clearTimeout(timer);
  }, [index]);

  return (
    <h1 className="brand-heading" aria-label="LUMEN">
      {WORDMARK_WORDS.map((word, wi) => (
        <span
          key={word.cls}
          className={`brand-text ${word.cls} ${wi === index ? 'is-active' : ''}`}
          lang={word.lang}
          aria-hidden={word.lang ? 'true' : undefined}
        >
          {splitLetters(word.text).map((ch, i) => (
            <span key={i} className="brand-letter" style={{ '--i': i }}>{ch}</span>
          ))}
        </span>
      ))}
    </h1>
  );
}

/* Ambient falling petals/leaves — a decorative layer behind all content.
   Five petals drop from above at evenly spread horizontal positions covering
   the full viewport width. Each gets its fall speed/duration, sway, rotation
   speed/direction, size, tone and opacity from CSS custom props set once via
   useMemo (randomized per page load). Motion is pure CSS: the outer span runs
   a translateY fall, the inner leaf runs a continuous rotate — transform-only,
   so the compositor keeps it cheap. */
const rand = (min, max) => min + Math.random() * (max - min);
const PETAL_HUES = [328, 336, 344, 352, 358, 12, 20, 28, 36]; // pinks + oranges only

function FallingPetals() {
  const petals = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        // Spread evenly across the viewport (left -> right), with a little
        // jitter so it still feels organic rather than a fixed grid.
        x: Math.min(94, Math.max(2, (i + 0.5) * 20 + rand(-7, 7))),
        dur: rand(13, 21),
        delay: -(i * 5.4 + rand(0, 2.2)), // ~5s stagger; negative = already raining on load
        sway: rand(-55, 55),
        rdur: rand(2.4, 5.8),
        rdir: Math.random() > 0.5 ? 'normal' : 'reverse',
        size: rand(26, 42),
        hue: PETAL_HUES[Math.floor(Math.random() * PETAL_HUES.length)],
        op: rand(0.75, 0.95),
      })),
    []
  );

  return (
    <div className="petal-scene" aria-hidden="true">
      {petals.map((p, i) => (
        <span
          key={i}
          className="petal"
          style={{
            '--x': `${p.x}%`,
            '--dur': `${p.dur}s`,
            '--delay': `${p.delay}s`,
            '--sway': `${p.sway}px`,
            '--op': p.op,
            fontSize: `${p.size}px`,
          }}
        >
          <span
            className="leaf"
            style={{ '--rdur': `${p.rdur}s`, '--rdir': p.rdir, '--hue': p.hue }}
          />
        </span>
      ))}
    </div>
  );
}

// { best, worst } for a comparable metric, or null when there is nothing to
// diff: neutral metric, fewer than two usable values, or an all-way tie.
function metricDiff(data, key) {
  const direction = metricDirection[key] || 'higher';
  if (direction === 'neutral') return null;
  const values = data.map(image => Number(image[key])).filter(Number.isFinite);
  if (values.length < 2) return null;
  const best = direction === 'lower' ? Math.min(...values) : Math.max(...values);
  const worst = direction === 'lower' ? Math.max(...values) : Math.min(...values);
  if (nearlyEqual(best, worst)) return null;
  return { best, worst };
}

// 'best' | 'worst' | undefined for one value within a metric's diff.
function metricStanding(value, diff) {
  if (!diff || !Number.isFinite(value)) return undefined;
  if (nearlyEqual(value, diff.best)) return 'best';
  if (nearlyEqual(value, diff.worst)) return 'worst';
  return undefined;
}

// One-line plain-English explanations shown via the info tips in the report.
const metricDescriptions = {
  Dimensions: 'Pixel width × height of the analyzed image.',
  Format: 'Container format detected from the file bytes, e.g. PNG or JPEG.',
  'File size': 'Size of the uploaded file in kilobytes.',
  Megapixels: 'Total pixel count in millions (width × height ÷ 1,000,000).',
  'Aspect ratio': 'Width divided by height — 1.00 is square, 1.78 is 16:9 landscape.',
  'Data type': 'Numeric type used for pixel values (uint8 stores 0–255 integers).',
  Brightness: 'Average pixel intensity from 0 (black) to 255 (white).',
  Contrast: 'Spread of pixel intensities — higher means darks and lights differ more.',
  Sharpness: 'Edge detail via Laplacian variance — higher usually means crisper focus.',
  Colorfulness: 'How vivid and varied the colours are, from grayscale (0) to vibrant.',
  Entropy: 'How much visual complexity/detail the image contains — higher means more varied content.',
  Saturation: 'Average colour intensity as a percentage — 0% is grayscale, 100% is fully saturated.',
  'Warm/cool': 'Colour temperature lean — negative is cool (blue), positive is warm (orange).',
  Exposure: 'Share of pixels that are too dark (underexposed) or too bright (overexposed).',
};

// Small info icon that reveals its one-line explanation on hover and keyboard focus.
function InfoTip({ text }) {
  return (
    <button
      type="button"
      className="info-tip"
      data-tip={text}
      aria-label={text}
      onClick={event => event.stopPropagation()}
    >
      i
    </button>
  );
}


// Shimmering placeholders shown while data is being fetched.
function SkeletonCards({ count = 8 }) {
  return Array.from({ length: count }, (_, index) => (
    <div className="image-card skeleton-card" key={index} aria-hidden="true">
      <div className="skeleton skeleton-mark" />
      <div className="skeleton skeleton-line w-70" />
      <div className="skeleton skeleton-line w-45" />
      <div className="skeleton skeleton-line w-85" />
      <div className="skeleton-chip-row">
        <span className="skeleton skeleton-chip" />
        <span className="skeleton skeleton-chip" />
        <span className="skeleton skeleton-chip" />
      </div>
    </div>
  ));
}

function ReportSkeleton() {
  return (
    <div className="report-skeleton" aria-hidden="true">
      <div className="skeleton skeleton-line w-45" />
      <div className="skeleton skeleton-line w-85" />
      <div className="skeleton skeleton-block" />
      <div className="report-skeleton-grid">
        <div className="skeleton skeleton-tile" />
        <div className="skeleton skeleton-tile" />
        <div className="skeleton skeleton-tile" />
        <div className="skeleton skeleton-tile" />
      </div>
    </div>
  );
}

function format(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '—';
}

function normalizeReport(data) {
  if (data.image_stats) return data;
  return {
    ...data,
    image_stats: {
      shape: [data.height, data.width, 3],
      dtype: data.img_dtype ?? '—',
    },
    histogram: data.histogram_regions ?? {},
  };
}

function normalizePercent(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || !max) return 0;
  return Math.min(100, (number / max) * 100);
}

function useReveal(active = true) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.classList.add('is-visible');
      return undefined;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          element.classList.add('is-visible');
          observer.unobserve(element);
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  return ref;
}

function Reveal({ children, className = '', delay = 0, as: Tag = 'div', ...props }) {
  const ref = useReveal();
  return (
    <Tag
      ref={ref}
      className={`reveal ${className}`.trim()}
      style={{ '--reveal-delay': `${delay}ms` }}
      {...props}
    >
      {children}
    </Tag>
  );
}

function App() {
  const [page, setPage] = useState('home');
  const [pendingScroll, setPendingScroll] = useState(null);
  const [tourStep, setTourStep] = useState(null);
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Reveal the floating back-to-top button once the user scrolls down.
  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 400);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState([]);
  const [compare, setCompare] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [galleryPage, setGalleryPage] = useState(0);
  const [galleryQuery, setGalleryQuery] = useState('');
  const [gallerySort, setGallerySort] = useState('newest');
  const [galleryTotal, setGalleryTotal] = useState(0);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [detailId, setDetailId] = useState(null);
  const [detailReport, setDetailReport] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const fileRef = useRef();
  const toastSeq = useRef(0);
  const lastGalleryFetch = useRef('');
  const tourTargets = useRef({});

  const pushToast = useCallback((kind, text) => {
    const id = ++toastSeq.current;
    setToasts(current => [...current, { id, kind, text }].slice(-4));
    window.setTimeout(() => {
      setToasts(current => current.filter(toast => toast.id !== id));
    }, 4500);
  }, []);
  const dismissToast = useCallback(id => {
    setToasts(current => current.filter(toast => toast.id !== id));
  }, []);
  const endTour = useCallback(() => {
    try {
      window.localStorage.setItem(TOUR_KEY, '1');
    } catch {
      /* storage unavailable — the tour just closes */
    }
    setTourStep(null);
  }, []);
  const nextTourStep = useCallback(() => {
    setTourStep(current => (current != null && current + 1 < tourSteps.length ? current + 1 : null));
  }, []);
  const getTourTarget = useCallback(() => tourTargets.current[tourSteps[tourStep]?.id], [tourStep]);
  const goToLimitations = useCallback(() => {
    if (page === 'home') {
      const target = document.getElementById('limitations');
      if (target && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }
    setPendingScroll('limitations');
    setPage('home');
  }, [page]);
  // Helper that centralizes fetch + JSON parsing and turns network failures
  // into a clear, actionable Error so the UI doesn't show "Failed to fetch".
  const safeFetchJson = useCallback(async (url, options = {}) => {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body && (body.detail || body.message)) || `Server error ${res.status} ${res.statusText}`);
      }
      // 204 No Content (e.g. successful DELETE) and other empty bodies have
      // nothing to parse — return null instead of letting json() throw
      // "Unexpected end of JSON input".
      if (res.status === 204) return null;
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (err) {
      // Network errors in browsers typically surface as TypeError with message
      // "Failed to fetch" — detect that and provide a helpful hint to the user.
      if (err instanceof TypeError || String(err.message).includes('Failed to fetch')) {
        throw new Error(`Cannot reach the analysis API at ${API}. Is the backend running? Check by opening ${API}/docs in this browser. If that works but this page still fails, the page origin is not allowed by the API's CORS settings.`);
      }
      throw err;
    }
  }, []);

  const fetchSaved = useCallback(async (options = {}) => {
    const nextPage = options.page ?? galleryPage;
    const nextQuery = options.q ?? galleryQuery;
    const nextSort = options.sort ?? gallerySort;
    setGalleryQuery(nextQuery);
    setGallerySort(nextSort);
    setGalleryPage(nextPage);
    lastGalleryFetch.current = `${nextPage}|${nextQuery.trim()}|${nextSort}`;
    setGalleryLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(GALLERY_PAGE_SIZE),
        offset: String(nextPage * GALLERY_PAGE_SIZE),
        sort: nextSort,
      });
      if (nextQuery.trim()) params.set('q', nextQuery.trim());
      const data = await safeFetchJson(`${API}/images?${params.toString()}`);
      // Tolerate both the paginated { items, total, ... } shape and a legacy
      // bare array (e.g. an API server that has not picked up pagination yet).
      const payload = Array.isArray(data)
        ? { items: data, total: data.length, limit: data.length, offset: 0 }
        : data;
      const items = Array.isArray(payload.items) ? payload.items : [];
      setImages(items);
      setGalleryTotal(Number.isFinite(payload.total) ? payload.total : items.length);
      return payload;
    } finally {
      setGalleryLoading(false);
    }
  }, [galleryPage, galleryQuery, gallerySort, safeFetchJson]);
  useEffect(() => {
    if (page !== 'app') {
      setTourStep(current => (current == null ? current : null));
      return;
    }
    let seenTour = false;
    try {
      seenTour = Boolean(window.localStorage.getItem(TOUR_KEY));
    } catch {
      seenTour = false;
    }
    if (!seenTour) setTourStep(current => (current == null ? 0 : current));
  }, [page]);
  useEffect(() => {
    if (page !== 'home' || !pendingScroll) return;
    const target = document.getElementById(pendingScroll);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setPendingScroll(null);
  }, [page, pendingScroll]);
  useEffect(() => {
    if (page !== 'app') {
      lastGalleryFetch.current = '';
      return undefined;
    }
    const key = `${galleryPage}|${galleryQuery.trim()}|${gallerySort}`;
    if (lastGalleryFetch.current === key) return undefined;
    const timer = window.setTimeout(() => {
      fetchSaved().catch(error => pushToast('error', error.message));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [page, galleryPage, galleryQuery, gallerySort, fetchSaved, pushToast]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Client-side navigation helper and deep-link handling so visible nav items
  // map to real (bookmarkable) URLs and don't 404 when opened directly.
  const navigateTo = useCallback((nextPage, { replace = false, scrollTo = null } = {}) => {
    const map = { home: '/', app: '/analyzer', how: '/how-it-works', limitations: '/limitations', contrib: '/contributing' };
    setPage(nextPage);
    if (scrollTo) setPendingScroll(scrollTo);
    try {
      const path = map[nextPage] || '/';
      if (replace) window.history.replaceState({}, '', path);
      else window.history.pushState({}, '', path);
    } catch (e) {
      // ignore pushState errors in constrained environments
    }
  }, []);

  // Initialise page from URL on first load and respond to back/forward.
  useEffect(() => {
    const resolveFromPath = (p) => {
      const path = (p || window.location.pathname || '/').replace(/\/$/, '');
      if (path === '/analyzer') return 'app';
      if (path === '/how-it-works') return 'how';
      if (path === '/limitations') return 'limitations';
      if (path === '/contributing') return 'contrib';
      return 'home';
    };
    setPage(resolveFromPath(window.location.pathname));
    const onPop = () => setPage(resolveFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pickFile = (event) => {
    const next = event.target.files?.[0];
    if (!next) return;
    if (next.size > MAX_UPLOAD_MB * 1024 * 1024) {
      pushToast('error', `"${next.name}" is ${Math.ceil(next.size / (1024 * 1024))} MB — the upload limit is ${MAX_UPLOAD_MB} MB.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setReport(null);
  };
  const analyze = async ({ save = true } = {}) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      pushToast('error', `That file exceeds the ${MAX_UPLOAD_MB} MB upload limit.`);
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const data = await safeFetchJson(`${API}/analyze${save ? '?save_db=true' : ''}`, { method: 'POST', body: form });
      setReport(data);
      if (save) {
        const saved = await fetchSaved({ page: 0, q: '', sort: 'newest' });
        const matching = saved.items.find(image => image.filename === data.filename);
        if (matching) setSelected(current => (current.includes(matching.id) ? current : [...current, matching.id]));
        pushToast('success', 'Analysis complete and saved to the gallery.');
      } else {
        pushToast('success', 'Analysis complete. Save it below to add it to the gallery.');
      }
    } catch (error) {
      pushToast('error', error.message);
    } finally {
      setLoading(false);
    }
  };
  const toggle = id => {
    setSelected(current => (current.includes(id) ? current.filter(x => x !== id) : [...current, id]));
    setCompare([]);
  };
  const runCompare = async () => {
    if (selected.length < 2) return;
    setLoading(true);
    try {
      const data = await safeFetchJson(`${API}/compare?ids=${selected.join(',')}`);
      setCompare(data);
    } catch (error) {
      pushToast('error', error.message);
    } finally {
      setLoading(false);
    }
  };
  const openDetail = async (id) => {
    setDetailId(id);
    setDetailLoading(true);
    setDetailError('');
    setDetailReport(null);
    try {
      const data = await safeFetchJson(`${API}/images/${id}`);
      setDetailReport(normalizeReport(data));
    } catch (error) {
      setDetailError(error.message);
    } finally {
      setDetailLoading(false);
    }
  };
  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetailReport(null);
    setDetailError('');
    setDetailLoading(false);
  }, []);
  const deleteImage = async (id) => {
    if (!window.confirm("Delete this image's record?")) return;
    try {
      await safeFetchJson(`${API}/images/${id}`, { method: 'DELETE' });
      setSelected(current => current.filter(x => x !== id));
      setCompare(current => current.filter(image => image.id !== id));
      if (detailId === id) closeDetail();
      const saved = await fetchSaved();
      if (!saved.items.length && galleryPage > 0) await fetchSaved({ page: galleryPage - 1 });
      pushToast('success', 'Record deleted.');
    } catch (error) {
      pushToast('error', error.message);
    }
  };
  const selectedNames = useMemo(() => (images || []).filter(i => selected.includes(i.id)), [images, selected]);

  return (
    <main className="site">
      <div className="global-background" aria-hidden="true" />
      <FallingPetals />
      <header>
        <div className="header-left-spacer" aria-hidden="true" />
        <nav>
          <a href="/" className={page === 'home' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('home'); }}>Home</a>
          <a href="/analyzer" className={page === 'app' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('app'); }}>Analyzer</a>
          <a href="/how-it-works" className={page === 'how' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('how'); }}>How it works</a>
          <a href="/limitations" className={page === 'limitations' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('limitations'); }}>Limitations</a>
          <a href="/contributing" className={page === 'contrib' ? 'active' : ''} onClick={(e) => { e.preventDefault(); navigateTo('contrib'); }}>Contributing</a>
        </nav>
      </header>
      {page === 'home' ? (
        <Home openApp={() => navigateTo('app')} />
      ) : page === 'app' ? (
        <Analyzer
          file={file}
          preview={preview}
          report={report}
          loading={loading}
          gallery={{
            items: images,
            total: galleryTotal,
            page: galleryPage,
            query: galleryQuery,
            sort: gallerySort,
            loading: galleryLoading,
          }}
          selected={selected}
          compare={compare}
          selectedNames={selectedNames}
          pickFile={pickFile}
          analyze={analyze}
          toggle={toggle}
          runCompare={runCompare}
          openDetail={openDetail}
          deleteImage={deleteImage}
          refreshSaved={fetchSaved}
          onGallerySearch={query => { setGalleryQuery(query); setGalleryPage(0); }}
          onGallerySort={sort => { setGallerySort(sort); setGalleryPage(0); }}
          onGalleryPage={setGalleryPage}
          tourTargets={tourTargets}
          fileRef={fileRef}
        />
      ) : page === 'limitations' ? (
        <LimitationsPage />
      ) : page === 'how' ? (
        <HowItWorksPage />
      ) : page === 'contrib' ? (
        <ContributingPage />
      ) : (
        <Home openApp={() => navigateTo('app')} />
      )}
      {page === 'app' && tourStep != null && (
        <GuidedTour
          stepIndex={tourStep}
          getTarget={getTourTarget}
          isLast={tourStep === tourSteps.length - 1}
          onNext={nextTourStep}
          onClose={endTour}
        />
      )}
      {detailId != null && (
        <GalleryModal
          report={detailReport}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      )}
      <footer className="site-footer">
        <div className="footer-top">
          <div className="footer-brand">
            <span className="footer-wordmark">LUMEN</span>
            <p className="footer-tagline">Image Quality &amp; Metadata Analysis Engine</p>
          </div>
          <div className="footer-cols">
            <nav className="footer-col" aria-label="Footer navigation">
              <h4>Navigation</h4>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN" target="_blank" rel="noopener noreferrer"><GitHubIcon />GitHub Repository</a>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/LICENSE" target="_blank" rel="noopener noreferrer"><LicenseIcon />MIT License</a>
            </nav>
            <nav className="footer-col" aria-label="Community and support">
              <h4>Community &amp; Support</h4>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer"><HeartIcon />Contributing</a>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/issues" target="_blank" rel="noopener noreferrer"><FlagIcon />Report an Issue</a>
            </nav>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Built with FastAPI, PostgreSQL &amp; React</span>
          <div className="footer-meta">
            <a
              className="footer-star"
              href="https://github.com/PIYUSH-NEXTGEN/LUMEN"
              target="_blank"
              rel="noopener noreferrer"
            >
              <StarIcon />Like LUMEN? Give it a star on GitHub
            </a>
          </div>
        </div>
      </footer>
      {showBackToTop && (
        <button
          type="button"
          className="back-to-top"
          aria-label="Back to top"
          title="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <ArrowUpIcon />
        </button>
      )}
      <div className="toast-stack" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.kind}`} role="status">
            <span className="toast-icon" aria-hidden="true">
              {toast.kind === 'error' ? '✕' : toast.kind === 'success' ? '✓' : 'ℹ'}
            </span>
            <p>{toast.text}</p>
            <button type="button" className="toast-close" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}>×</button>
          </div>
        ))}
      </div>
    </main>
  );
}

function GitHubIcon() {
  return (
    <svg className="icon-github" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
function FlagIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3m0 1h11l-1 4 1 4H5" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 4v7m4-7v7M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" /></svg>; }
function ArrowUpIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-7 7 7-7 7 7" /></svg>; }
function HeartIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5C7.2 16.4 3.5 13.2 3.5 9.3c0-2.4 1.9-4.3 4.3-4.3 1.7 0 3.2 1 4.2 2.4 1-1.4 2.5-2.4 4.2-2.4 2.4 0 4.3 1.9 4.3 4.3 0 3.9-3.7 7.1-8.5 11.2z" /></svg>; }
function StarIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>; }
function LicenseIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v15H6zM15 2v5h5M9 13h6M9 17h6" /></svg>; }

function Home({ openApp }) {
  const heroRef = useReveal();
  const [openFeature, setOpenFeature] = useState(null);
  useEffect(() => {
    const timer = window.setTimeout(() => heroRef.current?.classList.add('is-visible'), 80);
    return () => window.clearTimeout(timer);
  }, [heroRef]);

  return (
    <>
      <section className="hero reveal" ref={heroRef}>
        <HeroWordmark />
        <p>A command-line and API-based image analysis tool for quality metrics, channel statistics, dominant colours, and exact-hash duplicate detection.</p>
        <p style={{ marginTop: 12, fontSize: '0.95rem', fontWeight: 500 }}>Accepted formats: PNG, JPEG, WebP. Files are sent to the configured API for processing; no third-party sharing by default. Click "Open analyzer" to upload and analyze an image.</p>
        <button type="button" className="primary" onClick={openApp}>Open analyzer <span>→</span></button>
      </section>
      <section className="content-section">
        <div className="section-head">
          <h2>WHAT IT MEASURES</h2>
        </div>
        <div className="feature-grid">
          {[
            ['Image statistics', 'Counts the pixels, notes the data type, and works out the mean, spread, and range of every image. Handy as a first pass before digging into anything fancier.'],
            ['Channel statistics', 'Runs the same numbers separately for red, green, and blue. If a photo looks off, this usually tells you which channel is dragging it down.'],
            ['Brightness & luminance', 'Gives a plain brightness score plus a luminance-weighted one that accounts for how the eye reads colour. A dark photo scores low before you even see it.'],
            ['Contrast & sharpness', 'Contrast comes from how far the luminance values spread out. Sharpness is measured with a Laplacian, so blurry shots stand out quickly.'],
            ['Colorfulness & entropy', 'Colorfulness is a rough proxy for how much colour variation is going on. Entropy measures how busy the pixel distribution is, a decent stand-in for detail.'],
            ['Exposure analysis', 'Tells you what share of pixels sit in the underexposed and overexposed zones. Useful when a picture technically loads but looks washed out or crushed.'],
            ['Histogram regions', 'Splits each channel histogram into dark, mid, and bright bands and reports the percentage sitting in each. Skewed images show up immediately.'],
            ['Dominant colors', 'Pulls out the top colours with their RGB values and the share of pixels they cover. Good for palettes, thumbnails, and quick sorting of a folder.'],
            ['Duplicate detection', 'Hashes every file with SHA-256 and flags exact matches. Byte-identical copies get caught every time; resized versions will not, since the hash changes.'],
          ].map(([title, body], index) => (
            <article
              className={`feature feature-collapsible${openFeature === index ? ' is-open' : ''}`}
              key={title}
              role="button"
              tabIndex={0}
              aria-expanded={openFeature === index}
              onClick={() => setOpenFeature(openFeature === index ? null : index)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenFeature(openFeature === index ? null : index);
                }
              }}
            >
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p className="feature-hint">{openFeature === index ? 'Click to close' : 'Click to see details'}</p>
              <div className="feature-body"><p>{body}</p></div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

// Standalone How it works page at /how-it-works explaining the analysis pipeline.
function HowItWorksPage() {
  return (
    <main className="how-page">
      <div className="section-head">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2>From pixels to numbers, in one pass.</h2>
      </div>

      <div className="panel how-panel how-intro">
        <p>
          LUMEN takes an image file and turns it into a small table of numbers: how bright it is,
          how sharp, how colourful, how much of it is blown out, and whether it happens to be a
          byte-for-byte copy of another image. This page walks through the full journey of an image
          through the system, and explains why each piece is built the way it is.
        </p>
      </div>

      <div className="how-flow" aria-label="Analysis pipeline diagram">
        <div className="flow-step"><span className="flow-num">1</span><strong>Your image</strong><small>PNG · JPEG · BMP · GIF</small></div>
        <div className="flow-arrow">→</div>
        <div className="flow-step"><span className="flow-num">2</span><strong>Load</strong><small>Pillow → RGB array</small></div>
        <div className="flow-arrow">→</div>
        <div className="flow-step"><span className="flow-num">3</span><strong>Analyze</strong><small>NumPy pipeline</small></div>
        <div className="flow-arrow">→</div>
        <div className="flow-step"><span className="flow-num">4</span><strong>Report</strong><small>validated by Pydantic</small></div>
      </div>
      <div className="how-flow" aria-label="Where results are stored">
        <p className="flow-row-label">The finished report can go to any of these, alone or together:</p>
        <div className="flow-step"><strong>CSV</strong><small>flat spreadsheet rows</small></div>
        <div className="flow-step"><strong>JSON</strong><small>full structured report</small></div>
        <div className="flow-step"><strong>PostgreSQL</strong><small>queryable history</small></div>
        <div className="flow-step"><strong>Dashboard</strong><small>this web app</small></div>
      </div>


      <div className="panel how-panel">
        <h3>Step one: getting the pixels into NumPy</h3>
        <p>
          Everything begins with Pillow, the standard Python imaging library. It opens the file,
          decodes the pixels, and converts them to RGB before handing the result to NumPy as a
          plain array of integers between 0 and 255. It doesn't matter whether the source was a
          JPEG, a PNG, a BMP or a GIF: after this point every image looks identical to the rest of
          the code. Three channels, one shape, one set of assumptions. Grayscale files get flagged
          in the log, because losing colour information is worth knowing about.
        </p>
        <p>
          That conversion is the quiet backbone of the whole system. Once the image lives in a
          NumPy array, every measurement that follows runs as a vectorised operation: whole arrays
          are summed, sorted and binned inside optimised C loops instead of Python for-loops. It is
          the difference between analysing an image in milliseconds and grinding through it pixel
          by pixel.
        </p>
        <h3>Step two: what actually gets measured</h3>
        <p>
          Each metric earns its place by answering a question you would otherwise answer by
          squinting at the image.
        </p>
        <ul className="how-list">
          <li><strong>Brightness</strong> — the plain mean of every pixel value, plus a luminance-weighted version. The weighted one exists because eyes do not treat the three channels equally: green dominates perceived brightness, red contributes far less, blue almost nothing. Two photos with identical raw means can look very different.</li>
          <li><strong>Contrast</strong> — the standard deviation of luminance, in other words how far the values spread out from the middle. Flat, hazy shots have a small spread; punchy ones a large one.</li>
          <li><strong>Sharpness</strong> — the variance of a Laplacian filter response. The Laplacian reacts to edges, so a crisp photo produces strong responses while a blurry one barely twitches. The variance of that response is a well-established way to detect blur without needing a reference image.</li>
          <li><strong>Colorfulness</strong> — the average gap between each pixel's strongest and weakest channel. This is deliberately simplified: the formal Hasler–Süsstrunk metric from the computer vision literature is heavier to compute, and for comparing images against each other the cheap proxy holds up well.</li>
          <li><strong>Entropy</strong> — Shannon entropy over the intensity distribution, or how unpredictable a randomly picked pixel is. Flat skies score low, dense foliage scores high.</li>
          <li><strong>Exposure</strong> — the percentage of pixels below the dark threshold and above the bright one. Useful when a photo technically loads fine but is crushed at the blacks or clipped at the whites.</li>
          <li><strong>Bookkeeping</strong> — aspect ratio, megapixels, file size, format, mean saturation and a warm/cool bias, so the reports stay useful outside this tool too.</li>
        </ul>

        <h3>Step three: the histogram and its thresholds</h3>
        <p>
          Each channel gets a histogram with 256 bins, one bin per possible intensity value, so
          nothing is smoothed away or approximated. The dark and bright thresholds (85 and 170 out
          of 255) live in <code>config.py</code> rather than being hard-coded, which means you can
          tune what counts as "too dark" for your collection without touching pipeline code.
        </p>
        <h3>Step four: duplicate detection, and its honest limits</h3>
        <p>
          Every file is hashed with SHA-256 over its raw bytes. That method was picked because it
          is fast, deterministic, and has exactly zero false positives: if two files hash the same,
          they are the same file, full stop. The trade-off is just as clear-cut. Resize a photo or
          re-save it and the hash changes completely, so near-duplicates slip through untouched.
          Perceptual hashing would catch those, at the cost of occasional false matches, and it is
          the most likely future addition. Exact hashing came first because it never lies.
        </p>

        <h3>Step five: why batch analysis uses processes, not threads</h3>
        <p>
          The command line scans a folder and hands each image to a <code>ProcessPoolExecutor</code>,
          which spreads the work across worker processes, one per CPU core. Threads would not help
          here: Python's global interpreter lock means threads cannot run CPU-bound work side by
          side, and decoding and measuring images is exactly that. Processes sidestep the lock
          entirely. Since every image is independent of every other one, splitting a folder across
          cores is trivial and gives close to linear speedup on large collections.
        </p>

        <h3>Step six: where the results end up</h3>
        <p>
          CSV gives you one flat row per image, ready for a spreadsheet or a data pipeline. JSON
          gives you the complete structured report, duplicate groups included. Neither requires any
          setup beyond running the command.
        </p>
        <p>
          PostgreSQL is optional but worth describing. The nested results (per-channel stats,
          histograms, dominant colour lists) are stored in JSONB columns rather than being
          flattened into dozens of sparse table columns. JSONB was chosen because the report shape
          keeps growing, and a schema-less column absorbs new fields without a migration every
          time. Saves are upserts keyed on file path: analysing the same file twice updates the
          existing row instead of piling up copies, so re-running a folder is always safe.
        </p>

        <h3>Step seven: the API and this dashboard</h3>
        <p>
          FastAPI ties it together. It was chosen over the alternatives for two practical reasons:
          Pydantic models validate every report automatically, so a malformed response is caught
          before it reaches a client, and the interactive Swagger docs at <code>/docs</code> come
          for free. Uploads stream in 8 KB chunks and are rejected with a clean 413 the moment they
          cross the 50 MB cap, so a careless client cannot exhaust server memory. Corrupt or
          non-image files get a plain 400 with a readable message, not a stack trace.
        </p>
        <p>
          The endpoints cover the whole workflow: <code>/analyze</code> for a single image,
          <code> /images</code> for a paginated, searchable, sortable gallery,
          <code> /images/&#123;id&#125;</code> for one stored report, and <code>/compare</code> for
          side-by-side metrics. This React dashboard is nothing more than a client of those
          endpoints: it uploads, browses, compares and deletes, and every number it shows came from
          the same pipeline described above.
        </p>
      </div>

      <p className="how-back"><a href="/" onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Back to home</a></p>
    </main>
  );
}

// Small standalone Limitations page reachable at /limitations
function LimitationsPage() {
  return (
    <main className="content-section">
      <div className="section-head">
        <h2>What LUMEN does not do.</h2>
      </div>
      <div className="panel limitations-page" style={{ padding: 24 }}>
        <p>
          LUMEN measures images; it does not understand them. Since it is easier to set expectations
          now than to disappoint later, here is an honest list of things it might look like it does
          but doesn't.
        </p>
        <ul>
          <li>
            <strong>It won't find near-duplicates.</strong> Only byte-for-byte copies are caught,
            because matching works on SHA-256 hashes of the raw file. Resize, re-compress or
            re-save a photo and the hash changes completely, so that copy slips through untouched.
            Perceptual hashing is the planned fix, but it isn't in yet.
          </li>
          <li>
            <strong>It has no idea what's in the picture.</strong> No object detection, no scene
            recognition, no AI captions. LUMEN measures pixels — brightness, sharpness, colour,
            entropy — and stays completely blind to subjects. A photo of a cat and a photo of a
            car with identical tonality produce nearly identical reports.
          </li>
          <li>
            <strong>It ignores EXIF metadata.</strong> Camera model, lens, exposure settings, GPS
            coordinates, timestamps: none of that is read. Only the pixel data is analysed, so a
            shot taken on a flagship phone and a twenty-year-old point-and-shoot are judged purely
            by what's in the frame.
          </li>
          <li>
            <strong>Compare is numbers only.</strong> Two images go side by side on their metrics,
            with markers showing which one leads each stat. It will never tell you the images
            "look alike" — perceptual or visual similarity is simply not computed.
          </li>
          <li>
            <strong>There is no history.</strong> Saving the same file again overwrites its
            previous record instead of keeping both. If you re-analyze a photo after tweaking it,
            the older numbers are gone, so there is no timeline of how an image changed over time.
          </li>
        </ul>
        <p className="portfolio-note">This is currently a learning and portfolio-stage project, not production-ready software.</p>
        <p style={{ marginTop: 14 }}><a href="/" onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Back to home</a></p>
      </div>
    </main>
  );
}

// Small Contributing page at /contributing that points to the real repo and explains how to help.
function ContributingPage() {
  return (
    <main className="content-section">
      <div className="section-head">
        <p className="eyebrow">CONTRIBUTING</p>
        <h2>Help make LUMEN better</h2>
      </div>
      <div className="panel how-panel">
        <h3>What this project actually is</h3>
        <p>
          LUMEN started as a learning project and grew into three connected tools: a command-line
          app that analyses whole folders of images in parallel, a FastAPI service that exposes the
          same pipeline over HTTP, and the React dashboard you are looking at right now. The stack
          is deliberately small — Python with NumPy and Pillow for the analysis, SQLAlchemy with
          optional PostgreSQL for storage, Vite and React for this frontend. No ML frameworks, no
          message queues, no caching layers. The whole point is to do one job cleanly and stay
          readable while doing it.
        </p>
        <p>
          The codebase is small on purpose. <code>analyzer.py</code> holds the entire single-image
          pipeline, <code>image_analyzer/</code> holds the reusable pieces (loading, statistics,
          histograms, quality metrics, hashing, reporting, database), <code>api.py</code> is the
          web layer, and <code>frontend/src/main.jsx</code> is the whole dashboard in one file. You
          can realistically read all of it in an afternoon, which is exactly what makes it a good
          project to contribute to.
        </p>
      </div>
      <div className="panel how-panel">
        <h3>Ways to help</h3>
        <ul className="how-list">
          <li><strong>Code</strong> — new quality metrics (perceptual hashing, the real Hasler–Süsstrunk colorfulness, a blur map), better duplicate detection, or CLI and API features. Check the open issues first so nobody works on the same thing twice.</li>
          <li><strong>Tests</strong> — the pytest suite covers statistics, quality metrics, duplicate detection and a database round trip, and it skips cleanly without PostgreSQL. More coverage is always welcome, especially around edge cases like corrupt or grayscale images.</li>
          <li><strong>Documentation</strong> — clearer README sections, better docstrings, plainer language on this site. Good docs are worth as much as good code, and easier to start with.</li>
          <li><strong>Design and UX</strong> — the dashboard always has rough edges: layout, charts, colour choices, accessibility. Small interface fixes are genuinely appreciated.</li>
          <li><strong>Bug reports</strong> — open an issue with what you did, what you expected, and what happened. A failing example image attached to the report makes it ten times easier to fix.</li>
        </ul>
      </div>
      <div className="panel how-panel">
        <h3>Getting set up</h3>
        <p>
          The full walkthrough lives in the README, but the short version:
        </p>
        <ul className="how-list">
          <li><strong>Backend</strong> — clone the repo, create a virtualenv, then <code>pip install -e .</code> Try the CLI with <code>python main.py --folder images</code>; no database needed for that.</li>
          <li><strong>API</strong> — run <code>uvicorn api:app --reload</code> and open <code>http://127.0.0.1:8000/docs</code> to poke at every endpoint. PostgreSQL is optional; without it, saving to the gallery just stays off.</li>
          <li><strong>Frontend</strong> — <code>cd frontend &amp;&amp; npm install &amp;&amp; npm run dev</code>. It talks to <code>localhost:8000</code> by default; set <code>VITE_API_BASE_URL</code> to point it elsewhere.</li>
          <li><strong>Tests</strong> — <code>pytest -v</code> from the project root. Everything should pass with or without a database configured.</li>
        </ul>
        <p style={{ marginTop: 18 }}>Full details, including the <code>.env</code> keys and table creation, are in the README's setup guide.</p>

        <h3>Before you open a pull request</h3>
        <ul className="how-list">
          <li>One idea per PR. Small, focused changes get reviewed and merged much faster than sweeping ones.</li>
          <li>Explain the why in the description, not just the what. If it fixes an issue, link it.</li>
          <li>Add or update tests when behaviour changes, and run <code>pytest</code> before pushing.</li>
          <li>Match the existing style. The frontend is plain CSS and a single <code>main.jsx</code> — bring it up in an issue first before introducing a new library or a build step.</li>
        </ul>
      </div>

      <div className="panel how-panel">
        <h3>Useful links</h3>
        <ul className="how-list">
          <li>Repository: <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN" target="_blank" rel="noopener noreferrer">github.com/PIYUSH-NEXTGEN/LUMEN</a></li>
          <li>Bugs and ideas: <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/issues" target="_blank" rel="noopener noreferrer">open an issue</a></li>
          <li>The full contributing guide: <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer">CONTRIBUTING.md</a></li>
        </ul>
        <p className="portfolio-note">This is currently a learning and portfolio-stage project, not production-ready software.</p>
        <p style={{ marginTop: 14 }}><a href="/" onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); }}>Back to home</a></p>
      </div>
    </main>
  );
}

// First-visit guided tour: a spotlight overlay walking through the four
// key Analyzer affordances. Dismissed state lives in localStorage; the ?
// button in the nav replays it on demand.
function GuidedTour({ stepIndex, getTarget, isLast, onNext, onClose }) {
  const step = tourSteps[stepIndex];
  const cardRef = useRef(null);
  const [rect, setRect] = useState(null);

  useLayoutEffect(() => {
    const update = () => {
      const el = getTarget();
      if (!el) return;
      const box = el.getBoundingClientRect();
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };
    update();
    const raf = requestAnimationFrame(update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [getTarget, stepIndex]);

  useEffect(() => {
    const onKey = event => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    cardRef.current?.querySelector('.primary')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, stepIndex]);

  // Bring the highlighted target into view whenever the step changes; the
  // scroll listener in the layout effect keeps the spotlight glued to it
  // while the smooth scroll is in flight.
  useEffect(() => {
    const el = getTarget();
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [getTarget, stepIndex]);

  if (!rect) return null;
  const view = { width: window.innerWidth, height: window.innerHeight };
  const fitsBelow = view.height - (rect.top + rect.height) >= 210;
  const left = Math.min(Math.max(12, rect.left), Math.max(12, view.width - 344));
  const cardStyle = fitsBelow
    ? { top: Math.min(rect.top + rect.height + 14, view.height - 180), left }
    : { bottom: Math.max(12, view.height - rect.top + 14), left };

  return (
    <>
      <div className="tour-backdrop" onClick={onClose} role="presentation" aria-hidden="true" />
      <div
        className="tour-spotlight"
        aria-hidden="true"
        style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
      />
      <div ref={cardRef} className="tour-card" style={cardStyle} role="dialog" aria-label={`Guided tour: ${step.title}`}>
        <p className="tour-step">STEP {stepIndex + 1} OF {tourSteps.length}</p>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        <div className="tour-dots" aria-hidden="true">
          {tourSteps.map((entry, index) => (
            <i key={entry.id} className={index === stepIndex ? 'active' : ''} />
          ))}
        </div>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={onClose}>Skip tour</button>
          <button type="button" className="primary" onClick={isLast ? onClose : onNext}>
            {isLast ? 'Got it' : 'Next'} <span>→</span>
          </button>
        </div>
      </div>
    </>
  );
}

function Analyzer(props) {
  const {
    file, preview, report, loading, gallery, selected, compare,
    selectedNames, pickFile, analyze, toggle, runCompare, openDetail,
    deleteImage, refreshSaved, onGallerySearch, onGallerySort, onGalleryPage, tourTargets, fileRef,
  } = props;

  return (
    <div className="app-page">
      <section className="app-intro">
        <p className="eyebrow">WORKSPACE</p>
        <h1>Inspect the image.</h1>
        <p>Upload an image, save its analysis, then compare its metrics alongside other records.</p>
      </section>
      <div className="render-warning" role="alert">
        <span className="render-warning-icon" aria-hidden="true">⚠️</span>
        <span>Backend runs on Render's free tier — it sleeps after inactivity and takes ~30s to wake up. Analysis and gallery loading may be slow initially. Feel free to explore other sections in the meantime.</span>
      </div>
      <section className="upload-layout">
        <div
          className="upload-box"
          role="button"
          tabIndex={0}
          aria-label="Choose an image to analyze"
          ref={el => { tourTargets.current.upload = el; }}
          onClick={() => fileRef.current.click()}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              fileRef.current.click();
            }
          }}
          onDragOver={event => event.preventDefault()}
          onDrop={event => {
            event.preventDefault();
            if (event.dataTransfer.files[0]) pickFile({ target: { files: event.dataTransfer.files } });
          }}
        >
          <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} />
          <div className="upload-symbol">↑</div>
          <h2>{file ? file.name : 'Choose an image'}</h2>
          <p>
            {file
              ? `${Math.ceil(file.size / 1024)} KB · ready to analyze`
              : `Drop a PNG, JPEG, or WebP here, or browse your device (max ${MAX_UPLOAD_MB} MB).`}
          </p>
          {preview && (
            <img src={preview} alt="Selected preview" className="upload-preview" draggable={false} />
          )}
        </div>
        <div className="analysis-card">
          <p className="eyebrow">ANALYSIS</p>
          {report ? (
            <Report report={report} />
          ) : loading ? (
            <ReportSkeleton />
          ) : (
            <>
              <h2>Start with one image.</h2>
              <p>Results are saved through the API and available for metric comparison below.</p>
            </>
          )}
          <div className="analysis-actions">
            <button
              type="button"
              className="primary"
              disabled={!file || loading}
              onClick={() => analyze({ save: false })}
              ref={el => { tourTargets.current.analyze = el; }}
            >
              {loading ? 'Working…' : 'Analyze'} <span>→</span>
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!file || loading}
              onClick={() => analyze({ save: true })}
            >
              Save to gallery
            </button>
          </div>
        </div>
      </section>
      <section className="workspace-section">
        <div className="section-line">
          <div>
            <p className="eyebrow">SAVED RECORDS</p>
            <h2>Gallery <small>{gallery.total} images</small></h2>
          </div>
          <button type="button" className="text-button" onClick={() => refreshSaved()}>Refresh</button>
        </div>
        <div className="gallery-controls">
          <input
            type="search"
            className="gallery-search"
            placeholder="Search filenames…"
            aria-label="Search saved images by filename"
            value={gallery.query}
            onChange={event => onGallerySearch(event.target.value)}
          />
          <select
            className="gallery-sort"
            aria-label="Sort saved images"
            value={gallery.sort}
            onChange={event => onGallerySort(event.target.value)}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>
        <p className="selection-note">
          {selected.length
            ? `${selected.length} selected — ${selectedNames.map(i => i.filename).join(', ')}`
            : 'Click a card to view full stats. Select two or more to compare.'}
        </p>
        <div className={`gallery${gallery.loading && gallery.items.length ? ' is-refreshing' : ''}`} ref={el => { tourTargets.current.gallery = el; }}>
          {gallery.items.map((image, index) => (
            <GalleryCard
              key={image.id}
              image={image}
              index={index}
              selected={selected.includes(image.id)}
              onOpen={openDetail}
              onToggle={toggle}
              onDelete={deleteImage}
            />
          ))}
          {!gallery.items.length && gallery.loading && <SkeletonCards />}
          {!gallery.items.length && !gallery.loading && (
            <p className="empty">
              {gallery.query ? 'No images match this search.' : 'No saved images yet. Analyze one above to begin.'}
            </p>
          )}
        </div>
        {gallery.total > GALLERY_PAGE_SIZE && (
          <div className="gallery-pagination">
            <button
              type="button"
              className="text-button"
              disabled={gallery.page === 0}
              onClick={() => onGalleryPage(gallery.page - 1)}
            >
              ← Prev
            </button>
            <span className="page-status">
              Page {gallery.page + 1} of {Math.max(1, Math.ceil(gallery.total / GALLERY_PAGE_SIZE))} · {gallery.total} images
            </span>
            <button
              type="button"
              className="text-button"
              disabled={(gallery.page + 1) * GALLERY_PAGE_SIZE >= gallery.total}
              onClick={() => onGalleryPage(gallery.page + 1)}
            >
              Next →
            </button>
          </div>
        )}
        <div className="compare-action" ref={el => { tourTargets.current.compare = el; }}>
          <button type="button" className="primary" disabled={selected.length < 2 || loading} onClick={runCompare}>
            Compare selected <span>→</span>
          </button>
        </div>
        {compare.length > 0 && (
          <Reveal className="compare-reveal">
            <Compare data={compare} />
          </Reveal>
        )}
      </section>
    </div>
  );
}

function GalleryCard({ image, index, selected, onOpen, onToggle, onDelete }) {
  const colors = (image.dominant_colors || []).slice(0, 4);
  const dimensions = image.width && image.height ? `${image.width} × ${image.height}` : '—';

  return (
    <Reveal as="article" className={`image-card ${selected ? 'selected' : ''}`} delay={index * 60}>
      <button
        type="button"
        className="card-delete"
        aria-label="Delete record"
        onClick={event => { event.stopPropagation(); onDelete(image.id); }}
      >
        <TrashIcon />
      </button>
      <button
        type="button"
        className="card-select checkbox"
        aria-label={selected ? 'Deselect for compare' : 'Select for compare'}
        aria-pressed={selected}
        onClick={event => { event.stopPropagation(); onToggle(image.id); }}
      >
        {selected ? '✓' : ''}
      </button>
      <div
        className="card-body"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(image.id)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(image.id);
          }
        }}
      >
        <div className="file-mark">{image.filename.slice(0, 1).toUpperCase()}</div>
        <h3 title={image.filename}>{image.filename}</h3>
        <p>#{image.id} · {image.analyzed_at ? new Date(image.analyzed_at).toLocaleDateString() : 'saved record'}</p>
        <p className="card-dimensions">{dimensions}{image.format ? ` · ${image.format}` : ''}</p>
        <div className="card-metrics">
          <span className="card-chip">Brightness {format(image.mean_brightness)}</span>
          <span className="card-chip">Contrast {format(image.contrast_score)}</span>
          <span className="card-chip">Sharpness {format(image.sharpness_score)}</span>
        </div>
        {colors.length > 0 && (
          <div className="color-strip" aria-label="Dominant colours preview">
            {colors.map(color => (
              <span
                key={`${color.color}-${color.rgb?.join('-')}`}
                className="color-strip-swatch"
                style={{ background: `rgb(${(color.rgb || [0, 0, 0]).join(',')})` }}
                title={`${color.color} (${format(color.percentage)}%)`}
              />
            ))}
          </div>
        )}
      </div>
    </Reveal>
  );
}

function GalleryModal({ report, loading, error, onClose }) {
  useEffect(() => {
    const onKey = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-panel" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Image analysis details">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        {loading && <ReportSkeleton />}
        {error && <p className="modal-status modal-error">{error}</p>}
        {report && <Report report={report} inModal />}
      </div>
    </div>
  );
}

function StatCard({ label, value, max, delay, info }) {
  const display = typeof value === 'string' ? value : format(value);
  const barWidth = max ? normalizePercent(value, max) : null;
  return (
    <Reveal className="stat-card" delay={delay}>
      <span className="stat-label">
        {label}
        {info && <InfoTip text={info} />}
      </span>
      <strong className="stat-value">{display}</strong>
      {barWidth != null && (
        <div className="stat-bar" aria-hidden="true">
          <i style={{ width: `${barWidth}%` }} />
        </div>
      )}
    </Reveal>
  );
}

function Report({ report, inModal = false }) {
  const [height, width] = report.image_stats?.shape || [];
  const channelEntries = Object.entries(report.channel_stats || {});
  const histogramEntries = Object.entries(report.histogram || {});

  const statTiles = [
    { label: 'Dimensions', value: width && height ? `${width} × ${height}` : '—' },
    { label: 'Format', value: report.format || '—' },
    { label: 'File size', value: report.file_size_kb != null ? `${format(report.file_size_kb)} KB` : '—' },
    { label: 'Megapixels', value: report.megapixels, max: 50 },
    { label: 'Aspect ratio', value: report.aspect_ratio, max: 3 },
    { label: 'Data type', value: report.image_stats?.dtype || '—' },
    { label: 'Brightness', value: report.mean_brightness, max: 255 },
    { label: 'Contrast', value: report.contrast_score, max: 127 },
    { label: 'Sharpness', value: report.sharpness_score, max: 5000 },
    { label: 'Colorfulness', value: report.colorfulness_score, max: 255 },
    { label: 'Entropy', value: report.entropy_score, max: 8 },
    { label: 'Saturation', value: report.saturation_mean, max: 100 },
    { label: 'Warm/cool', value: report.warm_cool_bias, max: 255 },
    { label: 'Exposure', value: `${format(report.underexposed_pct)}% under · ${format(report.overexposed_pct)}% over` },
  ];

  return (
    <div className={`report ${inModal ? 'report-modal' : ''}`}>
      <h2 title={report.filename}>{report.filename}</h2>
      <section className="report-section">
        <h3>Overview</h3>
        <div className="stat-grid">
          {statTiles.map((tile, index) => (
            <StatCard
              key={tile.label}
              label={tile.label}
              value={tile.value}
              max={tile.max}
              info={metricDescriptions[tile.label]}
              delay={index * 60}
            />
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Channel breakdown</h3>
        <ChannelChart channels={channelEntries} />
        <div className="channel-grid">
          {channelEntries.map(([channel, values]) => (
            <div className={`channel ${channel}`} key={channel}>
              <h4>{channel}</h4>
              <p>Mean <strong>{format(values?.mean)}</strong></p>
              <p>Std <strong>{format(values?.std)}</strong></p>
              <p>Min / max <strong>{values?.minimum} / {values?.maximum}</strong></p>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Histogram</h3>
        <div className="histogram-list">
          {histogramEntries.map(([channel, values]) => (
            <div className="histogram-row" key={channel}>
              <span>{channel}</span>
              <div className="histogram-bar" aria-label={`${channel} histogram`}>
                <i className="hist-dark" style={{ width: `${values?.dark_pct || 0}%` }} />
                <i className="hist-mid" style={{ width: `${values?.mid_pct || 0}%` }} />
                <i className="hist-bright" style={{ width: `${values?.bright_pct || 0}%` }} />
              </div>
              <small>{format(values?.dark_pct)} / {format(values?.mid_pct)} / {format(values?.bright_pct)}%</small>
            </div>
          ))}
        </div>
        <p className="histogram-key">Dark / mid / bright</p>
      </section>
      <section className="report-section">
        <h3>Dominant colors</h3>
        <DominantColorChart colors={report.dominant_colors || []} />
        <div className="color-list">
          {report.dominant_colors?.map(color => (
            <div className="color-item" key={`${color?.color}-${color?.rgb?.join('-')}`}>
              <span className="color-swatch" style={{ background: color?.rgb ? `rgb(${color.rgb.join(',')})` : '#ccc' }} />
              <div>
                <strong>{color?.color || 'Unknown'}</strong>
                <small>rgb({color?.rgb?.join(', ') || '—'}) · {format(color?.percentage)}%</small>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ChannelChart({ channels }) {
  const labels = [['mean', 'Mean'], ['std', 'Std'], ['minimum', 'Min'], ['maximum', 'Max']];
  const validChannels = (channels || []).filter(([, values]) => values && typeof values === 'object');
  const max = Math.max(255, ...validChannels.flatMap(([, value]) => labels.map(([key]) => Number(value[key]) || 0)));
  if (validChannels.length === 0) {
    return <p className="chart-caption">No channel data available.</p>;
  }
  return (
    <div className="chart-scroll">
      <div className="channel-chart" role="img" aria-label="Grouped bar chart of red, green, and blue channel statistics">
        <div className="chart-axis"><span>255</span><span>128</span><span>0</span></div>
        <div className="channel-chart-groups">
          {validChannels.map(([channel, values]) => (
            <div className="channel-chart-group" key={channel}>
              {labels.map(([key, label]) => (
                <div className="channel-bar-wrap" key={key}>
                  <i
                    className={`channel-bar ${channel}`}
                    style={{ height: `${((Number(values?.[key]) || 0) / max) * 100}%` }}
                    title={`${channel} ${label}: ${format(values?.[key])}`}
                  />
                  <span>{label}</span>
                </div>
              ))}
              <strong>{channel}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DominantColorChart({ colors }) {
  const validColors = (colors || []).filter(c => c && c.rgb && c.percentage != null);
  if (validColors.length === 0) {
    return <p className="chart-caption">No dominant color data available.</p>;
  }
  return (
    <div className="dominant-chart" aria-label="Dominant colour percentages">
      {validColors.map(color => (
        <div className="dominant-bar" key={`${color.color}-bar`}>
          <span>{color.color}</span>
          <div><i style={{ width: `${Math.min(100, Number(color.percentage) || 0)}%`, background: `rgb(${color.rgb.join(',')})` }} /></div>
          <b>{format(color.percentage)}%</b>
        </div>
      ))}
    </div>
  );
}

function CompareChart({ data }) {
  const shades = ['#b84911', '#d66b27', '#e89358', '#f0b186', '#f5cfb2'];
  return (
    <div className="compare-chart-wrap">
      <div className="compare-legend">
        {data.map((image, index) => (
          <span key={image.id}><i style={{ background: shades[index % shades.length] }} />{image.filename}</span>
        ))}
      </div>
      <div className="compare-chart">
        {Object.entries(metricLabels).map(([key, label]) => {
          const diff = metricDiff(data, key);
          const max = Math.max(...data.map(image => Number(image[key]) || 0), 1);
          return (
            <div className="compare-group" key={key}>
              <div className={`compare-bars${diff ? ' has-winner' : ''}`}>
                {data.map((image, index) => {
                  const standing = metricStanding(Number(image[key]), diff);
                  const suffix = standing === 'best' ? ' — leads' : standing === 'worst' ? ' — trails' : '';
                  return (
                    <i
                      key={image.id}
                      className={standing === 'best' ? 'is-best' : undefined}
                      style={{
                        height: `${((Number(image[key]) || 0) / max) * 100}%`,
                        background: shades[index % shades.length],
                      }}
                      title={`${image.filename}: ${format(image[key])}${suffix}`}
                    />
                  );
                })}
              </div>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
      <p className="chart-caption">Each metric group is scaled to its highest selected value; the outlined bar leads that metric (lower wins for under/overexposed %). Exact values and win/loss markers are in the table.</p>
    </div>
  );
}

function Compare({ data }) {
  return (
    <div className="comparison">
      <p className="eyebrow">METRIC COMPARISON</p>
      <h2>Side by side</h2>
      <CompareChart data={data} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              {data.map(image => <th key={image.id}>{image.filename}</th>)}
            </tr>
          </thead>
          <tbody>
            {Object.entries(metricLabels).map(([key, label]) => {
              const diff = metricDiff(data, key);
              return (
                <tr key={key}>
                  <td>{label}</td>
                  {data.map(image => {
                    const standing = metricStanding(Number(image[key]), diff);
                    return (
                      <td key={image.id} className={standing ? `diff-${standing}` : undefined}>
                        {format(image[key])}
                        {standing === 'best' && <span className="diff-mark" title="Leads on this metric">↑</span>}
                        {standing === 'worst' && <span className="diff-mark" title="Trails on this metric">↓</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="diff-legend">
        <span><b className="diff-up">↑</b> leads this metric</span>
        <span><b className="diff-down">↓</b> trails this metric</span>
        <span>Lower wins for under/overexposed %; aspect ratio and warm/cool bias have no better direction.</span>
      </p>
      <p className="table-note">This is a numerical comparison, not a visual similarity score.</p>
    </div>
  );
}

// Last-resort guard: renders the actual error instead of a blank page.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <p className="eyebrow">SOMETHING BROKE</p>
        <h2>The interface hit an unexpected error.</h2>
        <p>{String(error?.message || error)}</p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Reload <span>→</span>
        </button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
