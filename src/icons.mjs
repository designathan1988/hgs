// Line icons (24×24, stroke = currentColor) drawn for this app.
const paths = {
  person: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 20c.8-4 3.6-6 7-6s6.2 2 7 6"/>',
  body: '<circle cx="12" cy="4.5" r="2"/><path d="M8 8.5h8l-1 6h-6z"/><path d="M9 14.5 8.3 21M15 14.5l.7 6.5M8 8.5 5.5 13M16 8.5l2.5 4.5"/>',
  face: '<path d="M12 3c4 0 6.5 3 6.5 7.5S15.8 21 12 21s-6.5-6-6.5-10.5S8 3 12 3z"/><path d="M9.3 10.5h.01M14.7 10.5h.01M10 16c1.2.8 2.8.8 4 0"/>',
  hair: '<path d="M6 19c-1.5-5-1-9 1-11.5S11 4 13.5 4.5 18.5 7 19 11c.3 3-.5 6-1.5 8"/><path d="M8.5 19c-.5-3.5 0-6.5 2-8.5M12 19c0-3 .6-5.5 2.5-7.5M15.5 19c.3-2.5 0-4.5-1-6"/>',
  shirt: '<path d="m8 4-4.5 3 2 4L8 10v10h8V10l2.5 1 2-4L16 4c-.8 1.5-2.2 2.3-4 2.3S8.8 5.5 8 4z"/>',
  sculpt: '<path d="M14.5 4.5 19.5 9.5 10 19H5v-5z"/><path d="m12.5 6.5 5 5"/>',
  play: '<circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
  export: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M5 17v3h14v-3"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="16.5" cy="9" r="2.5"/><path d="M15.5 14.2c2.3-.3 4.3 1.1 5 4.3"/>',
  camera: '<path d="M4 8h3.5L9 5.5h6L16.5 8H20v11H4z"/><circle cx="12" cy="13" r="3.2"/>',
  sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  crowd: '<circle cx="7" cy="8" r="2"/><circle cx="17" cy="8" r="2"/><circle cx="12" cy="6" r="2"/><path d="M4 17c.4-2.4 1.5-4 3-4s2.6 1.6 3 4M14 17c.4-2.4 1.5-4 3-4s2.6 1.6 3 4M9 14c.5-2.6 1.6-4 3-4s2.5 1.4 3 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  undo: '<path d="M9 7 4.5 11.5 9 16"/><path d="M5 11.5h9.5a5 5 0 0 1 0 10H12"/>',
  redo: '<path d="m15 7 4.5 4.5L15 16"/><path d="M19 11.5H9.5a5 5 0 0 0 0 10H12"/>',
  pause: '<path d="M9 6v12M15 6v12"/>',
  resume: '<path d="m8 5.5 11 6.5-11 6.5z"/>',
  settle: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M5 19h14"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  unlock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.8-1.2"/>',
  move: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  pin: '<path d="M12 21v-6"/><path d="M8 4h8l-1.5 5 3 3h-11l3-3z"/>',
  tie: '<path d="M9 3c0 4 1 6 3 8M15 3c0 4-1 6-3 8"/><ellipse cx="12" cy="12" rx="3.5" ry="1.6"/><path d="M10.5 13.5 9 21M13.5 13.5 15 21M12 13.6V21"/>',
  clip: '<path d="M5 9.5h12.5a2 2 0 0 1 0 4H5"/><path d="M5 9.5c2 .7 3.5-.7 5.5 0s3.5-.7 5.5 0"/>',
  barrette: '<rect x="3.5" y="9" width="17" height="6" rx="3"/><path d="M7 12h10"/>',
  band: '<path d="M4.5 18A7.5 7.5 0 0 1 19.5 18"/><path d="M7.5 18a4.5 4.5 0 0 1 9 0"/>',
  gel: '<path d="M12 3.5c3 4 5 6.8 5 9.5a5 5 0 0 1-10 0c0-2.7 2-5.5 5-9.5z"/><path d="M9.8 13.5a2.3 2.3 0 0 0 2 2.3"/>',
  comb: '<rect x="3.5" y="6" width="17" height="4" rx="1.5"/><path d="M6 10v8M9 10v8M12 10v8M15 10v8M18 10v8"/>',
  smooth: '<path d="M4 9c2.5-3 5.5 3 8 0s5.5-3 8 0"/><path d="M4 16h16"/>',
  inflate: '<circle cx="12" cy="12" r="4.5"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  tipRound: '<path d="M8 4v10a4 4 0 0 0 8 0V4"/>',
  tipPoint: '<path d="M8 4v9l4 7 4-7V4"/>',
  tipFlat: '<path d="M8 4v15h8V4"/>',
  straight: '<path d="M9 4v16M15 4v16"/>',
  wavy: '<path d="M9 4c-3 2.7 3 5.3 0 8s3 5.3 0 8M15 4c-3 2.7 3 5.3 0 8s3 5.3 0 8"/>',
  curly: '<circle cx="12" cy="6" r="2.6"/><circle cx="12" cy="12" r="2.6"/><circle cx="12" cy="18" r="2.6"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/><path d="M12 12h.01"/>',
  strands: '<path d="M7 4c1.2 5-1.2 11 0 16M12 4c1.2 5-1.2 11 0 16M17 4c1.2 5-1.2 11 0 16"/>',
  ribbons: '<path d="M5.5 4c2 5 0 11 2 16h3c-2-5 0-11-2-16zM13.5 4c2 5 0 11 2 16h3c-2-5 0-11-2-16z"/>',
  volume: '<path d="M6 20c-2.2-6 0-14 6-16 6 2 8.2 10 6 16z"/>',
  inward: '<path d="M12 4v10M8.5 10.5 12 14l3.5-3.5"/><path d="M5 19h14"/>',
  outward: '<path d="M12 16V6M8.5 9.5 12 6l3.5 3.5"/><path d="M5 19h14"/>',
  cut: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.5 16 18 4M15.5 16 6 4"/>',
  select: '<path d="M5 4.5 18.5 11 12.5 12.8 9.8 19z"/>',
  pull: '<path d="M7 18c0-5 1-9 5-12"/><path d="M12 6c2.5 0 4.5 1.7 5.5 4"/><circle cx="18" cy="12.5" r="1.8"/><path d="M4 20h7"/>',
  grow: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  trash: '<path d="M5 7h14M10 4h4M7 7l1 13h8l1-13"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  folder: '<path d="M3.5 6.5h6l2 2h9v10h-17z"/>',
  file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
  mirror: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7 4 12l5 5zM15 7l5 5-5 5z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.5h.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  more: '<path d="M6 12h.01M12 12h.01M18 12h.01"/>',
};

/** An inline SVG icon element. */
export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] ?? ''}</svg>`;
  return span;
}

// Hairstyle pictograms for the style gallery: a head with the style's outline.
const hairShapes = {
  longo: '<path d="M14 18c0-7 4.5-11 10-11s10 4 10 11v18c0 3-1 5-2.5 6.5M14 18v18c0 3 1 5 2.5 6.5"/><path d="M24 7v6"/>',
  chanel: '<path d="M13.5 19c0-7.5 4.5-12 10.5-12s10.5 4.5 10.5 12v9c0 1.5-.8 2.6-2 3.2M13.5 19v9c0 1.5.8 2.6 2 3.2"/><path d="M24 7v6"/>',
  franja: '<path d="M13.5 19c0-7.5 4.5-12 10.5-12s10.5 4.5 10.5 12v9c0 1.5-.8 2.6-2 3.2M13.5 19v9c0 1.5.8 2.6 2 3.2"/><path d="M16 17c3-1.2 5.5-1 8 .3 2.5-1.3 5-1.5 8-.3"/>',
  curto: '<path d="M15 19c-.5-6.5 3.5-11 9-11s9.5 4.5 9 11"/><path d="M15 19c2-2.5 5-4 9-4.3 4 .3 7 1.8 9 4.3"/>',
  ondulado: '<path d="M14 18c0-7 4.5-11 10-11s10 4 10 11c1.5 3-1.5 5 0 8s-1.5 5-.5 7.5M14 18c-1.5 3 1.5 5 0 8s1.5 5 .5 7.5"/><path d="M24 7v6"/>',
  cacheado: '<path d="M13 19c-2-3 .5-6 2.5-6.5C16 9 19.5 6.5 23 7.5c3-2 7.5 0 8.5 3.5 3 .5 4.5 4 3 7"/><circle cx="13.5" cy="24" r="2.5"/><circle cx="34.5" cy="24" r="2.5"/><circle cx="14.5" cy="30" r="2.5"/><circle cx="33.5" cy="30" r="2.5"/>',
  careca: '<path d="M15.5 17c1-5.5 4.3-8.5 8.5-8.5s7.5 3 8.5 8.5" stroke-dasharray="2 2.5"/>',
};
export function hairPictogram(id) {
  const span = document.createElement('span');
  span.className = 'pictogram';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 21c0 7 3 12.5 7 12.5s7-5.5 7-12.5" stroke="currentColor" stroke-opacity=".45" stroke-width="1.6"/>
    <path d="M20.5 33.5 20 40M27.5 33.5 28 40" stroke="currentColor" stroke-opacity=".45" stroke-width="1.6"/>
    <g stroke="color-mix(in srgb, var(--hair-tint, currentColor) 45%, #f3e4d4)" stroke-width="2.4">${hairShapes[id] ?? ''}</g></svg>`;
  return span;
}
