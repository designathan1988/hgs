/**
 * Pictograms of garments and costume pieces (48 × 48 line drawings in the style of the hair
 * pictograms, icons.mjs) and small fabric swatches for the clothes gallery. Drawn with the current
 * text colour; a garment's own colour tints the fill.
 */
const body = '<path d="M24 6.5a3.4 3.4 0 1 1 0 6.8 3.4 3.4 0 0 1 0-6.8ZM18 15.5h12l3 13-2.5 1-1.5-6v20h-3.5l-1.5-12-1.5 12H19v-20l-1.5 6-2.5-1Z" stroke="currentColor" stroke-opacity=".3" stroke-width="1.2"/>';
const shapes = {
  tshirt: '<path d="M17 9l-8 5 3 6 4-2v21h16V18l4 2 3-6-8-5c-1 3-3.5 4.5-7 4.5S18 12 17 9Z"/>',
  longsleeve: '<path d="M17 9l-6 4-5 21 4 1 5-15v19h18V20l5 15 4-1-5-21-6-4c-1 3-3.5 4.5-7 4.5S18 12 17 9Z"/>',
  tank: '<path d="M18 8c0 5 2 8 6 8s6-3 6-8l3 1c-1 5-1 8 1 11v19H14V20c2-3 2-6 1-11Z"/>',
  hoodie: '<path d="M18 9c0-3 3-5 6-5s6 2 6 5l7 4-4 22-3-1 1-14v19H17V20l1 14-3 1-4-22Z M19 13c1 3 3 4 5 4s4-1 5-4 M18 31h12"/>',
  pants: '<path d="M14 7h20l2 34h-7l-5-24-5 24h-7Z M14 11h20"/>',
  shorts: '<path d="M14 9h20l3 20h-9l-4-10-4 10h-9Z M14 13h20"/>',
  skirt: '<path d="M17 9h14l7 28H10Z M17 13h14"/>',
  dress: '<path d="M19 6c0 4 2 6 5 6s5-2 5-6l2 1c0 5-1 9-2 12l8 22H11l8-22c-1-3-2-7-2-12Z"/>',
  socks: '<path d="M18 6h8v22l9 6-2 6-14-6c-2-1-1-3-1-5Z"/>',
  gloves: '<path d="M16 42V25l-4-7 3-1 4 5V9h3v12V7h3v14V8h3v13 -9h3v20c0 5-2 10-6 10Z"/>',
  paint: '<path d="M10 38c6-1 9-7 14-12l8-8 3 3-8 8c-5 5-8 9-17 9Z M30 14l4-4 4 4-4 4" /><path d="M12 12c4 2 6 6 4 10" stroke-dasharray="2 3"/>',
  bikini_top: `${body}<path d="M18.5 20c1 3 4 3.5 5.5 1 1.5 2.5 4.5 2 5.5-1M18 22.5h12M19.5 20l2.5-5M28.5 20l-2.5-5" stroke-width="2.2"/>`,
  bikini_bottom: `${body}<path d="M19 27h10l-3 6h-4Z" stroke-width="2.2"/>`,
  swimsuit: `${body}<path d="M19.5 16l1 4c-1 3-1 6-1 7l3 5h3l3-5c0-1 0-4-1-7l1-4" stroke-width="2.2"/>`,
  armband: `${body}<path d="M14.5 21.5l4-1M29.5 20.5l4 1" stroke-width="3"/>`,
  anklet: `${body}<path d="M19 41.5h4M25 41.5h4" stroke-width="3"/>`,
  fringe: `${body}<path d="M18.5 27h11M19 27.5l-1 9M21 27.5l-.5 9M23 27.5v9M25 27.5v9M27 27.5l.5 9M29 27.5l1 9" stroke-width="1.6"/>`,
  backpiece: '<path d="M24 30 8 10M24 30 12 6M24 30 18 4M24 30V3M24 30 30 4M24 30 36 6M24 30 40 10M24 30 5 17M24 30 43 17" stroke-width="2.2"/><circle cx="24" cy="31" r="3.5"/>',
  headdress: '<path d="M16 30a8 8 0 0 0 16 0" stroke-opacity=".45"/><path d="M15 28h18l-1-3H16Z M18 25 12 9M21 25 18 5M24 25V3M27 25 30 5M30 25 36 9" stroke-width="2"/>',
  crown: '<path d="M11 34h26l2-18-7 7-8-11-8 11-7-7Z M11 38h26" stroke-width="2.2"/>',
};

/** A garment's pictogram (span.pictogram, as the hair styles). */
export function garmentPictogram(type, tint = null) {
  const span = document.createElement('span');
  span.className = 'pictogram';
  span.setAttribute('aria-hidden', 'true');
  const fill = tint ? `color-mix(in srgb, ${tint} 55%, transparent)` : 'none';
  span.innerHTML = `<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><g stroke="currentColor" stroke-width="1.8" fill="${fill}">${shapes[type] ?? shapes.tshirt}</g></svg>`;
  return span;
}

/** A small picture of a fabric: its weave, sequins, stones or net in the garment's colour. */
export function fabricPictogram(fabric, color = '#8a8f99') {
  const span = document.createElement('span');
  span.className = 'pictogram';
  span.setAttribute('aria-hidden', 'true');
  const c = color, light = `color-mix(in srgb, ${c} 55%, white)`, dark = `color-mix(in srgb, ${c} 60%, black)`;
  const motifs = {
    cotton: `<rect x="6" y="6" width="36" height="36" rx="6" fill="${c}"/>${[12, 20, 28, 36].map(y => `<path d="M8 ${y}h32" stroke="${light}" stroke-opacity=".35"/>`).join('')}`,
    denim: `<rect x="6" y="6" width="36" height="36" rx="6" fill="${c}"/>${[0, 8, 16, 24, 32, 40].map(o => `<path d="M${6 + o - 12} 42 ${18 + o} 6" stroke="${light}" stroke-opacity=".45" stroke-width="2"/>`).join('')}`,
    knit: `<rect x="6" y="6" width="36" height="36" rx="6" fill="${c}"/>${[10, 18, 26, 34].map(x => [10, 17, 24, 31, 38].map(y => `<path d="M${x} ${y}l3 4 3-4" stroke="${light}" stroke-opacity=".5" fill="none"/>`).join('')).join('')}`,
    silk: `<defs><linearGradient id="s-${c.slice(1)}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${dark}"/><stop offset=".45" stop-color="${light}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect x="6" y="6" width="36" height="36" rx="6" fill="url(#s-${c.slice(1)})"/>`,
    satin: `<defs><linearGradient id="t-${c.slice(1)}" x1="0" x2="1"><stop offset="0" stop-color="${c}"/><stop offset=".5" stop-color="white" stop-opacity=".9"/><stop offset="1" stop-color="${c}"/></linearGradient></defs><rect x="6" y="6" width="36" height="36" rx="6" fill="url(#t-${c.slice(1)})"/>`,
    leather: `<rect x="6" y="6" width="36" height="36" rx="6" fill="${dark}"/><path d="M12 30c6-3 12 3 24-2" stroke="${light}" stroke-opacity=".35"/>`,
    sequin: `<rect x="6" y="6" width="36" height="36" rx="6" fill="${dark}"/>${[11, 19, 27, 35].map((y, j) => [11, 19, 27, 35].map(x => `<circle cx="${x + (j % 2) * 4}" cy="${y}" r="4.2" fill="${(x + y) % 3 ? c : light}" stroke="${dark}" stroke-width=".6"/>`).join('')).join('')}`,
    rhinestone: `<rect x="6" y="6" width="36" height="36" rx="6" fill="${c}"/>${[12, 24, 36].map((y, j) => [12, 24, 36].map(x => `<circle cx="${x + (j % 2) * 6 - 3}" cy="${y}" r="3.2" fill="white" stroke="${light}"/>`).join('')).join('')}`,
    lame: `<defs><linearGradient id="l-${c.slice(1)}" x1="0" x2="1" y1="1" y2="0"><stop offset="0" stop-color="${dark}"/><stop offset=".5" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs><rect x="6" y="6" width="36" height="36" rx="6" fill="url(#l-${c.slice(1)})"/>`,
    tulle: `${[0, 1, 2, 3, 4].map(i => `<path d="M${6 + i * 9} 6 L${6 + i * 9 - 18} 42 M${6 + i * 9} 6 L${6 + i * 9 + 18} 42" stroke="${c}" stroke-width="1.4"/>`).join('')}<rect x="6" y="6" width="36" height="36" rx="6" stroke="${c}" stroke-opacity=".5"/>`,
  };
  span.innerHTML = `<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><clipPath id="clip"><rect x="6" y="6" width="36" height="36" rx="6"/></clipPath><g clip-path="url(#clip)">${motifs[fabric] ?? motifs.cotton}</g></svg>`;
  return span;
}
