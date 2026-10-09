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
  // The pips are filled dots (hairline dots vanished at 16–18 px and the die read as an empty square).
  dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><g fill="currentColor" stroke="none"><circle cx="8.6" cy="8.6" r="1.5"/><circle cx="15.4" cy="8.6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="8.6" cy="15.4" r="1.5"/><circle cx="15.4" cy="15.4" r="1.5"/></g>',
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
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  // Sculpt brushes and the clothes tools.
  grab: '<path d="M8 12.5V6.5a1.5 1.5 0 0 1 3 0v5M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 3.6-2.4 6-5.6 6-2.3 0-3.7-1-4.9-2.8L4.3 13a1.5 1.5 0 0 1 2.5-1.6L8 13"/>',
  flatten: '<path d="M4 15c3-1 5-4 8-4s5 3 8 4"/><path d="M3 19h18M12 4v4M9.5 6 12 8.5 14.5 6"/>',
  pinch: '<path d="M4 17c4 0 6-9 8-9s4 9 8 9"/><path d="M6.5 6 9 8.5M17.5 6 15 8.5"/>',
  orbit: '<ellipse cx="12" cy="12" rx="8.5" ry="4"/><circle cx="12" cy="12" r="2"/><path d="m17.5 5.5 2 2.5-3 .5"/>',
  paintAdd: '<path d="M14.5 4.5 19.5 9.5 11 18H6v-5z"/><path d="M4 21h6M17 15v6M14 18h6"/>',
  paintErase: '<path d="M14.5 4.5 19.5 9.5 11 18H6v-5z"/><path d="M4 21h6M14 18h6"/>',
  sliders: '<path d="M5 7h9M18 7h1M5 17h3M12 17h7"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  // Interface: shortcuts, search, the hair eraser (not a bin: nothing is deleted outside the stroke), posing.
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.3-4.3"/>',
  eraser: '<path d="m7 20-3.3-3.3a1.5 1.5 0 0 1 0-2.1l9.8-9.8a1.5 1.5 0 0 1 2.1 0l4.6 4.6a1.5 1.5 0 0 1 0 2.1L12 20z"/><path d="M20 20H7M9.5 9.5l5 5"/>',
  figure: '<circle cx="12" cy="4.5" r="2"/><path d="m6 9 6 1.5L18 9M12 10.5V15l-3 5.5M12 15l3 5.5"/>',
  // Copy one side of the pose onto the other (Animação › Pose).
  mirrorToRight: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M4 12h5M14.5 12h6M17.5 9l3 3-3 3"/><circle cx="6.5" cy="12" r="2.5"/>',
  mirrorToLeft: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M20 12h-5M9.5 12h-6M6.5 9l-3 3 3 3"/><circle cx="17.5" cy="12" r="2.5"/>',
  key: '<path d="m12 4 7 8-7 8-7-8z"/>',
  // Body types (Corpo › Tipo): one silhouette, wider or more muscular.
  bodyThin: '<circle cx="12" cy="4" r="2"/><path d="M10.6 7.5h2.8l.6 6.5h-4zM10.8 14l-.3 7M13.2 14l.3 7M10.6 8l-1.6 5.5M13.4 8l1.6 5.5"/>',
  bodyAverage: '<circle cx="12" cy="4" r="2"/><path d="M9.8 7.5h4.4l.8 6.5H9zM10.3 14l-.5 7M13.7 14l.5 7M9.8 8 7.8 13.5M14.2 8l2 5.5"/>',
  bodyAthletic: '<circle cx="12" cy="4" r="2"/><path d="M8 7.5h8l-1.6 6.5H9.6zM10.4 14l-.7 7M13.6 14l.7 7M8 8l-2 5.5M16 8l2 5.5"/>',
  bodyStrong: '<circle cx="12" cy="4" r="2"/><path d="M7.5 7.5h9l-.8 6.5H8.3zM9.6 14l-.8 7M14.4 14l.8 7M7.5 8 5.2 13.5M16.5 8l2.3 5.5"/>',
  bodyHeavy: '<circle cx="12" cy="4" r="2"/><path d="M9 7.5h6c1.8 1.6 2.4 4.2 1.4 6.5H7.6C6.6 11.7 7.2 9.1 9 7.5zM9.8 14l-.6 7M14.2 14l.6 7M8.6 8.3 6.4 13.5M15.4 8.3l2.2 5.2"/>',
  // Ages (Pessoa › Idade): a figure from small to stooped.
  ageChild: '<circle cx="12" cy="10" r="2"/><path d="M10.5 13h3l.4 4h-3.8zM11 17l-.3 4M13 17l.3 4M10.6 13.5 9.4 16.5M13.4 13.5l1.2 3"/>',
  ageTeen: '<circle cx="12" cy="6" r="2"/><path d="M10.4 9h3.2l.5 5.5h-4.2zM10.8 14.5l-.4 6.5M13.2 14.5l.4 6.5M10.4 9.5 9 14M13.6 9.5l1.4 4.5"/>',
  ageAdult: '<circle cx="12" cy="4" r="2"/><path d="M10 7.5h4l.7 6.5H9.3zM10.6 14l-.5 7M13.4 14l.5 7M10 8 8.3 13.5M14 8l1.7 5.5"/>',
  ageElder: '<circle cx="11" cy="5" r="2"/><path d="M9.6 8.5h3.6l1.2 6H9.2zM10 14.5 9.5 21M13.4 14.5l.9 6.5M13.6 9.5l2.4 4M17.5 13v8"/>',
  // Expressions (Rosto › Expressão), in the order of expressionNames: a face with brows, eyes and mouth.
  exNeutral: '<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M9 15.5h6"/>',
  exRelaxed: '<circle cx="12" cy="12" r="9"/><path d="M7.5 10.2c.7-.5 1.6-.5 2.2 0M14.3 10.2c.7-.5 1.6-.5 2.2 0M9 15c1.8 1 4.2 1 6 0"/>',
  exHappy: '<circle cx="12" cy="12" r="9"/><path d="M8.5 9.5h.01M15.5 9.5h.01M8 14c2.2 2.6 5.8 2.6 8 0"/>',
  exSmile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 9.5h.01M15.5 9.5h.01M7.5 13.5h9c-.6 3-2.4 4.3-4.5 4.3S8.1 16.5 7.5 13.5z"/>',
  exLaugh: '<circle cx="12" cy="12" r="9"/><path d="m7.5 10 1.5-1.3 1.5 1.3M13.5 10 15 8.7l1.5 1.3M7.5 13h9c-.4 3.6-2.3 5-4.5 5s-4.1-1.4-4.5-5z"/>',
  exSad: '<circle cx="12" cy="12" r="9"/><path d="M8.5 10h.01M15.5 10h.01M8.5 16.5c2-2 5-2 7 0M7.5 8l2 -1M16.5 8l-2-1"/>',
  exAngry: '<circle cx="12" cy="12" r="9"/><path d="m7.5 8 2.5 1.5M16.5 8 14 9.5M8.8 11h.01M15.2 11h.01M8.5 16.5c2-1.8 5-1.8 7 0"/>',
  exAnnoyed: '<circle cx="12" cy="12" r="9"/><path d="m7.5 8.5 2.5 1M16.5 8.5l-2.5 1M8.8 11h.01M15.2 11h.01M9 15.8h6"/>',
  exSurprised: '<circle cx="12" cy="12" r="9"/><path d="M7.5 7c.8-.6 1.8-.6 2.6 0M13.9 7c.8-.6 1.8-.6 2.6 0M8.8 10h.01M15.2 10h.01"/><ellipse cx="12" cy="15.5" rx="1.8" ry="2.2"/>',
  exWorried: '<circle cx="12" cy="12" r="9"/><path d="m7.5 9 2.5-1.4M16.5 9 14 7.6M8.8 11h.01M15.2 11h.01M8.5 16c1.2-1 2.3 0 3.5-.5s2.3-1 3.5.3"/>',
  exTired: '<circle cx="12" cy="12" r="9"/><path d="M7.5 10.5h2.8M13.7 10.5h2.8M9.5 15.5h5"/>',
  exTalking: '<circle cx="12" cy="12" r="9"/><path d="M8.5 9.5h.01M15.5 9.5h.01"/><path d="M9.5 14.5h5c0 1.8-1.1 2.8-2.5 2.8s-2.5-1-2.5-2.8z"/>',
  // Eyebrow shapes (Rosto › Sobrancelhas): the brow line over an eye.
  browNatural: '<path d="M3.5 12c3-3.5 9-4.5 17-1.5" stroke-width="2.6"/><path d="M8 17.5c2-1.3 6-1.3 8 0"/>',
  browStraight: '<path d="M3.5 10.5h17" stroke-width="2.6"/><path d="M8 17.5c2-1.3 6-1.3 8 0"/>',
  browArched: '<path d="M3.5 13C7 5.5 15 5 20.5 11" stroke-width="2.6"/><path d="M8 17.5c2-1.3 6-1.3 8 0"/>',
  browAngled: '<path d="M3.5 12.5 14 7.5l6.5 4" stroke-width="2.6"/><path d="M8 17.5c2-1.3 6-1.3 8 0"/>',
  // Movements (Animação): one stick figure (head r 2, the same trunk), posed per movement.
  stand: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M12 14l-2.5 6.5M12 14l2.5 6.5M12 8.5 8.5 12.5M12 8.5l3.5 4"/>',
  breathe: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M12 14l-2.5 6.5M12 14l2.5 6.5M12 8.5 9 12.5M12 8.5l3 4"/><path d="M5 8.5c-1.3 2-1.3 4 0 6M19 8.5c1.3 2 1.3 4 0 6"/>',
  look: '<circle cx="10" cy="4.5" r="2"/><path d="M10 7v7M10 14l-2.5 6.5M10 14l2.5 6.5M10 8.5 7 12.5M10 8.5l3 4"/><path d="M14.5 4.5h6M18.5 2.5l2 2-2 2"/>',
  phone: '<circle cx="9" cy="4.5" r="2"/><path d="M9 7v7M9 14l-2.5 6.5M9 14l2.5 6.5M9 8.5 6 12.5M9 8.5l4.5 2"/><rect x="15" y="7" width="4" height="6" rx="1"/>',
  carry: '<circle cx="9" cy="4.5" r="2"/><path d="M9 7v7M9 14l-2.5 6.5M9 14l2.5 6.5M9 8.5 6 12.5M9 8.5l4.5 3.5"/><path d="M13 12.5h6l-.8 6h-4.4z"/>',
  walk: '<circle cx="12.5" cy="4.5" r="2"/><path d="M12 7.5 11 14M11 14l-3 6.5M11 14l3 2.5-.5 4M12 9 9 12.5M12 9l3 3"/>',
  run: '<circle cx="15" cy="4.5" r="2"/><path d="M14 7.5 11 13.5M11 13.5l-4.5 1.5M11 13.5l3.5 2.5-1.5 4.5M13.5 9H9M13.5 9l3.5 3"/>',
  stop: '<circle cx="10" cy="4.5" r="2"/><path d="M10 7v7M10 14l-2 6.5M10 14l2 6.5M10 8.5 7 12.5M10 8.5l3 4"/><path d="M18 4v16"/>',
  turn: '<circle cx="12" cy="4" r="2"/><path d="M12 6.5v6M12 12.5l-2 5M12 12.5l2 5M12 8 9.5 11M12 8l2.5 3"/><path d="M4 17.5c1 2 4.5 3 8 3s7-1 8-3"/><path d="m17.5 18.5 2.5-1 .5 2.5"/>',
  catwalk: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M12 14l1.5 6.5M12 14l-1.5 6.5M12 8.5 9 12.5M12 8.5l3 2-1.5 2.5"/>',
  dance: '<circle cx="11" cy="4.5" r="2"/><path d="M11 7v7M11 14l-3.5 6M11 14l4 4.5M11 9 6.5 6M11 9l5 3"/><path d="M19 3v4"/><circle cx="18" cy="8" r="1"/>',
  samba: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6M8.5 13h7l-1 2.5h-5zM10.5 15.5l-2 5M13.5 15.5l2.5 5M12 9 7.5 5.5M12 9l4.5-3.5"/>',
  cheer: '<circle cx="12" cy="6.5" r="2"/><path d="M12 9v6M12 15l-2.5 5.5M12 15l2.5 5.5M12 10.5 8 4M12 10.5 16 4"/>',
  clap: '<circle cx="10" cy="4.5" r="2"/><path d="M10 7v7M10 14l-2.5 6.5M10 14l2.5 6.5M10 8.5l3.5 3M10 8.5l2.5 4"/><path d="M16.5 9l2-1.5M17 12h2.5M16.5 15l2 1.5"/>',
  talk: '<path d="M4.5 5.5h15v9.5h-8l-4 3.5V15h-3z"/><path d="M8.5 9h7M8.5 11.5h4.5"/>',
  gesture: '<circle cx="8" cy="4.5" r="2"/><path d="M8 7v7M8 14l-2.5 6.5M8 14l2.5 6.5M8 8.5 5.5 12.5M8 8.5l5.5 2"/><path d="M16 8l3-1.5M16.5 11h3M16 14l3 1.5"/>',
  wave: '<circle cx="10" cy="5" r="2"/><path d="M10 7.5v7M10 14.5l-2.5 6M10 14.5l2.5 6M10 9 7 13M10 9l4-1.5 1-4.5"/><path d="M18 4c.8.8.8 2.2 0 3M20 2.5c1.5 1.5 1.5 4.5 0 6"/>',
  shrug: '<circle cx="12" cy="5" r="2"/><path d="M12 7.5v7M12 14.5l-2.5 6M12 14.5l2.5 6M12 9.5H8.5L6.5 7M12 9.5h3.5l2-2.5"/>',
  knock: '<rect x="13" y="3" width="8" height="18" rx="1"/><path d="M18.5 12h.01"/><circle cx="6" cy="5" r="2"/><path d="M6 7.5v6M6 13.5l-1.5 7M6 13.5l1.5 7M6 9l4.5 1.5"/>',
  sit: '<circle cx="9" cy="4" r="2"/><path d="M9 6.5v7h6v7M9 8.5l3.5 3"/><path d="M5 12v8.5M5 16h3"/>',
  sitIdle: '<circle cx="9" cy="5" r="2"/><path d="M9 7.5v6h6v7M9 9.5l3.5 3"/><path d="M5 13v7.5M5 17h3"/><path d="M15.5 3h4l-4 4h4"/>',
  standUp: '<circle cx="10" cy="4.5" r="2"/><path d="M10 7v7M10 14l-2.5 6.5M10 14l2.5 6.5M10 8.5 7 12.5M10 8.5l3 4"/><path d="M18.5 15V4.5M16 7l2.5-2.5L21 7"/>',
  crouch: '<circle cx="11" cy="7.5" r="2"/><path d="M11 10 12 15.5M12 15.5l-4 1 1 4M12 15.5l3 1.5-1 3.5M11.5 12 15.5 14"/>',
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
