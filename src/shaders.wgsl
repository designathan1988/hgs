struct Scene {
  viewProj: mat4x4<f32>,
  bones: array<mat4x4<f32>, 20>,
  lightDir: vec4<f32>,
  lightColor: vec4<f32>,
  camera: vec4<f32>,
  params: vec4<f32>,
  background: vec4<f32>,
};
@group(0) @binding(0) var<uniform> scene: Scene;

struct VertexInput {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) roughness: f32,
  @location(4) boneA: f32,
  @location(5) boneB: f32,
  @location(6) boneWeight: f32,
  @location(7) kind: f32,
  @location(8) instancePosition: vec4<f32>,
  @location(9) instanceTint: vec4<f32>,
};
struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) roughness: f32,
  @location(4) kind: f32,
};

@vertex fn vertexMain(input: VertexInput) -> VertexOutput {
  var output: VertexOutput;
  var p = vec4<f32>(input.position, 1.0);
  var n = vec4<f32>(input.normal, 0.0);
  if (input.instanceTint.w < 0.0) {
    let a = u32(input.boneA + 0.5);
    let b = u32(input.boneB + 0.5);
    p = mix(scene.bones[a] * p, scene.bones[b] * p, input.boneWeight);
    n = mix(scene.bones[a] * n, scene.bones[b] * n, input.boneWeight);
    if (input.kind > 1.5 && input.kind < 2.5 && input.position.y < 1.8) {
      p.x += sin(scene.params.x * 2.3 + input.position.y * 15.0) * (1.8 - input.position.y) * 0.013;
    }
  } else if (input.kind < 3.5) {
    let sway = sin(scene.params.x * 2.7 + input.instanceTint.w) * 0.018;
    p.x += sway * (input.position.y / 2.0);
  }
  let world = vec3<f32>(p.x, p.y, p.z) * input.instancePosition.w + input.instancePosition.xyz;
  output.position = scene.viewProj * vec4<f32>(world, 1.0);
  output.worldPosition = world;
  output.normal = normalize(n.xyz);
  output.color = input.color * input.instanceTint.xyz;
  output.roughness = input.roughness;
  output.kind = input.kind;
  return output;
}

fn hash3(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(127.1, 311.7, 74.7))) * 43758.5453);
}

@fragment fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  var albedo = input.color;
  var roughness = input.roughness;
  let n = normalize(input.normal);
  if (input.kind > 3.5) {
    let grid = min(abs(fract(input.worldPosition.x * 2.0) - 0.5), abs(fract(input.worldPosition.z * 2.0) - 0.5));
    let circle = length(input.worldPosition.xz);
    albedo = mix(vec3<f32>(0.18, 0.19, 0.20), vec3<f32>(0.205, 0.211, 0.216), smoothstep(0.0, 6.0, circle));
    albedo *= 1.0 - (1.0 - smoothstep(0.015, 0.027, grid)) * 0.09;
    let shadow = 1.0 - 0.30 * exp(-circle * circle * 2.1);
    albedo *= shadow;
    roughness = 0.98;
  } else if (input.kind < 1.5 && input.kind > 0.5) {
    let grain = hash3(floor(input.worldPosition * 960.0));
    let warm = smoothstep(1.76, 1.9, input.worldPosition.y) * (1.0 - smoothstep(1.9, 2.02, input.worldPosition.y));
    albedo *= 1.0 - scene.params.y * 0.025 + grain * scene.params.y * 0.05;
    albedo += vec3<f32>(0.016, 0.004, 0.001) * warm;
    roughness = clamp(roughness + (grain - 0.5) * 0.08, 0.25, 1.0);
  } else if (input.kind > 1.5 && input.kind < 2.5) {
    albedo *= 0.87 + 0.26 * hash3(floor(input.worldPosition * 120.0));
  } else if (input.kind > 2.5 && input.kind < 3.5) {
    albedo *= 0.965 + 0.065 * hash3(floor(input.worldPosition * 170.0));
  }
  let l = normalize(scene.lightDir.xyz);
  let v = normalize(scene.camera.xyz - input.worldPosition);
  let h = normalize(l + v);
  let diffuse = max(dot(n, l), 0.0);
  let fill = max(dot(n, normalize(vec3<f32>(-0.65, 0.45, -0.4))), 0.0);
  let rim = pow(1.0 - max(dot(n, v), 0.0), 2.0);
  let specPower = mix(90.0, 13.0, roughness);
  let spec = pow(max(dot(n, h), 0.0), specPower) * (1.0 - roughness * 0.8);
  var lit = albedo * (0.19 + diffuse * scene.lightColor.w * 0.56 + fill * 0.11);
  lit += scene.lightColor.xyz * spec * select(0.11, 0.15, input.kind > 0.5 && input.kind < 1.5);
  lit += albedo * rim * select(0.08, 0.0, input.kind > 3.5);
  var finalColor = pow(clamp(lit, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(0.84));
  if (input.kind > 3.5) {
    let fog = smoothstep(5.0, 17.0, distance(scene.camera.xyz, input.worldPosition));
    finalColor = mix(finalColor, scene.background.xyz, fog);
  }
  return vec4<f32>(finalColor, 1.0);
}
