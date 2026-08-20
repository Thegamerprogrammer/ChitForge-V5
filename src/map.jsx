import { useCallback, useMemo, useRef, useState } from 'react';
import { geoCentroid, geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-50m.json';
import countryList from 'world-countries';
import { countryMatchesPortfolio, toggleTargetSelection } from './mapInteractions.js';

const numericToCountry = new Map(countryList.filter((c) => c.ccn3).map((c) => [c.ccn3, { iso: c.cca3, name: c.name.common }]));
export const countryAliases = new Map([
  ['United States of America', { iso: 'USA', name: 'United States' }],
  ['Dem. Rep. Congo', { iso: 'COD', name: 'Democratic Republic of the Congo' }],
  ['Congo', { iso: 'COG', name: 'Republic of the Congo' }],
  ['Russia', { iso: 'RUS', name: 'Russia' }],
  ['South Korea', { iso: 'KOR', name: 'Republic of Korea' }],
  ['North Korea', { iso: 'PRK', name: 'North Korea' }],
  ['Iran', { iso: 'IRN', name: 'Iran' }],
  ['Syria', { iso: 'SYR', name: 'Syria' }],
  ['Laos', { iso: 'LAO', name: 'Laos' }],
  ['Vietnam', { iso: 'VNM', name: 'Vietnam' }],
  ['Venezuela', { iso: 'VEN', name: 'Venezuela' }],
  ['Bolivia', { iso: 'BOL', name: 'Bolivia' }],
  ['Tanzania', { iso: 'TZA', name: 'Tanzania' }],
  ['USA', { iso: 'USA', name: 'United States' }],
  ['US', { iso: 'USA', name: 'United States' }],
  ['UK', { iso: 'GBR', name: 'United Kingdom' }],
  ['UAE', { iso: 'ARE', name: 'United Arab Emirates' }],
  ['SG', { iso: 'SGP', name: 'Singapore' }],
  ['SGP', { iso: 'SGP', name: 'Singapore' }],
]);

export const countryDatabase = countryList.map((c) => ({ iso: c.cca3, iso2: c.cca2, name: c.name.common, official: c.name.official, aliases: [c.name.common, c.name.official, ...(Object.values(c.translations || {}).map((t) => t.common).filter(Boolean))] })).filter((c) => c.iso);

function key(value = '') { return String(value).trim().toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

export function resolveCountries(input) {
  const tokens = String(input || '').split(/[;,\n]+/).map((x) => x.trim()).filter(Boolean);
  const resolved = []; const unresolved = [];
  const add = (country) => { if (country && !resolved.some((c) => c.iso === country.iso)) resolved.push({ iso: country.iso, name: country.name }); };
  for (const token of tokens) {
    const alias = countryAliases.get(token) || countryAliases.get(token.toUpperCase());
    if (alias) { add(alias); continue; }
    const k = key(token);
    const found = countryDatabase.find((c) => [c.iso, c.iso2].some((code) => code?.toLowerCase() === token.toLowerCase()) || c.aliases.some((a) => key(a) === k));
    if (found) add(found); else unresolved.push(token);
  }
  return { resolved, unresolved };
}

function normalizeCountry(geo) {
  const byId = numericToCountry.get(String(geo.id).padStart(3, '0'));
  const byName = countryAliases.get(geo.properties.name);
  return byId || byName || { iso: String(geo.id), name: geo.properties.name };
}

export function WorldMap({ selected, setSelected, portfolio, setPortfolio }) {
  const [tooltip, setTooltip] = useState(null);
  const tooltipFrame = useRef(0);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const mapGroupRef = useRef(null);
  const dragRef = useRef({ active: false, pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0, moved: false });
  const countries = useMemo(() => {
    const fc = feature(world, world.objects.countries);
    const projection = geoNaturalEarth1().fitSize([980, 520], fc);
    const path = geoPath(projection);
    return fc.features.map((geo) => { const [cx, cy] = projection(geoCentroid(geo)) || []; const normalized = normalizeCountry(geo); return { ...normalized, d: path(geo), cx, cy, smallHit: ['SGP','MCO','LIE','LUX','MLT','MDV','BRN','VAT','SMR','AND','KWT','QAT','BHR'].includes(normalized.iso) }; }).filter((c) => c.d && c.iso !== '010');
  }, []);
  const selectedIso = new Set(selected.map((c) => c.iso));
  const applyTransform = useCallback((nextView) => {
    mapGroupRef.current?.setAttribute('transform', `translate(${nextView.x} ${nextView.y}) scale(${nextView.scale})`);
  }, []);
  const choosePortfolio = (country) => {
    if (dragRef.current.moved) return;
    setPortfolio?.(country);
  };
  const handleContextMenu = (event, country) => {
    event.preventDefault();
    if (dragRef.current.moved) return;
    setSelected((current) => toggleTargetSelection(current, country, portfolio));
  };
  const moveTooltip = useCallback((event, country) => {
    const { offsetX, offsetY } = event.nativeEvent;
    cancelAnimationFrame(tooltipFrame.current);
    tooltipFrame.current = requestAnimationFrame(() => setTooltip({ x: offsetX + 14, y: offsetY + 14, name: country.name, iso: country.iso }));
  }, []);
  const hideTooltip = useCallback(() => {
    cancelAnimationFrame(tooltipFrame.current);
    setTooltip(null);
  }, []);

  const beginPan = useCallback((event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest?.('.mapTools')) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = { active: true, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: view.x, originY: view.y, moved: false };
  }, [view.x, view.y]);

  const movePan = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    event.preventDefault();
    applyTransform({ scale: view.scale, x: drag.originX + dx, y: drag.originY + dy });
  }, [applyTransform, view.scale]);

  const endPan = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const nextView = { scale: view.scale, x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY };
    setView(nextView);
    applyTransform(nextView);
    window.setTimeout(() => { dragRef.current.moved = false; }, 0);
    dragRef.current = { ...dragRef.current, active: false, pointerId: null };
  }, [applyTransform, view.scale]);

  return <div className="mapWrap">
    <div className="mapTools"><button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(3, v.scale + 0.25) }))}>Zoom +</button><button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(1, v.scale - 0.25) }))}>Zoom −</button><button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })}>Reset</button><button type="button" onClick={() => setSelected([])}>Clear all</button></div>
    <svg className="pannableMap" viewBox="0 0 980 520" role="img" aria-label="Interactive real world map from Natural Earth geometry via world-atlas" onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
      <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <rect className="ocean" width="980" height="520" />
      <g ref={mapGroupRef} transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
      {countries.map((country) => {
        const isPortfolio = countryMatchesPortfolio(country, portfolio);
        const isSelected = selectedIso.has(country.iso);
        return <path key={`${country.iso}-${country.name}`} tabIndex="0" d={country.d} data-iso={country.iso} className={`country ${isSelected ? 'selected' : ''} ${isPortfolio ? 'portfolio' : ''} ${isPortfolio && isSelected ? 'selfTarget' : ''}`} onClick={() => choosePortfolio(country)} onContextMenu={(e) => handleContextMenu(e, country)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') choosePortfolio(country); }} onMouseMove={(e) => moveTooltip(e, country)} onMouseLeave={hideTooltip}><title>{country.name} · {country.iso}</title></path>;
      })}
      {countries.filter((country) => country.smallHit && Number.isFinite(country.cx) && Number.isFinite(country.cy)).map((country) => <circle key={`hit-${country.iso}`} className="countryHitArea" cx={country.cx} cy={country.cy} r="8" tabIndex="0" aria-label={`${country.name} ${country.iso}`} onClick={() => choosePortfolio(country)} onContextMenu={(e) => handleContextMenu(e, country)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') choosePortfolio(country); }} onMouseMove={(e) => moveTooltip(e, country)} onMouseLeave={hideTooltip}><title>{country.name} · {country.iso}</title></circle>)}
      </g>
    </svg>
    {tooltip && <div className="tooltip show" style={{ left: tooltip.x, top: tooltip.y }}><b>{tooltip.name}</b><br />ISO {tooltip.iso}</div>}
    <p className="attribution">Map geometry: Natural Earth via world-atlas/topojson, rendered as SVG.</p>
  </div>;
}
