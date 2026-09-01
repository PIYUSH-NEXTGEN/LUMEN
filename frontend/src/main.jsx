import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './charts.css';

const API = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const metricLabels = {
  mean_brightness: 'Mean brightness', luminance_brightness: 'Luminance',
  contrast_score: 'Contrast', sharpness_score: 'Sharpness',
  colorfulness_score: 'Colorfulness', entropy_score: 'Entropy',
  underexposed_pct: 'Underexposed %', overexposed_pct: 'Overexposed %',
  saturation_mean: 'Saturation', aspect_ratio: 'Aspect ratio',
  warm_cool_bias: 'Warm/cool bias'
};

function format(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : '—';
}

function App() {
  const [page, setPage] = useState('home');
  const [dark, setDark] = useState(false);
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState([]);
  const [compare, setCompare] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const fileRef = useRef();

  const fetchSaved = async () => {
    const response = await fetch(`${API}/images`);
    if (!response.ok) throw new Error('Could not load saved images. Is the API running?');
    const data = await response.json();
    setImages(data);
    return data;
  };
  const fetchDuplicates = async () => {
    const response = await fetch(`${API}/duplicates`);
    if (!response.ok) throw new Error('Could not load duplicate groups.');
    setDuplicates(await response.json());
  };
  useEffect(() => { if (page === 'app') { fetchSaved().catch(e => setMessage(e.message)); fetchDuplicates().catch(() => {}); } }, [page]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pickFile = (event) => {
    const next = event.target.files?.[0];
    if (!next) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(next); setPreview(URL.createObjectURL(next)); setReport(null); setMessage('');
  };
  const analyze = async () => {
    if (!file) return;
    setLoading(true); setMessage('');
    try {
      const form = new FormData(); form.append('file', file);
      const response = await fetch(`${API}/analyze?save_db=true`, { method: 'POST', body: form });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Analysis failed.');
      const data = await response.json(); setReport(data);
      const saved = await fetchSaved();
      const matching = [...saved].reverse().find(image => image.filename === data.filename);
      if (matching) setSelected(current => current.includes(matching.id) ? current : [...current, matching.id]);
      await fetchDuplicates();
      setMessage('Analysis complete and saved to the gallery.');
    } catch (error) { setMessage(error.message); } finally { setLoading(false); }
  };
  const toggle = id => { setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id]); setCompare([]); };
  const runCompare = async () => {
    if (selected.length < 2) return;
    setLoading(true); setMessage('');
    try {
      const response = await fetch(`${API}/compare?ids=${selected.join(',')}`);
      if (!response.ok) throw new Error('Unable to compare these images.');
      setCompare(await response.json());
    } catch (error) { setMessage(error.message); } finally { setLoading(false); }
  };
  const selectedNames = useMemo(() => images.filter(i => selected.includes(i.id)), [images, selected]);

  return <main className={dark ? 'site dark' : 'site'}>
    <div className="global-background" aria-hidden="true" />
    <header><button className="wordmark" onClick={() => setPage('home')}>LUMEN</button><nav>
      <button className={page === 'home' ? 'active' : ''} onClick={() => setPage('home')}>Home</button>
      <button className={page === 'app' ? 'active' : ''} onClick={() => setPage('app')}>Analyzer</button>
      <button className="theme" onClick={() => setDark(!dark)} aria-label="Toggle colour theme">{dark ? 'Light' : 'Dark'}</button>
    </nav></header>
    {page === 'home' ? <Home openApp={() => setPage('app')} /> : <Analyzer {...{file, preview, report, loading, message, images, selected, compare, duplicates, selectedNames, pickFile, analyze, toggle, runCompare, fileRef}} />}
    <footer className="site-footer">
      <span className="footer-note">LUMEN — built as a learning project</span>
      <div className="footer-links">
        <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN" target="_blank" rel="noopener noreferrer"><GitHubIcon />GitHub</a>
        <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN#readme" target="_blank" rel="noopener noreferrer"><BookIcon />Docs / README</a>
        <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">License</a>
        <a href="https://github.com/PIYUSH-NEXTGEN/LUMEN/issues" target="_blank" rel="noopener noreferrer"><FlagIcon />Report an issue / Contribute</a>
      </div>
      <span>© 2026</span>
    </footer>
  </main>;
}

function GitHubIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-3.87c3.07.67 6-1.13 6-5.13 0-1.2-.43-2.2-1.13-3 .12-.7.02-1.5-.1-2.1-.7-.22-1.45.05-2.05.52A7.05 7.05 0 0 0 12 8c-2.05 0-3.93.53-5.72 1.42-.6-.47-1.35-.74-2.05-.52-.12.6-.22 1.4-.1 2.1A4.98 4.98 0 0 0 3 14c0 4 2.93 5.8 6 5.13V22" /><path d="M9 18c-3 .9-3-1.5-4.2-1.8" /></svg> }
function BookIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 4.5v17M8 6h8" /></svg> }
function FlagIcon() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 22V3m0 1h11l-1 4 1 4H5" /></svg> }

function Home({ openApp }) { return <>
  <section className="hero reveal"><p className="eyebrow">IMAGE ANALYSIS, MADE LEGIBLE</p><h1 className="brand-heading" aria-label="LUMEN"><span className="brand-text brand-en">LUMEN</span><span className="brand-text brand-ja" aria-hidden="true">ルーメン</span></h1><p>A command-line and API-based image analysis tool for quality metrics, statistics, and duplicate detection.</p><button className="primary" onClick={openApp}>Open analyzer <span>→</span></button></section>
  <section className="content-section"><div className="section-head"><p className="eyebrow">WHAT IT MEASURES</p><h2>Useful detail, without the noise.</h2></div><div className="feature-grid">
    {['Per-image statistics', 'Quality metrics', 'Dominant color extraction', 'Exact duplicate detection', 'CLI exports', 'Optional persistence'].map((title, i) => <article className="feature" key={title}><span>0{i + 1}</span><h3>{title}</h3><p>{['Dimensions, data type, mean, spread, and channel-level values.', 'Brightness, contrast, sharpness, colorfulness, entropy, and exposure.', 'A concise palette with RGB values and share of the image.', 'SHA-256 hash groups identify byte-for-byte matching files.', 'Export analysis as CSV or JSON from the command line.', 'Save analysis results to PostgreSQL when you need a history.'][i]}</p></article>)}
  </div></section>
  <section className="limitations"><p className="eyebrow">A CLEAR-EYED NOTE</p><h2>What LUMEN does not do.</h2><ul><li>Duplicate detection is exact-hash only; resized or recompressed near-duplicates are not found.</li><li>Its colorfulness score is a simplified proxy, not the standard CV literature metric.</li><li>There is no historical versioning: re-analysis overwrites a record.</li><li>Compare is metric-based, not a visual or perceptual image comparison.</li></ul><p className="portfolio-note">This is currently a learning and portfolio-stage project, not production-ready software.</p></section>
</> }

function Analyzer(props) { const { file, preview, report, loading, message, images, selected, compare, duplicates, selectedNames, pickFile, analyze, toggle, runCompare, fileRef } = props; return <div className="app-page">
  <section className="app-intro"><p className="eyebrow">WORKSPACE</p><h1>Inspect the image.<br /><em>Keep the signal.</em></h1><p>Upload an image, save its analysis, then compare its metrics alongside other records.</p></section>
  <section className="upload-layout">
    <div className="upload-box" onClick={() => fileRef.current.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) pickFile({target:{files:e.dataTransfer.files}}); }}>
      <input ref={fileRef} type="file" accept="image/*" onChange={pickFile} /><div className="upload-symbol">↑</div><h2>{file ? file.name : 'Choose an image'}</h2><p>{file ? `${Math.ceil(file.size / 1024)} KB · ready to analyze` : 'Drop a PNG, JPEG, or WebP here, or browse your device.'}</p>
      {preview && <img src={preview} alt="Selected preview" />}
    </div>
    <div className="analysis-card"><p className="eyebrow">ANALYSIS</p>{report ? <Report report={report} /> : <><h2>Start with one image.</h2><p>Results are saved through the API and available for metric comparison below.</p></>}<button className="primary" disabled={!file || loading} onClick={analyze}>{loading ? 'Working…' : 'Analyze & save'} <span>→</span></button></div>
  </section>
  {message && <p className="message">{message}</p>}
  <section className="workspace-section"><div className="section-line"><div><p className="eyebrow">SAVED RECORDS</p><h2>Gallery <small>{images.length} images</small></h2></div><button className="text-button" onClick={() => { fetch(`${API}/images`).then(r => r.json()).then(setImages).catch(() => {}); }}>Refresh</button></div>
  <p className="selection-note">{selected.length ? `${selected.length} selected — ${selectedNames.map(i => i.filename).join(', ')}` : 'Select two or more records to compare their metrics.'}</p>
  <div className="gallery">{images.map(image => <button key={image.id} className={`image-card ${selected.includes(image.id) ? 'selected' : ''}`} onClick={() => toggle(image.id)}><span className="checkbox">{selected.includes(image.id) ? '✓' : ''}</span><div className="file-mark">{image.filename.slice(0, 1).toUpperCase()}</div><h3 title={image.filename}>{image.filename}</h3><p>#{image.id} · {image.analyzed_at ? new Date(image.analyzed_at).toLocaleDateString() : 'saved record'}</p><div><span>brightness {format(image.mean_brightness)}</span><span>sharpness {format(image.sharpness_score)}</span></div></button>)}{!images.length && <p className="empty">No saved images yet. Analyze one above to begin.</p>}</div>
  <div className="compare-action"><button className="primary" disabled={selected.length < 2 || loading} onClick={runCompare}>Compare selected <span>→</span></button></div>
  {compare.length > 0 && <Compare data={compare} />}</section>
  <section className="workspace-section duplicates"><div className="section-line"><div><p className="eyebrow">INTEGRITY CHECK</p><h2>Exact duplicates</h2></div><span>{duplicates.length} groups</span></div>{duplicates.length ? duplicates.map(group => <div className="duplicate-group" key={group.group_id}><span>SHA-256</span><code>{group.hash}</code><p>{group.images.map(i => i.filename).join(' · ')}</p></div>) : <p className="empty">No exact duplicate groups found.</p>}</section>
</div> }

function Report({ report }) {
  const [height, width] = report.image_stats?.shape || [];
  const channelEntries = Object.entries(report.channel_stats || {});
  const histogramEntries = Object.entries(report.histogram || {});
  return <div className="report">
    <h2 title={report.filename}>{report.filename}</h2>
    <section className="report-section"><h3>Overview</h3><div className="metric-list">
      {[['Dimensions', width && height ? `${width} × ${height}` : '—'], ['Aspect ratio', report.aspect_ratio], ['Megapixels', report.megapixels], ['File size', report.file_size_kb != null ? `${format(report.file_size_kb)} KB` : '—'], ['Format', report.format || '—'], ['Data type', report.image_stats?.dtype || '—'], ['Brightness', report.mean_brightness], ['Contrast', report.contrast_score], ['Sharpness', report.sharpness_score], ['Colorfulness', report.colorfulness_score], ['Entropy', report.entropy_score], ['Saturation', report.saturation_mean], ['Warm/cool', report.warm_cool_bias], ['Exposure', `${format(report.underexposed_pct)}% under · ${format(report.overexposed_pct)}% over`]].map(([name, value]) => <div key={name}><span>{name}</span><strong>{typeof value === 'string' ? value : format(value)}</strong></div>)}
    </div></section>
    <section className="report-section"><h3>Channel breakdown</h3><ChannelChart channels={channelEntries} /><div className="channel-grid">{channelEntries.map(([channel, values]) => <div className={`channel ${channel}`} key={channel}><h4>{channel}</h4><p>Mean <strong>{format(values.mean)}</strong></p><p>Std <strong>{format(values.std)}</strong></p><p>Min / max <strong>{values.minimum} / {values.maximum}</strong></p></div>)}</div></section>
    <section className="report-section"><h3>Histogram</h3><div className="histogram-list">{histogramEntries.map(([channel, values]) => <div className="histogram-row" key={channel}><span>{channel}</span><div className="histogram-bar" aria-label={`${channel} histogram`}><i className="hist-dark" style={{width: `${values.dark_pct}%`}} /><i className="hist-mid" style={{width: `${values.mid_pct}%`}} /><i className="hist-bright" style={{width: `${values.bright_pct}%`}} /></div><small>{format(values.dark_pct)} / {format(values.mid_pct)} / {format(values.bright_pct)}%</small></div>)}</div><p className="histogram-key">Dark / mid / bright</p></section>
    <section className="report-section"><h3>Dominant colors</h3><DominantColorChart colors={report.dominant_colors || []} /><div className="color-list">{report.dominant_colors?.map(color => <div className="color-item" key={`${color.color}-${color.rgb.join('-')}`}><span className="color-swatch" style={{background: `rgb(${color.rgb.join(',')})`}} /><div><strong>{color.color}</strong><small>rgb({color.rgb.join(', ')}) · {format(color.percentage)}%</small></div></div>)}</div></section>
  </div>;
}
function ChannelChart({ channels }) {
  const labels = [['mean', 'Mean'], ['std', 'Std'], ['minimum', 'Min'], ['maximum', 'Max']];
  const max = Math.max(255, ...channels.flatMap(([, value]) => labels.map(([key]) => Number(value[key]) || 0)));
  return <div className="chart-scroll"><div className="channel-chart" role="img" aria-label="Grouped bar chart of red, green, and blue channel statistics"><div className="chart-axis"><span>255</span><span>128</span><span>0</span></div><div className="channel-chart-groups">{channels.map(([channel, values]) => <div className="channel-chart-group" key={channel}>{labels.map(([key, label]) => <div className="channel-bar-wrap" key={key}><i className={`channel-bar ${channel}`} style={{height: `${((Number(values[key]) || 0) / max) * 100}%`}} title={`${channel} ${label}: ${format(values[key])}`} /><span>{label}</span></div>)}<strong>{channel}</strong></div>)}</div></div></div>;
}
function DominantColorChart({ colors }) { return <div className="dominant-chart" aria-label="Dominant colour percentages">{colors.map(color => <div className="dominant-bar" key={`${color.color}-bar`}><span>{color.color}</span><div><i style={{width: `${Math.min(100, Number(color.percentage) || 0)}%`, background: `rgb(${color.rgb.join(',')})`}} /></div><b>{format(color.percentage)}%</b></div>)}</div> }
function CompareChart({ data }) {
  const shades = ['#b84911', '#d66b27', '#e89358', '#f0b186', '#f5cfb2'];
  return <div className="compare-chart-wrap"><div className="compare-legend">{data.map((image, index) => <span key={image.id}><i style={{background: shades[index % shades.length]}} />{image.filename}</span>)}</div><div className="compare-chart">{Object.entries(metricLabels).map(([key, label]) => { const max = Math.max(...data.map(image => Number(image[key]) || 0), 1); return <div className="compare-group" key={key}><div className="compare-bars">{data.map((image, index) => <i key={image.id} style={{height: `${((Number(image[key]) || 0) / max) * 100}%`, background: shades[index % shades.length]}} title={`${image.filename}: ${format(image[key])}`} />)}</div><span>{label}</span></div>; })}</div><p className="chart-caption">Each metric group is scaled to its highest selected value; exact values remain in the table.</p></div>;
}
function Compare({ data }) { return <div className="comparison"><p className="eyebrow">METRIC COMPARISON</p><h2>Side by side</h2><CompareChart data={data} /><div className="table-wrap"><table><thead><tr><th>Metric</th>{data.map(image => <th key={image.id}>{image.filename}</th>)}</tr></thead><tbody>{Object.entries(metricLabels).map(([key, label]) => <tr key={key}><td>{label}</td>{data.map(image => <td key={image.id}>{format(image[key])}</td>)}</tr>)}</tbody></table></div><p className="table-note">This is a numerical comparison, not a visual similarity score.</p></div> }
createRoot(document.getElementById('root')).render(<App />);
