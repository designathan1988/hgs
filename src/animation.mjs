import { PI, m4identity, m4mul, m4rotationX, m4rotationY, m4rotationZ, m4translation, around, mix } from './math.mjs';

export const BONE_COUNT = 20;
const pivot = {
  leftShoulder: [-0.38, 1.49, 0], leftElbow: [-0.49, 1.19, 0], leftWrist: [-0.55, 0.92, 0],
  rightShoulder: [0.38, 1.49, 0], rightElbow: [0.49, 1.19, 0], rightWrist: [0.55, 0.92, 0],
  leftHip: [-0.156, 0.91, 0], leftKnee: [-0.17, 0.52, 0], leftAnkle: [-0.172, 0.13, 0],
  rightHip: [0.156, 0.91, 0], rightKnee: [0.17, 0.52, 0], rightAnkle: [0.172, 0.13, 0],
  head: [0, 1.62, 0],
};

export function poseMatrices(person, time) {
  const b = Array.from({ length: BONE_COUNT }, m4identity);
  const mode = person.animation, speed = person.animationSpeed;
  const t = time * speed;
  const moving = [1, 2, 3, 4].includes(mode);
  const fast = mode === 4 ? 2.0 : mode === 3 ? 1.55 : mode === 2 ? 1.22 : 0.92;
  const phase = t * (moving ? 5.3 * fast : 1);
  const stride = moving ? (mode === 4 ? 0.75 : mode === 3 ? 0.6 : mode === 2 ? 0.48 : 0.37) : 0;
  const breath = Math.sin(t * 1.55) * 0.006;
  const sway = Math.sin(t * 0.66) * 0.014;
  let root = m4mul(m4translation(0, moving ? 0.012 + Math.abs(Math.sin(phase)) * 0.015 : breath, 0), around([0, 0.98, 0], m4rotationZ(moving ? Math.sin(phase) * 0.015 : sway)));
  if (mode === 6) root = m4mul(root, around([0, 0.96, 0], m4rotationY(Math.sin(t * 1.2) * 0.55)));
  if (mode === 7 || mode === 8) {
    const amount = mode === 7 ? 1 : (0.5 - 0.5 * Math.cos(Math.min(t * 2, PI)));
    root = m4mul(m4translation(0, -0.28 * amount, -0.06 * amount), around([0, 0.94, 0], m4rotationX(-0.2 * amount)));
  }
  if (mode === 5) root = m4mul(root, m4translation(0, -0.015 * Math.exp(-t * 1.2), 0));
  b[0] = root;
  const armAngles = [0, 0], elbowAngles = [0.06, 0.06], legAngles = [0, 0], kneeAngles = [0.03, 0.03], footAngles = [0, 0];
  if (moving) for (let i = 0; i < 2; i++) {
    const offset = i ? PI : 0, swing = Math.sin(phase + offset);
    armAngles[i] = -swing * stride * 0.55;
    elbowAngles[i] = 0.12 + Math.max(0, -swing) * stride * 0.38;
    legAngles[i] = swing * stride;
    kneeAngles[i] = 0.04 + Math.max(0, -swing) * stride * 0.85;
    footAngles[i] = -legAngles[i] * 0.55 - kneeAngles[i] * 0.36;
  }
  if (mode === 7 || mode === 8) {
    legAngles[0] = -0.85; legAngles[1] = -0.85;
    kneeAngles[0] = 1.5; kneeAngles[1] = 1.5;
    armAngles[0] = -0.12; armAngles[1] = -0.12;
  }
  if (mode === 11 || mode === 12 || mode === 15) {
    armAngles[1] = -0.35 - Math.sin(t * 3) * 0.28;
    elbowAngles[1] = 0.7;
  }
  if (mode === 13) { armAngles[1] = -1.8; elbowAngles[1] = -0.2 + Math.sin(t * 5) * 0.32; }
  if (mode === 14) { armAngles[1] = -0.6; elbowAngles[1] = 1.35; }
  if (mode === 15) { armAngles[0] = -0.42; elbowAngles[0] = 0.85; }
  if (mode === 16) { armAngles[0] = -0.52; armAngles[1] = -0.52; elbowAngles[0] = 0.66; elbowAngles[1] = 0.66; }
  if (person.pose === 1 && !moving) { armAngles[0] = -0.35; armAngles[1] = -0.35; elbowAngles[0] = 1.14; elbowAngles[1] = 1.14; }
  if (person.pose === 2 && !moving) { armAngles[0] = -0.2; armAngles[1] = -0.2; legAngles[0] = 0.1; legAngles[1] = -0.1; }
  if (person.pose === 3 && !moving) { armAngles[0] = -0.28; armAngles[1] = -0.28; elbowAngles[0] = 0.8; elbowAngles[1] = 0.8; }
  const shoulderKeys = ['leftShoulder', 'rightShoulder'], elbowKeys = ['leftElbow', 'rightElbow'], wristKeys = ['leftWrist', 'rightWrist'];
  const hipKeys = ['leftHip', 'rightHip'], kneeKeys = ['leftKnee', 'rightKnee'], ankleKeys = ['leftAnkle', 'rightAnkle'];
  for (let i = 0; i < 2; i++) {
    const a = i ? 5 : 2, l = i ? 11 : 8;
    b[a] = m4mul(root, around(pivot[shoulderKeys[i]], m4mul(m4rotationX(armAngles[i]), m4rotationZ((i ? -1 : 1) * (moving ? 0.035 : Math.sin(t * 0.45) * 0.016)))));
    b[a + 1] = m4mul(b[a], around(pivot[elbowKeys[i]], m4rotationX(elbowAngles[i])));
    b[a + 2] = m4mul(b[a + 1], around(pivot[wristKeys[i]], m4rotationZ(Math.sin(t * 1.4 + i) * 0.055)));
    b[l] = m4mul(root, around(pivot[hipKeys[i]], m4rotationX(legAngles[i])));
    b[l + 1] = m4mul(b[l], around(pivot[kneeKeys[i]], m4rotationX(kneeAngles[i])));
    b[l + 2] = m4mul(b[l + 1], around(pivot[ankleKeys[i]], m4rotationX(footAngles[i])));
  }
  const headTurn = mode === 9 ? Math.sin(t * 0.7) * 0.35 : Math.sin(t * 0.35) * 0.045;
  const headTilt = Math.sin(t * 0.48) * 0.025 + ([5, 10].includes(person.expression) ? -0.025 : 0);
  b[14] = m4mul(root, around(pivot.head, m4mul(m4rotationY(headTurn), m4rotationZ(headTilt))));
  const gaze = Math.sin(t * 0.56) * 0.08, glance = Math.sin(t * 0.31) * 0.045;
  const blinkPhase = t % 4.7;
  const blink = Math.max(0, 1 - Math.abs(blinkPhase - 0.12) / 0.12);
  for (let i = 0; i < 2; i++) {
    const x = i ? 0.069 : -0.069;
    b[15 + i] = m4mul(b[14], around([x, 1.838, 0.12], m4mul(m4rotationY(gaze), m4rotationX(glance))));
    b[17 + i] = m4mul(b[14], m4translation(0, -blink * 0.014, 0.001 * blink));
  }
  b[19] = m4identity();
  return b;
}
