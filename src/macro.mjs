// Adapted from Roadcraft browser-side morphing code.
/**
 * MakeHuman's macro sliders, as weights on its macro targets.
 *
 * Everything here is read from the data (`modifiers.json`, which is MPFB2's
 * `macrodetails/macro.json`): each slider is a run of parts, each part a
 * stretch of the slider between two named states - age goes baby, child,
 * young, old - and a target is named by one state of every factor it
 * combines (`universal-female-young-averagemuscle-averageweight`,
 * `african-male-old`, `height/female-child-...-maxheight`). A target's weight
 * is the product of its states' weights; a state's weight is how far the
 * slider sits towards it inside its part.
 *
 * Written from the file format alone: no MakeHuman or MPFB code is used.
 */
export const DEFAULT_MACRO = {
    gender: 0.5, age: 0.5, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5,
    african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3, cupsize: 0.5, firmness: 0.5,
};
const RACES = ['african', 'asian', 'caucasian'];
/**
 * Weight of every state of one slider at `value`: the part holding the value
 * splits a weight of one between its two ends. An empty end (the neutral of
 * height and proportions) takes its share with it: at the neutral the slider
 * moves nothing.
 */
export function stateWeights(parts, value) {
    const out = new Map();
    const x = Math.min(1, Math.max(0, value));
    const part = parts.find((p) => x >= p.lowest && x <= p.highest)
        // The data leaves hairline gaps between parts (0.49998..0.49999): the
        // nearest part owns them.
        ?? parts.reduce((best, p) => (Math.abs(x - (p.lowest + p.highest) / 2) < Math.abs(x - (best.lowest + best.highest) / 2) ? p : best));
    const lo = Math.max(0, part.lowest);
    const hi = Math.min(1, part.highest);
    const t = hi > lo ? Math.min(1, Math.max(0, (x - lo) / (hi - lo))) : 0;
    if (part.low)
        out.set(part.low, (out.get(part.low) ?? 0) + (1 - t));
    if (part.high)
        out.set(part.high, (out.get(part.high) ?? 0) + t);
    return out;
}
/**
 * Slider value of an age in years. MakeHuman's states sit at 1, 11, 25 and 90
 * years and its slider is linear between them; but people grow up by about
 * eighteen, and linear from 11 to 25 drew an eighteen-year-old with a
 * thirteen-year-old's build. A knot at 18 puts most of the growing before it.
 */
const AGE_KNOTS = [[1, 0], [11, 0.1875], [18, 0.44], [25, 0.5], [90, 1]];
export function ageFromYears(years) {
    const y = Math.min(90, Math.max(1, years));
    for (let i = 1; i < AGE_KNOTS.length; i++) {
        const [y0, a0] = AGE_KNOTS[i - 1], [y1, a1] = AGE_KNOTS[i];
        if (y <= y1)
            return a0 + ((y - y0) / (y1 - y0)) * (a1 - a0);
    }
    return 1;
}
export function yearsFromAge(age) {
    const a = Math.min(1, Math.max(0, age));
    for (let i = 1; i < AGE_KNOTS.length; i++) {
        const [y0, a0] = AGE_KNOTS[i - 1], [y1, a1] = AGE_KNOTS[i];
        if (a <= a1)
            return y0 + ((a - a0) / (a1 - a0)) * (y1 - y0);
    }
    return 90;
}
/**
 * The weight of every macro target in `names` (as the packs name them, with
 * or without a `macrodetails/` or `breast/` folder) for `params`. Targets the
 * parameters give no weight are left out.
 */
export function macroTargetWeights(def, names, params) {
    const factor = new Map();
    for (const [name, slider] of Object.entries(def.macrotargets)) {
        const value = params[name];
        if (value !== undefined)
            factor.set(name, stateWeights(slider.parts, value));
    }
    const raceTotal = RACES.reduce((s, r) => s + Math.max(0, params[r]), 0);
    factor.set('race', new Map(RACES.map((r) => [r, raceTotal > 0 ? Math.max(0, params[r]) / raceTotal : 1 / 3])));
    // Which slider each state belongs to, so a name can be read part by part.
    const owner = new Map();
    for (const [slider, states] of factor)
        for (const state of states.keys())
            owner.set(state, slider);
    for (const [, slider] of Object.entries(def.macrotargets)) {
        for (const part of slider.parts) {
            for (const state of [part.low, part.high]) {
                if (state && !owner.has(state))
                    owner.set(state, Object.entries(def.macrotargets).find(([, s]) => s === slider)[0]);
            }
        }
    }
    for (const r of RACES)
        owner.set(r, 'race');
    const combos = Object.values(def.combinations).map((c) => [...c].sort().join('|'));
    const out = new Map();
    for (const full of names) {
        const leaf = full.slice(full.lastIndexOf('/') + 1).replace(/^universal-/, '');
        const states = leaf.split('-');
        const sliders = states.map((s) => owner.get(s));
        // Not a macro target (a regional one such as `breast-dist-incr`).
        if (sliders.some((s) => s === undefined))
            continue;
        if (!combos.includes([...sliders].sort().join('|')))
            continue;
        let w = 1;
        for (let i = 0; i < states.length && w > 0; i++)
            w *= factor.get(sliders[i])?.get(states[i]) ?? 0;
        if (w > 1e-9)
            out.set(full, w);
    }
    return out;
}
