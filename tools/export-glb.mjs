// Exports a dressed character with long hair from the command line, checks
// its rig against the project's rules and budget, and runs the Khronos glTF
// Validator on the GLB. Usage: npm run export:glb
// In Node there is no DOM, so the GLB carries no images; colours and textures
// are checked in the browser.
import { mkdir, writeFile } from 'node:fs/promises';
import validator from 'gltf-validator';
import { auditCharacter, createHuman, exportHumanGLB } from '../src/human-three.mjs';
import { studioSpec } from '../src/renderer-three.mjs';
import { defaultCharacter, normalizeCharacter } from '../src/state.mjs';
import { newGarment } from '../src/tailor.mjs';

// GLTFExporter reads the GLB Blob through FileReader, which Node lacks.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend(); }); }
};

// Budget declared in docs/PROJETO.md (high detail).
const budget = { hairVertices: 30000, bones: 113, primitives: 10 };

const person = normalizeCharacter({ ...defaultCharacter, outfit: 4, hairPreset: 'longo', garments: [newGarment('tshirt'), newGarment('hoodie'), newGarment('pants')] });
// Brows and lashes as cards, the app's default for game export (ui.mjs exportOptions).
const human = await createHuman({ ...studioSpec(person), groom: 'cards' });
const audit = auditCharacter(human);
const hair = human.group.getObjectByName('Hair');
const problems = [...audit.problems];
const hairVertices = hair ? hair.geometry.getAttribute('position').count : 0;
if (hairVertices > budget.hairVertices) problems.push(`cabelo com ${hairVertices} vértices (orçamento ${budget.hairVertices})`);
if (audit.bones > budget.bones) problems.push(`${audit.bones} ossos (orçamento ${budget.bones})`);
const hairJoints = human.body.skeleton.bones.filter(bone => bone.name.startsWith('hair_')).length;

const bytes = new Uint8Array(await exportHumanGLB(human, { skeleton: 'unreal', animations: true, blendshapes: true, cosmetic: false, optimize: true }));
human.dispose();
const report = await validator.validateBytes(bytes, { uri: 'personagem.glb', maxIssues: 200 });
const issues = report.issues ?? {};
const primitives = (report.info?.drawCallCount ?? 0);
if (primitives > budget.primitives) problems.push(`${primitives} chamadas de desenho (orçamento ${budget.primitives})`);

await mkdir(new URL('../exports/', import.meta.url), { recursive: true });
await writeFile(new URL('../exports/personagem.glb', import.meta.url), bytes);
await writeFile(new URL('../exports/personagem.report.json', import.meta.url), JSON.stringify({ audit, hairVertices, hairJoints, validator: report }, null, 2));

console.log(`Esqueleto: ${audit.bones} ossos (${hairJoints} de cabelo), ${audit.skeletons} esqueleto(s), desvio de espelhamento ${audit.mirrorError.toFixed(4)}`);
for (const mesh of audit.meshes) console.log(`  ${mesh.name}: ${mesh.vertices} vértices, ${mesh.triangles} triângulos, até ${mesh.maxInfluences} influências, soma ${mesh.minSum.toFixed(6)}–${mesh.maxSum.toFixed(6)}, morphs ${mesh.morphTargets}`);
console.log(`Cabelo: ${hairVertices} vértices`);
console.log(`Validador: ${issues.numErrors ?? '?'} erros, ${issues.numWarnings ?? '?'} avisos, ${issues.numInfos ?? '?'} informações, ${issues.numHints ?? '?'} dicas`);
for (const message of issues.messages ?? []) console.log(`  [${['erro', 'aviso', 'info', 'dica'][message.severity] ?? message.severity}] ${message.code} ${message.pointer ?? ''} ${message.message}`);
for (const problem of problems) console.log(`Problema: ${problem}`);
console.log('Arquivos: exports/personagem.glb e exports/personagem.report.json');
process.exitCode = (issues.numErrors ?? 1) > 0 || problems.length ? 1 : 0;
