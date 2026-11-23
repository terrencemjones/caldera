export const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Copies a texture to the target, optionally magnifying it into square blocks. */
export const COPY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uDiv;
out vec4 fragColor;
void main() {
  fragColor = vec4(texelFetch(uTex, ivec2(gl_FragCoord.xy / uDiv), 0).rgb, 1.0);
}`;

export const MAXO = 12;
export const MAXL = 6;
export const MAXT = 8;

export const TRACE_FRAG = (hm: number, linear: boolean) => `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;
#define MAXO ${MAXO}
#define MAXL ${MAXL}
#define MAXT ${MAXT}
#define STK 6
#define HM ${hm}.0
${linear ? '#define HLINEAR' : ''}

out vec4 fragColor;

uniform vec2 uRes;
uniform vec2 uJitter;
uniform float uScale;
uniform float uPass;
uniform vec3 uCamPos;
uniform mat3 uCamRot;
uniform float uTanFov;

uniform int uCount;
uniform int uType[MAXO];
uniform mat4 uInv[MAXO];
uniform vec4 uMA[MAXO]; // colour, colour driver
uniform vec4 uMB[MAXO]; // ambient, diffuse, specular, shininess
uniform vec4 uMC[MAXO]; // reflect, transparency, ior, bump
uniform vec4 uMD[MAXO]; // (unused), absorption, heightmap layer, metal
uniform vec4 uME[MAXO]; // texture slot A, slot B, bump driver, specular driver
uniform vec4 uMF[MAXO]; // reflect driver, transparency driver, boolean role, boolean mode
uniform vec4 uMG[MAXO]; // object scale, boolean group
uniform sampler2DArray uHeight;
uniform int uSteps;
uniform int uIter; // ray budget per pixel; a uniform so the loop is never unrolled

// Procedural textures: up to three layers each.
uniform int uTN[MAXT];
uniform vec2 uTS[MAXT];       // scale, feature frequency
uniform vec4 uT0[MAXT * 3];   // source, octaves, frequency, filter
uniform vec4 uT1[MAXT * 3];   // filter a, filter b, phase amount, phase frequency
uniform vec4 uT2[MAXT * 3];   // stretch, combine mode
uniform vec4 uT3[MAXT * 3];   // altitude low/high, slope low/high
uniform vec4 uTC0[MAXT * 3];
uniform vec4 uTC1[MAXT * 3];
uniform vec4 uTC2[MAXT * 3];

uniform int uLN;
uniform vec4 uLP[MAXL]; // position, kind (0 radial, 1 spot, 2 parallel)
uniform vec4 uLD[MAXL]; // direction, cos(outer cone)
uniform vec4 uLC[MAXL]; // colour * power, range
uniform vec4 uLQ[MAXL]; // cos(inner cone), falloff mode, casts shadows

uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHazeCol;
uniform vec3 uSkyAmb;
uniform vec3 uGndAmb;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec4 uAtmo;  // haze density, fog density, fog height, horizon haze mix
uniform vec4 uCloud; // cover, height, scale, stars
uniform vec4 uSunP;  // cos(disc radius), glow, softness, exposure

vec3 gL; // sun direction for this pixel (jittered for soft shadows)

// ---------------------------------------------------------------- noise
float hash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x),
        mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x),
        mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm(vec3 p, int oct) {
  float a = 0.5;
  float s = 0.0;
  for (int i = 0; i < oct; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec3(17.1, 3.7, 9.2);
    a *= 0.5;
  }
  return s;
}

// Distance to the nearest of a set of scattered points.
float cells(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d = 1e9;
  for (int a = -1; a <= 1; a++)
    for (int b = -1; b <= 1; b++)
      for (int c = -1; c <= 1; c++) {
        vec3 g = vec3(float(a), float(b), float(c));
        vec3 o = vec3(hash3(i + g), hash3(i + g + 41.3), hash3(i + g + 91.7));
        vec3 r = g + o - f;
        d = min(d, dot(r, r));
      }
  return sqrt(d);
}

// ---------------------------------------------------------------- textures
float band(float x, vec2 r) {
  return smoothstep(r.x - 0.05, r.x + 0.05, x) * (1.0 - smoothstep(r.y - 0.05, r.y + 0.05, x));
}

// Returns colour in rgb and the scalar value in a.
vec4 evalTex(int s, vec3 q0, float alt, float slope) {
  vec3 q = q0 * uTS[s].x;
  vec4 acc = vec4(0.5);
  int nc = uTN[s];
  for (int c = 0; c < nc; c++) {
    int k = s * 3 + c;
    vec4 P0 = uT0[k];
    vec4 P1 = uT1[k];
    vec4 P2 = uT2[k];
    vec4 P3 = uT3[k];
    vec3 x = q * P0.z * P2.xyz;
    int src = int(P0.x + 0.5);
    int oct = int(P0.y + 0.5);
    float wob = 0.0;
    if (P1.z > 0.0) {
      vec3 w = x * P1.w;
      vec3 dn = vec3(vnoise(w + 7.1), vnoise(w + 19.3), vnoise(w + 31.7)) - 0.5;
      if (src == 6 || src == 7) wob = dn.x * P1.z;
      else x += dn * 2.0 * P1.z;
    }
    float v;
    float cl = 0.0;
    if (src == 3 || src == 8) cl = cells(x);
    if (src == 0) {
      v = fbm(x, oct) / (1.0 - exp2(-float(oct)));
      v = clamp((v - 0.5) * 1.6 + 0.5, 0.0, 1.0);
    } else if (src == 1 || src == 2) {
      float a = 0.5;
      float sum = 0.0;
      float nrm = 0.0;
      vec3 y = x;
      for (int i = 0; i < oct; i++) {
        float r = abs(2.0 * vnoise(y) - 1.0);
        if (src == 1) { r = 1.0 - r; r *= r; }
        sum += a * r;
        nrm += a;
        y = y * 2.03 + vec3(17.1, 3.7, 9.2);
        a *= 0.5;
      }
      v = clamp(sum / nrm * (src == 1 ? 1.0 : 1.8), 0.0, 1.0);
    } else if (src == 3) v = clamp(cl, 0.0, 1.0);
    else if (src == 4) v = 0.5 + 0.5 * sin(6.2832 * (x.x + x.y + x.z));
    else if (src == 5) {
      vec3 f = floor(x + 1e-4);
      v = mod(f.x + f.y + f.z, 2.0) < 0.5 ? 0.0 : 1.0;
    } else if (src == 6) v = clamp(alt + wob, 0.0, 1.0);
    else if (src == 7) v = clamp(slope + wob, 0.0, 1.0);
    else v = 1.0 - smoothstep(0.22, 0.34, cl);

    int fl = int(P0.w + 0.5);
    float fa = P1.x;
    float fb = P1.y;
    if (fl == 1) v = clamp((v - 0.5) * fa + 0.5 + fb, 0.0, 1.0);
    else if (fl == 2) v = smoothstep(fa, max(fb, fa + 1e-3), v);
    else if (fl == 3) v = 0.5 + 0.5 * sin(6.2832 * (fa * v + fb));
    else if (fl == 4) { float n = max(2.0, floor(fa)); v = min(floor(v * n), n - 1.0) / (n - 1.0); }
    else if (fl == 5) v = 1.0 - v;
    else if (fl == 6) v = abs(2.0 * v - 1.0);
    else if (fl == 7) v = pow(v, max(fa, 0.01));

    vec3 col = v < 0.5 ? mix(uTC0[k].rgb, uTC1[k].rgb, v * 2.0) : mix(uTC1[k].rgb, uTC2[k].rgb, v * 2.0 - 1.0);
    vec4 cur = vec4(col, v);
    if (c == 0) { acc = cur; continue; }
    float jit = (v - 0.5) * 0.25;
    float m = band(alt + jit, P3.xy) * band(slope + jit, P3.zw);
    int cm = int(P2.w + 0.5);
    if (cm == 0) acc = mix(acc, cur, m);
    else if (cm == 1) acc *= mix(vec4(1.0), cur, m);
    else if (cm == 2) acc += cur * m;
    else if (cm == 3) acc = mix(acc, cur, 0.5 * m);
    else if (cm == 4) acc = mix(acc, max(acc, cur), m);
    else if (cm == 5) acc = mix(acc, min(acc, cur), m);
    else acc = mix(acc, cur, m * v);
  }
  return clamp(acc, 0.0, 1.0);
}

// ---------------------------------------------------------------- shapes
// All shapes are intersected in object space, where they are unit sized.
// The ray direction is not renormalised, so t is the same in world space.
// Convex shapes report the span of the ray inside them, which is what the
// boolean combiner needs.

float hgt(float layer, vec2 xz) {
  vec2 uv = clamp(xz * 0.5 + 0.5, 0.0, 1.0);
#ifdef HLINEAR
  uv = (uv * (HM - 1.0) + 0.5) / HM;
  return textureLod(uHeight, vec3(uv, layer), 0.0).r;
#else
  vec2 g = uv * (HM - 1.0);
  ivec2 i = clamp(ivec2(floor(g)), ivec2(0), ivec2(int(HM) - 2));
  vec2 f = g - vec2(i);
  int l = int(layer + 0.5);
  float a = texelFetch(uHeight, ivec3(i, l), 0).r;
  float b = texelFetch(uHeight, ivec3(i + ivec2(1, 0), l), 0).r;
  float c = texelFetch(uHeight, ivec3(i + ivec2(0, 1), l), 0).r;
  float d = texelFetch(uHeight, ivec3(i + ivec2(1, 1), l), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
#endif
}

vec3 coneN(vec3 p) {
  if (p.y < -1.0 + 1e-4 && dot(p.xz, p.xz) < 1.0 - 1e-3) return vec3(0.0, -1.0, 0.0);
  return vec3(p.x, 0.25 * (1.0 - p.y), p.z);
}

bool span(int ty, vec3 o, vec3 d, out float t0, out float t1, out vec3 n0, out vec3 n1) {
  t0 = 0.0; t1 = 0.0; n0 = vec3(0.0, 1.0, 0.0); n1 = n0;
  if (ty == 0) {
    // A plane is solid below y = 0.
    float tt = -o.y / d.y;
    if (d.y < 0.0) { t0 = tt; t1 = 1e9; } else { t0 = -1e9; t1 = tt; }
    return true;
  }
  if (ty == 1) {
    float a = dot(d, d);
    float b = dot(o, d);
    float c = dot(o, o) - 1.0;
    float h = b * b - a * c;
    if (h <= 0.0) return false;
    h = sqrt(h);
    t0 = (-b - h) / a;
    t1 = (-b + h) / a;
    n0 = o + d * t0;
    n1 = o + d * t1;
    return true;
  }
  if (ty == 2) {
    vec3 inv = 1.0 / d;
    vec3 a = (-1.0 - o) * inv;
    vec3 b = (1.0 - o) * inv;
    vec3 mn = min(a, b);
    vec3 mx = max(a, b);
    t0 = max(max(mn.x, mn.y), mn.z);
    t1 = min(min(mx.x, mx.y), mx.z);
    if (t0 >= t1) return false;
    n0 = -sign(d) * vec3(equal(mn, vec3(t0)));
    n1 = sign(d) * vec3(equal(mx, vec3(t1)));
    return true;
  }
  float ya = (-1.0 - o.y) / d.y;
  float yb = (1.0 - o.y) / d.y;
  if (ya > yb) { float tmp = ya; ya = yb; yb = tmp; }
  if (ty == 3) {
    float a = dot(d.xz, d.xz);
    float b = dot(o.xz, d.xz);
    float c = dot(o.xz, o.xz) - 1.0;
    float s0 = -1e9;
    float s1 = 1e9;
    if (a > 1e-12) {
      float h = b * b - a * c;
      if (h <= 0.0) return false;
      h = sqrt(h);
      s0 = (-b - h) / a;
      s1 = (-b + h) / a;
    } else if (c > 0.0) return false;
    t0 = max(s0, ya);
    t1 = min(s1, yb);
    if (t0 >= t1) return false;
    n0 = s0 > ya ? vec3(o.x + d.x * t0, 0.0, o.z + d.z * t0) : vec3(0.0, -sign(d.y), 0.0);
    n1 = s1 < yb ? vec3(o.x + d.x * t1, 0.0, o.z + d.z * t1) : vec3(0.0, sign(d.y), 0.0);
    return true;
  }
  // Cone: apex at y = 1, base of radius 1 at y = -1.
  const float k = 0.25;
  float w0 = 1.0 - o.y;
  float a = dot(d.xz, d.xz) - k * d.y * d.y;
  float b = dot(o.xz, d.xz) + k * w0 * d.y;
  float c = dot(o.xz, o.xz) - k * w0 * w0;
  float h = b * b - a * c;
  if (h <= 0.0) return false;
  h = sqrt(h);
  if (abs(a) < 1e-9) a = a < 0.0 ? -1e-9 : 1e-9;
  float r0 = (-b - h) / a;
  float r1 = (-b + h) / a;
  if (r0 > r1) { float tmp = r0; r0 = r1; r1 = tmp; }
  if (a > 0.0) {
    t0 = max(r0, ya);
    t1 = min(r1, yb);
  } else {
    // The ray is steeper than the cone: it is inside outside the two roots.
    float e0 = min(yb, r0);
    float s1 = max(ya, r1);
    if (e0 - ya > yb - s1) { t0 = ya; t1 = e0; } else { t0 = s1; t1 = yb; }
  }
  if (t0 >= t1) return false;
  n0 = coneN(o + d * t0);
  n1 = coneN(o + d * t1);
  return true;
}

// A solid heightfield filling x,z in [-1,1] and y in [0, height].
bool iTerrain(float layer, vec3 o, vec3 d, float tmin, float tmax, out float t, out vec3 n) {
  t = tmax; n = vec3(0.0, 1.0, 0.0);
  vec3 inv = 1.0 / d;
  vec3 a = (vec3(-1.0, 0.0, -1.0) - o) * inv;
  vec3 b = (vec3(1.0) - o) * inv;
  vec3 mn = min(a, b);
  vec3 mx = max(a, b);
  float tn = max(max(mn.x, mn.y), mn.z);
  float tf = min(min(mx.x, mx.y), mx.z);
  if (tn > tf || tf < tmin) return false;
  float ta = max(tn, tmin);
  tf = min(tf, tmax);
  if (ta >= tf) return false;

  vec3 p = o + d * ta;
  float h = hgt(layer, p.xz);
  if (p.y < h - 1e-4) {
    // Entering through a side wall. If the ray starts inside the solid, let it out.
    if (tn <= tmin) return false;
    t = tn;
    n = -sign(d) * vec3(equal(mn, vec3(tn)));
    return true;
  }

  float rl = length(d);
  float tt = ta;
  float prev = ta;
  bool found = false;
  for (int i = 0; i < uSteps; i++) {
    float dy = p.y - h;
    if (dy < 0.0) { found = true; break; }
    prev = tt;
    tt += clamp(dy * 0.35, 0.003, 0.06) / rl;
    if (tt > tf) break;
    p = o + d * tt;
    h = hgt(layer, p.xz);
  }
  if (!found) return false;
  float lo = prev;
  float hi = tt;
  for (int i = 0; i < 7; i++) {
    float m = 0.5 * (lo + hi);
    vec3 q = o + d * m;
    if (q.y < hgt(layer, q.xz)) hi = m; else lo = m;
  }
  t = hi;
  p = o + d * t;
  float e = 2.5 / HM;
  n = vec3(hgt(layer, p.xz - vec2(e, 0.0)) - hgt(layer, p.xz + vec2(e, 0.0)),
           2.0 * e,
           hgt(layer, p.xz - vec2(0.0, e)) - hgt(layer, p.xz + vec2(0.0, e)));
  return true;
}

void toObject(int i, vec3 ro, vec3 rd, out vec3 o, out vec3 d) {
  o = (uInv[i] * vec4(ro, 1.0)).xyz;
  d = mat3(uInv[i]) * rd;
  d = mix(d, vec3(1e-9), equal(d, vec3(0.0)));
}

vec3 toWorldN(int i, vec3 n) {
  return normalize(transpose(mat3(uInv[i])) * n);
}

bool intersect(int i, vec3 ro, vec3 rd, float tmin, float tmax, out float t, out vec3 n) {
  t = tmax; n = vec3(0.0, 1.0, 0.0);
  vec3 o; vec3 d;
  toObject(i, ro, rd, o, d);
  int ty = uType[i];
  bool hit = false;
  vec3 no = vec3(0.0, 1.0, 0.0);
  if (ty == 5) {
    hit = iTerrain(uMD[i].z, o, d, tmin, tmax, t, no);
  } else {
    float t0; float t1; vec3 n0; vec3 n1;
    if (!span(ty, o, d, t0, t1, n0, n1)) return false;
    if (ty == 0) {
      // On its own a plane is a sheet, hit from either side.
      float tt = d.y < 0.0 ? t0 : t1;
      if (tt > tmin && tt < tmax) { t = tt; hit = true; }
    } else if (t0 > tmin) {
      if (t0 < tmax) { t = t0; no = n0; hit = true; }
    } else if (t1 > tmin && t1 < tmax) { t = t1; no = n1; hit = true; }
  }
  if (hit) n = toWorldN(i, no);
  return hit;
}

// Boolean group: solid = (any positive) and (every intersect) and (no negative).
#define MAXG 8
bool csg(int lead, vec3 ro, vec3 rd, float tmin, float tmax, out float t, out vec3 n, out int id) {
  t = tmax; n = vec3(0.0, 1.0, 0.0); id = lead;
  float g = uMG[lead].w;
  float a0[MAXG];
  float a1[MAXG];
  vec3 m0[MAXG];
  vec3 m1[MAXG];
  int who[MAXG];
  int m = 0;
  for (int i = lead; i < uCount; i++) {
    if (m >= MAXG) break;
    if (uMF[i].z < 0.5 || uMG[i].w != g) continue;
    vec3 o; vec3 d;
    toObject(i, ro, rd, o, d);
    float t0; float t1; vec3 n0; vec3 n1;
    bool ok = span(uType[i], o, d, t0, t1, n0, n1);
    who[m] = i;
    a0[m] = ok ? t0 : 1e9;
    a1[m] = ok ? t1 : -1e9;
    m0[m] = n0;
    m1[m] = n1;
    m++;
  }
  bool hit = false;
  // Every span end is a candidate surface; it is real if solidity flips across it.
  for (int c = 0; c < m * 2; c++) {
    int k = c / 2;
    bool first = (c - k * 2) == 0;
    if (a0[k] > a1[k]) continue;
    float tc = first ? a0[k] : a1[k];
    if (tc <= tmin || tc >= t) continue;
    float ep = 1e-4 * (1.0 + tc);
    bool posA = false; bool okA = true;
    bool posB = false; bool okB = true;
    for (int j = 0; j < m; j++) {
      bool inA = (tc - ep) > a0[j] && (tc - ep) < a1[j];
      bool inB = (tc + ep) > a0[j] && (tc + ep) < a1[j];
      float md = uMF[who[j]].w;
      if (md < 0.5) { posA = posA || inA; posB = posB || inB; }
      else if (md < 1.5) { okA = okA && !inA; okB = okB && !inB; }
      else { okA = okA && inA; okB = okB && inB; }
    }
    bool before = posA && okA;
    bool after = posB && okB;
    if (before != after) {
      t = tc;
      hit = true;
      id = who[k];
      vec3 nn = toWorldN(id, first ? m0[k] : m1[k]);
      // Entering the solid the normal faces the ray; leaving it, away.
      bool facing = dot(nn, rd) < 0.0;
      n = (after == facing) ? nn : -nn;
    }
  }
  return hit;
}

bool hitObj(int i, vec3 ro, vec3 rd, float tmin, float tmax, out float t, out vec3 n, out int id) {
  id = i;
  float role = uMF[i].z;
  if (role < 0.5) return intersect(i, ro, rd, tmin, tmax, t, n);
  if (role < 1.5) return csg(i, ro, rd, tmin, tmax, t, n, id);
  t = tmax; n = vec3(0.0, 1.0, 0.0);
  return false;
}

bool trace(vec3 ro, vec3 rd, out float t, out vec3 n, out int id) {
  t = 1e5; id = -1; n = vec3(0.0, 1.0, 0.0);
  float tt; vec3 nn; int ii;
  for (int i = 0; i < uCount; i++) {
    if (hitObj(i, ro, rd, 1e-3, t, tt, nn, ii)) { t = tt; n = nn; id = ii; }
  }
  return id >= 0;
}

float shadow(vec3 ro, vec3 rd, float tmax) {
  float s = 1.0;
  float tt; vec3 nn; int ii;
  for (int i = 0; i < uCount; i++) {
    if (s < 0.01) break;
    if (hitObj(i, ro, rd, 1e-3, tmax, tt, nn, ii)) s *= uMC[ii].y;
  }
  return s < 0.01 ? 0.0 : s;
}

// ---------------------------------------------------------------- surfaces
// Fills in the surface colour and the texture-driven multipliers for
// specular, reflection and transparency, and applies bump to the normal.
void surface(int id, vec3 p, float dist, inout vec3 n, out vec3 alb, out vec3 mul) {
  alb = uMA[id].rgb;
  mul = vec3(1.0);
  vec4 E = uME[id];
  int sa = int(floor(E.x + 0.5));
  int sb = int(floor(E.y + 0.5));
  if (sa < 0 && sb < 0) return;
  vec3 po = (uInv[id] * vec4(p, 1.0)).xyz;
  float alt = uType[id] == 5 ? po.y : po.y * 0.5 + 0.5;
  float slope = n.y;
  vec3 q = po * uMG[id].xyz;
  int bs = int(E.z + 0.5);
  float bump = uMC[id].w;
  int slot = bs == 1 ? sa : bs == 2 ? sb : -1;
  float ff = slot >= 0 ? uTS[slot].y : 1.0;
  // Fade fine detail with distance so it doesn't turn to noise on the horizon.
  float fade = 1.0 / (1.0 + dist * dist * ff * ff * 0.0002);
  bool doBump = bump > 0.0 && slot >= 0 && fade > 0.02;
  float e = 0.05 / ff;

  // Evaluations 0 and 1 are textures A and B; 2 to 4 are the offset samples
  // of the bump texture used for its gradient.
  vec4 ta = vec4(1.0);
  vec4 tb = vec4(1.0);
  vec3 gs = vec3(0.0);
  int evals = doBump ? 5 : 2;
  for (int k = 0; k < evals; k++) {
    int ts = k == 0 ? sa : k == 1 ? sb : slot;
    if (ts < 0) continue;
    vec3 qq = q + e * vec3(float(k == 2), float(k == 3), float(k == 4));
    vec4 r = evalTex(ts, qq, alt, slope);
    if (k == 0) ta = r;
    else if (k == 1) tb = r;
    else if (k == 2) gs.x = r.a;
    else if (k == 3) gs.y = r.a;
    else gs.z = r.a;
  }

  int cs = int(uMA[id].w + 0.5);
  if (cs == 1) alb = ta.rgb; else if (cs == 2) alb = tb.rgb;
  int ss = int(E.w + 0.5);
  int rs = int(uMF[id].x + 0.5);
  int tsrc = int(uMF[id].y + 0.5);
  mul.x = ss == 1 ? ta.a : ss == 2 ? tb.a : 1.0;
  mul.y = rs == 1 ? ta.a : rs == 2 ? tb.a : 1.0;
  mul.z = tsrc == 1 ? ta.a : tsrc == 2 ? tb.a : 1.0;

  if (doBump) {
    vec3 g = gs - (bs == 1 ? ta.a : tb.a);
    // The gradient is in object axes; bring it round to world axes.
    vec3 gw = transpose(mat3(uInv[id])) * (g * uMG[id].xyz);
    gw -= n * dot(gw, n);
    n = normalize(n - gw * bump * fade * 14.0);
  }
}

// ---------------------------------------------------------------- sky
vec3 sky(vec3 ro, vec3 d) {
  float y = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, 1.0 - exp(-y * 4.0));
  c = mix(c, uHazeCol, uAtmo.w * exp(-y * 7.0));
  if (d.y < 0.0) c = mix(uHazeCol * 0.55, c, smoothstep(-0.3, 0.0, d.y));
  float sd = max(dot(d, uSunDir), 0.0);
  if (uCloud.w > 0.0 && d.y > 0.0) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float hsh = hash3(cell);
    float r = length(fract(sp) - 0.5);
    float star = step(0.992, hsh) * smoothstep(0.22, 0.0, r);
    c += vec3(star) * uCloud.w * (0.4 + 2.0 * hash3(cell + 7.0)) * smoothstep(0.0, 0.25, d.y);
  }
  c += uSunCol * uSunP.y * (pow(sd, 8.0) * 0.07 + pow(sd, 64.0) * 0.22);
  c += uSunCol * smoothstep(uSunP.x, uSunP.x + 0.00012, sd) * 14.0;
  if (d.y > 0.015 && uCloud.x > 0.001) {
    float tc = (uCloud.y - ro.y) / d.y;
    if (tc > 0.0) {
      vec2 cp = (ro.xz + d.xz * tc) * uCloud.z;
      float n1 = fbm(vec3(cp, 1.7), 6);
      float th = mix(0.86, 0.34, uCloud.x);
      float dn = smoothstep(th, th + 0.24, n1);
      float n2 = fbm(vec3(cp + uSunDir.xz * 0.3, 1.7), 3);
      float lit = clamp(0.6 + (n1 - n2) * 2.2, 0.0, 1.0);
      vec3 cc = mix(uCloudDark, uCloudLit, lit * (1.0 - dn * 0.45));
      cc += uSunCol * pow(sd, 10.0) * 0.3 * (1.0 - dn);
      float fade = smoothstep(0.015, 0.2, d.y);
      c = mix(c, cc, dn * fade);
    }
  }
  return c;
}

// Transmittance through distance haze plus low-lying fog.
float atmoT(vec3 o, vec3 d, float t, float hazeOn) {
  float od = uAtmo.x * t * hazeOn;
  float b = 1.0 / uAtmo.z;
  float x = d.y * b * t;
  float f = abs(x) < 1e-3 ? 1.0 : (1.0 - exp(-clamp(x, -30.0, 30.0))) / x;
  od += uAtmo.y * exp(-clamp(o.y * b, -30.0, 30.0)) * t * f;
  return exp(-od);
}

// ---------------------------------------------------------------- tracer
vec3 render(vec3 ro0, vec3 rd0) {
  vec3 sro[STK];
  vec3 srd[STK];
  vec3 sw[STK];
  int smed[STK];
  int sdep[STK];
  sro[0] = ro0; srd[0] = rd0; sw[0] = vec3(1.0); smed[0] = -1; sdep[0] = 0;
  int sp = 1;
  vec3 col = vec3(0.0);

  for (int it = 0; it < uIter; it++) {
    if (sp <= 0) break;
    sp--;
    vec3 o = sro[sp];
    vec3 d = srd[sp];
    vec3 w = sw[sp];
    int med = smed[sp];
    int dep = sdep[sp];

    float t; vec3 n; int id;
    bool hit = trace(o, d, t, n, id);

    if (med >= 0) {
      // Travelling inside a transparent object: tint by depth.
      float dist = hit ? t : 400.0;
      w *= exp(-dist * uMD[med].y * (1.0 - uMA[med].rgb) * 4.0);
    }
    if (!hit) {
      vec3 s = sky(o, d);
      if (med < 0) {
        float ft = atmoT(o, d, 4000.0, 0.0);
        s = mix(uHazeCol, s, ft);
      }
      col += w * s;
      continue;
    }

    vec3 p = o + d * t;
    bool inside = dot(d, n) > 0.0;
    vec3 gn = inside ? -n : n;
    vec3 ns = gn;
    vec3 alb; vec3 mul;
    surface(id, p, t, ns, alb, mul);

    if (med < 0) {
      float ft = atmoT(o, d, t, 1.0);
      col += w * (1.0 - ft) * uHazeCol;
      w *= ft;
    }

    vec4 mb = uMB[id];
    vec4 mc = uMC[id];
    float ks = mb.z * mul.x;
    vec3 sp0 = p + gn * 0.03;

    vec3 light = mix(uGndAmb, uSkyAmb, ns.y * 0.5 + 0.5) * mb.x;
    vec3 spec = vec3(0.0);
    // Light -1 is the sun (or moon); the rest are the scene's lamps.
    for (int l = -1; l < uLN; l++) {
      vec3 lv = gL;
      vec3 lc = uSunCol;
      float ld = 1e5;
      float att = 1.0;
      bool casts = true;
      if (l >= 0) {
        vec4 lp = uLP[l];
        lc = uLC[l].rgb;
        casts = uLQ[l].z > 0.5;
        if (lp.w > 1.5) {
          lv = -uLD[l].xyz;
        } else {
          vec3 dl = lp.xyz - p;
          ld = length(dl);
          lv = dl / ld;
          float fo = uLQ[l].y;
          float rr = ld / uLC[l].w;
          if (fo > 1.5) att = 1.0 / (1.0 + rr * rr);
          else if (fo > 0.5) att = 1.0 / (1.0 + rr);
          if (lp.w > 0.5) att *= smoothstep(uLD[l].w, uLQ[l].x, dot(-lv, uLD[l].xyz));
        }
      }
      float nl = max(dot(ns, lv), 0.0) * att;
      if (nl < 1e-3) continue;
      float ls = casts ? shadow(sp0, lv, ld) : 1.0;
      light += lc * nl * ls * mb.y;
      spec += lc * pow(max(dot(ns, normalize(lv - d)), 0.0), mb.w) * ks * ls * att;
    }
    vec3 local = alb * light;

    float tr = mc.y * mul.z;
    float rf = mc.x * mul.y;
    float fres = 0.0;
    vec3 rdir = vec3(0.0);
    if (tr > 0.0) {
      float cosi = clamp(-dot(d, ns), 0.0, 1.0);
      float r0 = (1.0 - mc.z) / (1.0 + mc.z);
      r0 *= r0;
      fres = r0 + (1.0 - r0) * pow(1.0 - cosi, 5.0);
      rdir = refract(d, ns, inside ? mc.z : 1.0 / mc.z);
      if (dot(rdir, rdir) < 1e-6) fres = 1.0;
    }
    float kT = tr * (1.0 - fres);
    float kR = clamp(rf + tr * fres, 0.0, 1.0);
    float kL = (1.0 - tr) * (1.0 - rf);

    col += w * (kL * local + spec);

    if (dep < 3) {
      if (kR > 0.02 && sp < STK) {
        sro[sp] = p + gn * 0.02;
        srd[sp] = reflect(d, ns);
        sw[sp] = w * kR * mix(vec3(1.0), alb, uMD[id].w);
        smed[sp] = med;
        sdep[sp] = dep + 1;
        sp++;
      }
      if (kT > 0.02 && sp < STK) {
        sro[sp] = p - gn * 0.02;
        srd[sp] = rdir;
        sw[sp] = w * kT;
        smed[sp] = inside ? -1 : id;
        sdep[sp] = dep + 1;
        sp++;
      }
    }
  }
  return col;
}

void main() {
  vec2 px = gl_FragCoord.xy * uScale + uJitter;
  vec2 ndc = px / uRes * 2.0 - 1.0;
  vec3 rd = normalize(uCamRot * vec3(ndc.x * uTanFov * uRes.x / uRes.y, ndc.y * uTanFov, 1.0));

  gL = uSunDir;
  if (uPass > 0.5) {
    float r1 = hash3(vec3(gl_FragCoord.xy, uPass));
    float r2 = hash3(vec3(gl_FragCoord.yx + 11.0, uPass * 1.7));
    float ang = 6.2832 * r1;
    vec3 t1 = normalize(cross(gL, vec3(0.0, 1.0, 0.01)));
    vec3 t2 = cross(gL, t1);
    gL = normalize(gL + (t1 * cos(ang) + t2 * sin(ang)) * sqrt(r2) * uSunP.z);
  }

  vec3 col = render(uCamPos, rd);
  col = 1.0 - exp(-col * uSunP.w);
  col = pow(col, vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;
