import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './charts.css';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const MAX_UPLOAD_MB = 50;      // keep in sync with config.MAX_UPLOAD_MB on the API
const GALLERY_PAGE_SIZE = 12;  // page size for the saved-records gallery
const TOUR_KEY = 'lumen-tour-done';
const tourSteps = [
  { id: 'upload', title: 'Upload', text: 'Drop a PNG, JPEG, or WebP here — or click the box to browse your device.' },
  { id: 'analyze', title: 'Analyze & save', text: 'Runs the full quality analysis and saves the record to your gallery below.' },
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
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState([]);
  const [compare, setCompare] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
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
      const response = await fetch(`${API}/images?${params.toString()}`);
      if (!response.ok) throw new Error('Could not load saved images. Is the API running?');
      const data = await response.json();
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
  }, [galleryPage, galleryQuery, gallerySort]);
  const fetchDuplicates = async () => {
    const response = await fetch(`${API}/duplicates`);
    if (!response.ok) throw new Error('Could not load duplicate groups.');
    setDuplicates(await response.json());
  };
  useEffect(() => {
    if (page === 'app') fetchDuplicates().catch(() => {});
  }, [page]);
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
  const analyze = async () => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      pushToast('error', `That file exceeds the ${MAX_UPLOAD_MB} MB upload limit.`);
      return;
    }
    setLoading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${API}/analyze?save_db=true`, { method: 'POST', body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Analysis failed.');
      const data = await response.json();
      setReport(data);
      const saved = await fetchSaved({ page: 0, q: '', sort: 'newest' });
      const matching = saved.items.find(image => image.filename === data.filename);
      if (matching) setSelected(current => (current.includes(matching.id) ? current : [...current, matching.id]));
      await fetchDuplicates();
      pushToast('success', 'Analysis complete and saved to the gallery.');
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
      const response = await fetch(`${API}/compare?ids=${selected.join(',')}`);
      if (!response.ok) throw new Error('Unable to compare these images.');
      setCompare(await response.json());
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
      const response = await fetch(`${API}/images/${id}`);
      if (!response.ok) throw new Error('Could not load image details.');
      setDetailReport(normalizeReport(await response.json()));
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
      const response = await fetch(`${API}/images/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('Delete failed.');
      setSelected(current => current.filter(x => x !== id));
      setCompare(current => current.filter(image => image.id !== id));
      if (detailId === id) closeDetail();
      await fetchDuplicates();
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
        <button className="wordmark" type="button" onClick={() => setPage('home')} aria-label="LUMEN — back to home">
          <span className="wordmark-stack" aria-hidden="true">LUMEN</span>
        </button>
        <nav>
          <button type="button" className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>Home</button>
          <button type="button" className={page === 'app' ? 'active' : ''} onClick={() => setPage('app')}>Analyzer</button>
          <button type="button" onClick={goToLimitations}>Limitations</button>
          <a
            href="https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/CONTRIBUTING.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Contributing
          </a>
          <button type="button" className="nav-help" onClick={() => setTourStep(0)} aria-label="Replay the guided tour" title="Replay the guided tour">?</button>
        </nav>
      </header>
      {page === 'home' ? (
        <Home openApp={() => setPage('app')} />
      ) : (
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
          duplicates={duplicates}
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
            <p className="footer-tagline">
              Image analysis, made legible — quality metrics, channel statistics, histograms,
              dominant colours, and exact-hash duplicate detection, through a CLI, a REST API, and this dashboard.
            </p>
            <a
              className="footer-how"
              href="https://github.com/PIYUSH-NEXTGEN/LUMEN#project-layout"
              target="_blank"
              rel="noopener noreferrer"
            >
              How it works →
            </a>
          </div>
          <div className="footer-cols">
            <nav className="footer-col" aria-label="Project links">
              <h4>Project</h4>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN" target="_blank" rel="noopener noreferrer"><GitHubIcon />GitHub</a>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN#readme" target="_blank" rel="noopener noreferrer"><BookIcon />Docs / README</a>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">License</a>
              <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/issues" target="_blank" rel="noopener noreferrer"><FlagIcon />Report an issue / Contribute</a>
            </nav>
            <div className="footer-col">
              <h4>Built with</h4>
              <div className="footer-stack">
                <span className="stack-badge">React</span>
                <span className="stack-badge">FastAPI</span>
                <span className="stack-badge">PostgreSQL</span>
              </div>
              <p className="footer-col-note">
                Core analysis runs on NumPy &amp; Pillow. Results persist to CSV, JSON, or PostgreSQL.
              </p>
            </div>
          </div>
        </div>
        <div className="footer-bottom">
          <span>LUMEN — built as a learning project</span>
          <span>© 2026</span>
        </div>
      </footer>
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

function GitHubIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-3.87c3.07.67 6-1.13 6-5.13 0-1.2-.43-2.2-1.13-3 .12-.7.02-1.5-.1-2.1-.7-.22-1.45.05-2.05.52A7.05 7.05 0 0 0 12 8c-2.05 0-3.93.53-5.72 1.42-.6-.47-1.35-.74-2.05-.52-.12.6-.22 1.4-.1 2.1A4.98 4.98 0 0 0 3 14c0 4 2.93 5.8 6 5.13V22" /><path d="M9 18c-3 .9-3-1.5-4.2-1.8" /></svg>; }
function BookIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 4.5v17M8 6h8" /></svg>; }
function FlagIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3m0 1h11l-1 4 1 4H5" /></svg>; }
function TrashIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-7 4v7m4-7v7M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" /></svg>; }

function Home({ openApp }) {
  const heroRef = useReveal();
  useEffect(() => {
    const timer = window.setTimeout(() => heroRef.current?.classList.add('is-visible'), 80);
    return () => window.clearTimeout(timer);
  }, [heroRef]);

  return (
    <>
      <section className="hero reveal" ref={heroRef}>
        <p className="eyebrow">IMAGE ANALYSIS, MADE LEGIBLE</p>
        <HeroWordmark />
        <p>A command-line and API-based image analysis tool for quality metrics, statistics, and duplicate detection.</p>
        <button type="button" className="primary" onClick={openApp}>Open analyzer <span>→</span></button>
      </section>
      <section className="content-section">
        <div className="section-head">
          <p className="eyebrow">WHAT IT MEASURES</p>
          <h2>Useful detail, without the noise.</h2>
        </div>
        <div className="feature-grid">
          {['Per-image statistics', 'Quality metrics', 'Dominant color extraction', 'Exact duplicate detection', 'CLI exports', 'Optional persistence'].map((title, index) => (
            <article className="feature" key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{['Dimensions, data type, mean, spread, and channel-level values.', 'Brightness, contrast, sharpness, colorfulness, entropy, and exposure.', 'A concise palette with RGB values and share of the image.', 'SHA-256 hash groups identify byte-for-byte matching files.', 'Export analysis as CSV or JSON from the command line.', 'Save analysis results to PostgreSQL when you need a history.'][index]}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="limitations" id="limitations">
        <p className="eyebrow">A CLEAR-EYED NOTE</p>
        <h2>What LUMEN does not do.</h2>
        <ul>
          <li>Duplicate detection is exact-hash only; resized or recompressed near-duplicates are not found.</li>
          <li>Its colorfulness score is a simplified proxy, not the standard CV literature metric.</li>
          <li>There is no historical versioning: re-analysis overwrites a record.</li>
          <li>Compare is metric-based, not a visual or perceptual image comparison.</li>
        </ul>
        <p className="portfolio-note">This is currently a learning and portfolio-stage project, not production-ready software.</p>
      </section>
    </>
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
    file, preview, report, loading, gallery, selected, compare, duplicates,
    selectedNames, pickFile, analyze, toggle, runCompare, openDetail,
    deleteImage, refreshSaved, onGallerySearch, onGallerySort, onGalleryPage, tourTargets, fileRef,
  } = props;

  return (
    <div className="app-page">
      <section className="app-intro">
        <p className="eyebrow">WORKSPACE</p>
        <h1>Inspect the image.<br /><em>Keep the signal.</em></h1>
        <p>Upload an image, save its analysis, then compare its metrics alongside other records.</p>
      </section>
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
          <button type="button" className="primary" disabled={!file || loading} onClick={analyze} ref={el => { tourTargets.current.analyze = el; }}>
            {loading ? 'Working…' : 'Analyze & save'} <span>→</span>
          </button>
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
            <option value="name">Filename A–Z</option>
            <option value="brightness">Brightness high → low</option>
            <option value="dim">Brightness low → high</option>
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
      <section className="workspace-section duplicates">
        <div className="section-line">
          <div>
            <p className="eyebrow">INTEGRITY CHECK</p>
            <h2>Exact duplicates</h2>
          </div>
          <span>{duplicates.length} groups</span>
        </div>
        {duplicates.length ? duplicates.map(group => (
          <div className="duplicate-group" key={group.group_id}>
            <span>SHA-256</span>
            <code>{group.hash}</code>
            <p>{group.images.map(i => i.filename).join(' · ')}</p>
          </div>
        )) : <p className="empty">No exact duplicate groups found.</p>}
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
              <p>Mean <strong>{format(values.mean)}</strong></p>
              <p>Std <strong>{format(values.std)}</strong></p>
              <p>Min / max <strong>{values.minimum} / {values.maximum}</strong></p>
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
                <i className="hist-dark" style={{ width: `${values.dark_pct}%` }} />
                <i className="hist-mid" style={{ width: `${values.mid_pct}%` }} />
                <i className="hist-bright" style={{ width: `${values.bright_pct}%` }} />
              </div>
              <small>{format(values.dark_pct)} / {format(values.mid_pct)} / {format(values.bright_pct)}%</small>
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
            <div className="color-item" key={`${color.color}-${color.rgb.join('-')}`}>
              <span className="color-swatch" style={{ background: `rgb(${color.rgb.join(',')})` }} />
              <div>
                <strong>{color.color}</strong>
                <small>rgb({color.rgb.join(', ')}) · {format(color.percentage)}%</small>
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
  const max = Math.max(255, ...channels.flatMap(([, value]) => labels.map(([key]) => Number(value[key]) || 0)));
  return (
    <div className="chart-scroll">
      <div className="channel-chart" role="img" aria-label="Grouped bar chart of red, green, and blue channel statistics">
        <div className="chart-axis"><span>255</span><span>128</span><span>0</span></div>
        <div className="channel-chart-groups">
          {channels.map(([channel, values]) => (
            <div className="channel-chart-group" key={channel}>
              {labels.map(([key, label]) => (
                <div className="channel-bar-wrap" key={key}>
                  <i
                    className={`channel-bar ${channel}`}
                    style={{ height: `${((Number(values[key]) || 0) / max) * 100}%` }}
                    title={`${channel} ${label}: ${format(values[key])}`}
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
  return (
    <div className="dominant-chart" aria-label="Dominant colour percentages">
      {colors.map(color => (
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
