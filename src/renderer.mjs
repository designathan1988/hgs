import { MeshBuilder } from './geometry.mjs';
import { buildHuman } from './human.mjs';
import { poseMatrices } from './animation.mjs';
import { perspective, lookAt, m4mul, clamp, norm } from './math.mjs';
import { Crowd } from './crowd.mjs';

const lighting = [
  { direction: [-0.25, 0.9, 0.55], color: [1, 0.96, 0.9], power: 1.1, background: [0.165, 0.176, 0.187] },
  { direction: [-0.5, 0.9, 0.65], color: [1, 0.97, 0.9], power: 1.17, background: [0.24, 0.25, 0.25] },
  { direction: [-0.45, 0.84, 0.58], color: [1, 0.95, 0.88], power: 1.24, background: [0.16, 0.17, 0.18] },
  { direction: [0.86, 0.75, 0.1], color: [1, 0.84, 0.72], power: 1.52, background: [0.09, 0.104, 0.123] },
  { direction: [-0.3, 0.95, 0.7], color: [0.93, 0.97, 1], power: 1.27, background: [0.24, 0.29, 0.31] },
];

export class Camera {
  constructor() { this.yaw = 0.04; this.pitch = 0.025; this.distance = 3.35; this.target = [0, 1.03, 0]; this.fov = 0.64; }
  eye() { return [this.target[0] + Math.sin(this.yaw) * Math.cos(this.pitch) * this.distance, this.target[1] + Math.sin(this.pitch) * this.distance, this.target[2] + Math.cos(this.yaw) * Math.cos(this.pitch) * this.distance]; }
  orbit(dx, dy) { this.yaw += dx * 0.008; this.pitch = clamp(this.pitch + dy * 0.006, -1.2, 1.2); }
  zoom(delta) { this.distance = clamp(this.distance * Math.exp(delta * 0.001), 0.48, 85); }
  pan(dx, dy) { const right = [Math.cos(this.yaw), 0, -Math.sin(this.yaw)]; const f = this.distance * 0.0013; this.target[0] -= right[0] * dx * f; this.target[2] -= right[2] * dx * f; this.target[1] += dy * f; }
  view(name) {
    if (name === 'front') { this.yaw = 0; this.pitch = 0.015; this.distance = 3.2; this.target = [0, 1.04, 0]; }
    if (name === 'side') { this.yaw = Math.PI / 2; this.pitch = 0.015; this.distance = 3.2; this.target = [0, 1.04, 0]; }
    if (name === 'rear') { this.yaw = Math.PI; this.pitch = 0.015; this.distance = 3.2; this.target = [0, 1.04, 0]; }
    if (name === 'face') { this.yaw = 0; this.pitch = 0.015; this.distance = 0.79; this.target = [0, 1.84, 0]; }
    if (name === 'body') { this.yaw = 0.04; this.pitch = 0.02; this.distance = 3.35; this.target = [0, 1.03, 0]; }
    if (name === 'crowd') { this.yaw = 0.26; this.pitch = 0.4; this.distance = 24; this.target = [0, 0.9, 0]; }
  }
}

export class Renderer {
  static async create(canvas, onError) {
    if (!navigator.gpu) throw new Error('Este navegador não oferece WebGPU. Abra no Microsoft Edge ou Chrome recente com aceleração gráfica ativa.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('Nenhum adaptador WebGPU disponível. Verifique a aceleração gráfica do navegador.');
    const device = await adapter.requestDevice();
    const renderer = new Renderer(canvas, device, onError);
    await renderer.initialize();
    return renderer;
  }
  constructor(canvas, device, onError) {
    this.canvas = canvas; this.device = device; this.onError = onError; this.camera = new Camera();
    this.context = canvas.getContext('webgpu'); this.format = navigator.gpu.getPreferredCanvasFormat();
    this.sceneBuffer = device.createBuffer({ size: 1424, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.mainInstance = device.createBuffer({ size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(this.mainInstance, 0, new Float32Array([0, 0, 0, 1, 1, 1, 1, -1]));
    this.person = null; this.mainMesh = null; this.crowdCount = 0;
    device.lost.then(info => onError(`O dispositivo WebGPU foi perdido: ${info.message}`));
  }
  async initialize() {
    const shaderText = await (await fetch(new URL('./shaders.wgsl', import.meta.url))).text();
    const module = this.device.createShaderModule({ code: shaderText });
    const diagnostics = await module.getCompilationInfo();
    const errors = diagnostics.messages.filter(m => m.type === 'error');
    if (errors.length) throw new Error(`Shader WGSL: ${errors.map(e => `${e.lineNum}:${e.linePos} ${e.message}`).join('; ')}`);
    this.pipeline = this.device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vertexMain', buffers: [
        { arrayStride: 56, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' },
          { shaderLocation: 2, offset: 24, format: 'float32x3' }, { shaderLocation: 3, offset: 36, format: 'float32' },
          { shaderLocation: 4, offset: 40, format: 'float32' }, { shaderLocation: 5, offset: 44, format: 'float32' },
          { shaderLocation: 6, offset: 48, format: 'float32' }, { shaderLocation: 7, offset: 52, format: 'float32' },
        ] },
        { arrayStride: 32, stepMode: 'instance', attributes: [
          { shaderLocation: 8, offset: 0, format: 'float32x4' }, { shaderLocation: 9, offset: 16, format: 'float32x4' },
        ] },
      ] },
      fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: 1 },
    });
    this.bindGroup = this.device.createBindGroup({ layout: this.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.sceneBuffer } }] });
    const floor = new MeshBuilder();
    floor.quad([-125, -0.014, -125], [-125, -0.014, 125], [125, -0.014, 125], [125, -0.014, -125], [0.22, 0.23, 0.24], 0.98, 19, 4);
    this.floorMesh = this.uploadMesh(floor.finish());
    this.resize();
  }
  uploadMesh(mesh) {
    const buffer = this.device.createBuffer({ size: Math.max(4, mesh.vertices.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(buffer, 0, mesh.vertices);
    return { buffer, vertexCount: mesh.vertexCount, triangles: mesh.triangles };
  }
  setCharacter(person) {
    this.person = person;
    const previous = this.mainMesh;
    this.mainMesh = this.uploadMesh(buildHuman(person, 0));
    this.device.queue.writeBuffer(this.mainInstance, 0, new Float32Array([0, 0, 0, person.height / 1.72, 1, 1, 1, -1]));
    previous?.buffer.destroy();
  }
  setCrowdCount(count) {
    if (!this.crowd) this.crowd = new Crowd(this);
    this.crowd.setCount(count);
    this.crowdCount = count;
  }
  resize() {
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * Math.min(devicePixelRatio, 1.8)));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * Math.min(devicePixelRatio, 1.8)));
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width; this.canvas.height = height;
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
    this.depth?.destroy();
    this.depth = this.device.createTexture({ size: [width, height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
  }
  render(time) {
    this.resize();
    if (!this.mainMesh || !this.person) return null;
    const aspect = this.canvas.width / this.canvas.height, eye = this.camera.eye();
    const vp = m4mul(perspective(this.camera.fov, aspect, 0.03, 220), lookAt(eye, this.camera.target));
    const bones = poseMatrices(this.person, time);
    const setup = lighting[this.person.lighting];
    const uniform = new Float32Array(356);
    uniform.set(vp, 0);
    bones.forEach((matrix, i) => uniform.set(matrix, 16 + i * 16));
    uniform.set([...norm(setup.direction), 0], 336);
    uniform.set([...setup.color, setup.power], 340);
    uniform.set([...eye, 1], 344);
    uniform.set([time, this.person.skinDetail, 0, 0], 348);
    uniform.set([...setup.background, 1], 352);
    this.device.queue.writeBuffer(this.sceneBuffer, 0, uniform);
    const crowdStats = this.crowdCount ? this.crowd.update(this.camera, this.canvas.height) : { counts: [0, 0, 0, 0, 0], visible: 0 };
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: setup.background[0], g: setup.background[1], b: setup.background[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: this.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    pass.setPipeline(this.pipeline); pass.setBindGroup(0, this.bindGroup);
    pass.setVertexBuffer(0, this.floorMesh.buffer); pass.setVertexBuffer(1, this.mainInstance); pass.draw(this.floorMesh.vertexCount);
    pass.setVertexBuffer(0, this.mainMesh.buffer); pass.draw(this.mainMesh.vertexCount);
    const crowdDraw = this.crowdCount ? this.crowd.render(pass) : { draws: 0, triangles: 0 };
    pass.end(); this.device.queue.submit([encoder.finish()]);
    return { draws: 2 + crowdDraw.draws, triangles: this.floorMesh.triangles + this.mainMesh.triangles + crowdDraw.triangles,
      vertices: this.mainMesh.vertexCount, visible: crowdStats.visible + 1, lod: crowdStats.counts,
      skeletons: 1 + crowdStats.counts[0] + crowdStats.counts[1], faces: 1 + crowdStats.counts[0] };
  }
}
