import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MAX_REGIONS = 16;
const MAX_CIRCLES = 16;
const RELAY_BASE = 256;
const SAMPLE_MARGIN = 6;
const WINDOW_REACH = 64;
const RELAY_KEEP = 16;
const REFRESH_LIMIT = 3;
const CAPACITY_STEP = 128;
const ALLOC_RETRY_US = 2000000;
const TONE_SIZE = 24;
const TONE_TIMEOUT_MS = 1000;
const TONE_AUTO_MS = 400;
const TONE_COOLDOWN_US = 1000000;
const BLEND_OVER = 'RGBA = ADD(SRC_COLOR, DST_COLOR * (1 - SRC_COLOR[A]))';
const BLEND_COPY = 'RGBA = ADD(SRC_COLOR, 0)';

const OPTICS = {
    amplitude: 0.3,
    power: 3,
    bandFraction: 0.4,
    bandMax: 48,
    bezel: 2.5,
    ior: 1.5,
    dispersion: 0.04,
    shade: 0.1,
    lift: 0.02,
    saturation: 1.06,
    lightX: -Math.SQRT1_2,
    lightY: -Math.SQRT1_2,
    keyLight: 0.6,
    fillLight: 0.42,
    rimFloor: 0.12,
    fresnel: 0.1,
    highlightTint: 0.35,
    shadowAlpha: 0.12,
    shadowRadius: 20,
    shadowY: 4,
    mergeK: 12,
    blobK: 20,
};

const GLASS_DECLARATIONS = `
uniform vec4 u_frame[4];
uniform vec4 u_params[6];
uniform vec4 u_reg[${MAX_REGIONS * 3}];
uniform vec4 u_circ[${MAX_CIRCLES}];

const mat3 LG_VIBRANT = mat3(2.6705, -0.3295, -0.3297, -1.1088, 1.8914, -1.1084, -0.1117, -0.1119, 2.8881);

vec3 lg_tap(vec2 q) {
    vec2 uv = clamp(q * u_frame[1].xy + u_frame[1].zw, u_frame[2].xy, u_frame[2].zw);
    return texture2D(cogl_sampler0, uv).rgb;
}

vec3 lg_box(vec2 p, vec2 b, float r) {
    vec2 w = abs(p) - b + vec2(r);
    float m = max(w.x, w.y);
    vec2 q = max(w, 0.0);
    float l = length(q);
    vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
    vec2 gr = m > 0.0 ? q / max(l, 0.0001) : (w.x > w.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
    return vec3((m > 0.0 ? l : m) - r, s * gr);
}

float lg_slope(float t) {
    float u = 1.0 - t;
    return u * u * u * pow(max(1.0 - u * u * u * u, 0.0001), -0.75);
}
`;

const GLASS_BODY = `
vec2 p = u_frame[0].xy + cogl_tex_coord_in[0].st * u_frame[0].zw;
float sc = u_frame[3].y;
int nr = int(u_frame[3].z + 0.5);
float kMerge = max(u_params[5].x * sc, 0.001);
float kBlob = max(u_params[5].y * sc, 0.001);
float d = 100000.0;
vec2 g = vec2(0.0, -1.0);
float alpha = 0.0;
vec4 tint = vec4(0.0);
float band = 1.0;
bool found = false;
for (int i = 0; i < ${MAX_REGIONS}; i++) {
    if (i >= nr)
        break;
    vec4 rc = u_reg[i * 3];
    vec4 sh = u_reg[i * 3 + 1];
    vec4 tn = u_reg[i * 3 + 2];
    float di;
    vec2 gi;
    if (sh.y > 0.5) {
        int c0 = int(rc.x + 0.5);
        int c1 = c0 + int(rc.y + 0.5);
        float bd = 100000.0;
        vec2 bg = vec2(0.0, -1.0);
        bool bfound = false;
        for (int j = 0; j < ${MAX_CIRCLES}; j++) {
            if (j < c0)
                continue;
            if (j >= c1)
                break;
            vec4 cc = u_circ[j];
            vec2 v = p - cc.xy;
            float l = length(v);
            float cd = l - cc.z;
            vec2 cg = l > 0.0001 ? v / l : vec2(0.0, -1.0);
            if (!bfound) {
                bd = cd;
                bg = cg;
                bfound = true;
            } else {
                float h = clamp(0.5 + 0.5 * (cd - bd) / kBlob, 0.0, 1.0);
                bd = mix(cd, bd, h) - kBlob * h * (1.0 - h);
                bg = mix(cg, bg, h);
            }
        }
        di = bd;
        gi = bg;
    } else {
        vec2 q = p - rc.xy;
        vec3 bx = lg_box(q, rc.zw, sh.x);
        float rr = min(max(sh.x, sh.z), min(rc.z, rc.w));
        di = bx.x;
        gi = rr > sh.x + 0.01 ? lg_box(q, rc.zw, rr).yz : bx.yz;
    }
    if (!found) {
        d = di;
        g = gi;
        alpha = sh.w;
        tint = tn;
        band = sh.z;
        found = true;
    } else {
        float h = clamp(0.5 + 0.5 * (di - d) / kMerge, 0.0, 1.0);
        d = mix(di, d, h) - kMerge * h * (1.0 - h);
        g = mix(gi, g, h);
        alpha = mix(sh.w, alpha, h);
        tint = mix(tn, tint, h);
        band = mix(sh.z, band, h);
    }
}
if (!found) {
    cogl_color_out = vec4(0.0);
    return;
}
float gl = length(g);
vec2 n = gl > 0.0001 ? g / gl : vec2(0.0, -1.0);
d = d / max(gl, 0.25);
float aa = 1.0 / max(u_frame[3].x, 0.001);
float cov = clamp(0.5 - d / aa, 0.0, 1.0);
vec4 shp = u_params[4];
float ds = d - n.y * shp.z * sc;
float shq = 1.0 - clamp(ds / max(shp.y * sc, 0.001), 0.0, 1.0);
float shadow = shp.x * shq * shq * shq * alpha * (1.0 - cov);
if (cov <= 0.0) {
    cogl_color_out = vec4(0.0, 0.0, 0.0, shadow) * cogl_color_in;
    return;
}
float bw = max(band, 1.0);
float t = clamp(-d / bw, 0.0, 1.0);
float s1 = 1.0 - t;
vec3 c;
float hl = 0.0;
if (t >= 1.0) {
    c = lg_tap(p);
} else {
    float amp = alpha * u_params[0].x;
    vec2 v = -n * (amp * bw * pow(s1, u_params[0].y));
    float disp = u_params[1].x * (1.0 - amp * u_params[0].y * pow(s1, max(u_params[0].y - 1.0, 0.001)));
    c = vec3(lg_tap(p + v * (1.0 - disp)).r, lg_tap(p + v).g, lg_tap(p + v * (1.0 + disp)).b);
    float s = u_params[0].z * lg_slope(max(t, 0.02));
    float cosA = inversesqrt(1.0 + s * s);
    float f0 = (u_params[0].w - 1.0) / (u_params[0].w + 1.0);
    f0 *= f0;
    float fres = (f0 + (1.0 - f0) * pow(max(1.0 - cosA, 0.0), 5.0)) * (1.0 - smoothstep(0.0, 1.0, t));
    float nl = dot(n, u_params[2].xy);
    float lobes = u_params[3].x + u_params[2].z * pow(max(nl, 0.0), 2.5) + u_params[2].w * pow(max(-nl, 0.0), 2.5);
    float e = d / aa + 0.75;
    float line = exp(-e * e * 1.6);
    hl = clamp(fres * u_params[3].y + lobes * (line + 0.35 * fres), 0.0, 1.0);
}
float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
c = clamp(mix(vec3(luma), c, u_params[1].z), 0.0, 1.0);
vec3 hc = mix(vec3(1.0), clamp(LG_VIBRANT * c + 0.05, 0.0, 1.0), u_params[3].z);
c = mix(c, tint.rgb, tint.a);
c = vec3(1.0) - (vec3(1.0) - c) * (1.0 - u_params[1].y);
c *= 1.0 - u_params[1].w * s1 * s1 * s1;
c = vec3(1.0) - (vec3(1.0) - c) * (vec3(1.0) - hl * hc);
float ga = cov * alpha;
cogl_color_out = vec4(c * ga, ga + shadow * (1.0 - ga)) * cogl_color_in;
`;

const TONE_DECLARATIONS = `
uniform vec4 u_step;
uniform vec4 u_clamp;
`;

const TONE_BODY = `
vec2 uv = cogl_tex_coord_in[0].st;
vec3 acc = vec3(0.0);
for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4; j++) {
        vec2 q = clamp(uv + vec2(float(i) - 1.5, float(j) - 1.5) * u_step.xy, u_clamp.xy, u_clamp.zw);
        acc += texture2D(cogl_sampler0, q).rgb;
    }
}
cogl_color_out = vec4(acc / 16.0, 1.0);
`;

function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function linear(channel) {
    const v = channel / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function disconnectAll(list) {
    for (const [object, id] of list) {
        try {
            object.disconnect(id);
        } catch {}
    }
    list.length = 0;
}

const GlassActor = GObject.registerClass({
    GTypeName: 'CluiGlassActor',
}, class GlassActor extends Clutter.Actor {
    vfunc_pick(_pickContext) {
    }

    vfunc_paint_node(root, paintContext) {
        const owner = this._owner;
        if (!owner)
            return;
        try {
            owner._paint(this, root, paintContext);
        } catch (e) {
            owner._paintFailed(e);
        }
    }
});

const GlassRelay = GObject.registerClass({
    GTypeName: 'CluiGlassRelay',
}, class GlassRelay extends Clutter.Clone {
    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        this._allocated = true;
    }

    vfunc_queue_relayout() {
        if (!this._allocated)
            super.vfunc_queue_relayout();
    }

    vfunc_pick(_pickContext) {
    }

    vfunc_get_paint_volume(volume) {
        return volume.set_from_allocation(this);
    }
});

export class GlassController {
    constructor({isClientWindow, send}) {
        this._isClientWindow = isClientWindow;
        this._send = send;
        this._window = null;
        this._windowActor = null;
        this._actor = null;
        this._area = null;
        this._relays = new Map();
        this._sourceSignals = new Map();
        this._windowSignals = [];
        this._watchSignals = [];
        this._beforeUpdateId = 0;
        this._sourcesDirty = false;
        this._syncedBox = null;
        this._refreshId = 0;
        this._refreshStreak = 0;
        this._autoToneId = 0;
        this._toneDoneAt = 0;
        this._views = new Map();
        this._lastCopy = null;
        this._boundCopy = null;
        this._allocFailedAt = 0;
        this._regionsKey = '';
        this._count = 0;
        this._scale = 1;
        this._regions = [];
        this._circles = [];
        this._reg = new Float32Array(MAX_REGIONS * 12);
        this._circ = new Float32Array(MAX_CIRCLES * 4);
        this._frame = new Float32Array(16);
        this._paramData = new Float32Array(24);
        this._vec = new Float32Array(4);
        this._drawBox = null;
        this._sampleBox = null;
        this._offsetX = 0;
        this._offsetY = 0;
        this._shapesDirty = true;
        this._frameKey = new Float64Array(13);
        this._opacity = -1;
        this._clipRect = new Mtk.Rectangle({x: 0, y: 0, width: 1, height: 1});
        this._clipKey = [0, 0, 1, 1];
        this._box = new Clutter.ActorBox({x1: 0, y1: 0, x2: 1, y2: 1});
        this._clearColor = new Cogl.Color();
        this._color = new Cogl.Color();
        this._params = {...OPTICS};
        this._paramsDirty = true;
        this._paintErrors = 0;
        this._tone = null;
        this._toneTarget = null;
        this._tonePipeline = null;
        this._toneLocations = null;
        this._pipeline = null;
        this._context = null;
        try {
            this._context = global.stage.context.get_backend().get_cogl_context();
            this._pipeline = this._createPipeline(GLASS_DECLARATIONS, GLASS_BODY, BLEND_OVER);
            this._locations = {
                frame: this._pipeline.get_uniform_location('u_frame'),
                params: this._pipeline.get_uniform_location('u_params'),
                reg: this._pipeline.get_uniform_location('u_reg'),
                circ: this._pipeline.get_uniform_location('u_circ'),
            };
        } catch (e) {
            console.error(`Clui CC: glass renderer unavailable: ${e}`);
            this._pipeline = null;
        }
    }

    get available() {
        return this._pipeline !== null;
    }

    _createPipeline(declarations, body, blend) {
        const pipeline = Cogl.Pipeline.new(this._context);
        pipeline.set_layer_wrap_mode(0, Cogl.PipelineWrapMode.CLAMP_TO_EDGE);
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR, Cogl.PipelineFilter.LINEAR);
        pipeline.set_blend(blend);
        const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, declarations, null);
        snippet.set_replace(body);
        pipeline.add_snippet(snippet);
        return pipeline;
    }

    refresh() {
        if (!this.available)
            return;
        try {
            if (this._window && !this._isClientWindow(this._window))
                this._detach();
            if (this._actor)
                return;
            for (const actor of global.get_window_actors()) {
                const window = actor.get_meta_window();
                if (window && this._isClientWindow(window)) {
                    this._attach(window);
                    return;
                }
            }
        } catch (e) {
            console.error(`Clui CC: glass window lookup failed: ${e}`);
        }
    }

    windowCreated(window) {
        if (!this.available || !window)
            return;
        try {
            if (!this._isClientWindow(window) || (this._window === window && this._actor))
                return;
            this._detach();
            this._attach(window);
        } catch (e) {
            console.error(`Clui CC: glass attach failed: ${e}`);
        }
    }

    setRegions(message) {
        if (!this.available)
            return;
        const scale = clamp(finite(message?.scale, 1), 0.25, 8);
        const list = Array.isArray(message?.regions) ? message.regions : [];
        const regions = [];
        const circles = [];
        for (const raw of list) {
            if (regions.length >= MAX_REGIONS)
                break;
            const region = this._parseRegion(raw, circles);
            if (region)
                regions.push(region);
        }
        const key = JSON.stringify([scale, regions, circles]);
        if (key === this._regionsKey && this._actor)
            return;
        this._regionsKey = key;
        this._scale = scale;
        this._regions = regions;
        this._circles = circles;
        this._layout();
        if (!this._actor && this._count > 0)
            this.refresh();
    }

    _parseRegion(raw, circles) {
        if (!raw || typeof raw !== 'object')
            return null;
        const x = finite(raw.x, NaN);
        const y = finite(raw.y, NaN);
        const width = finite(raw.width, NaN);
        const height = finite(raw.height, NaN);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !(width >= 1) || !(height >= 1))
            return null;
        if (Math.abs(x) > 100000 || Math.abs(y) > 100000 || width > 100000 || height > 100000)
            return null;
        const alpha = clamp(finite(raw.alpha, 1), 0, 1);
        if (alpha <= 0.001)
            return null;
        const tint = [0, 0, 0, 0];
        if (Array.isArray(raw.tint) && raw.tint.length === 4) {
            for (let i = 0; i < 4; i++)
                tint[i] = clamp(finite(raw.tint[i], 0), 0, 1);
        }
        const region = {
            id: typeof raw.id === 'string' ? raw.id : '',
            x, y, width, height,
            radius: clamp(finite(raw.radius, 0), 0, Math.min(width, height) / 2),
            alpha,
            tint,
            circleStart: 0,
            circleCount: 0,
        };
        if (Array.isArray(raw.circles) && raw.circles.length > 0) {
            const start = circles.length;
            for (const circle of raw.circles) {
                if (circles.length >= MAX_CIRCLES)
                    break;
                if (!Array.isArray(circle) || circle.length < 3)
                    continue;
                const cx = finite(circle[0], NaN);
                const cy = finite(circle[1], NaN);
                const r = finite(circle[2], NaN);
                if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(r > 0) || Math.abs(cx) > 100000 || Math.abs(cy) > 100000 || r > 100000)
                    continue;
                circles.push([cx, cy, r]);
            }
            region.circleStart = start;
            region.circleCount = circles.length - start;
            if (region.circleCount === 0)
                return null;
        }
        return region;
    }

    _regionBounds(region) {
        const s = this._scale;
        if (region.circleCount === 0) {
            const x = region.x * s + this._offsetX;
            const y = region.y * s + this._offsetY;
            return [x, y, x + region.width * s, y + region.height * s];
        }
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let j = region.circleStart; j < region.circleStart + region.circleCount; j++) {
            const cx = this._circ[j * 4];
            const cy = this._circ[j * 4 + 1];
            const r = this._circ[j * 4 + 2];
            x0 = Math.min(x0, cx - r);
            y0 = Math.min(y0, cy - r);
            x1 = Math.max(x1, cx + r);
            y1 = Math.max(y1, cy + r);
        }
        return [x0, y0, x1, y1];
    }

    _layout() {
        const s = this._scale;
        const p = this._params;
        const regions = this._regions;
        const circles = this._circles;
        this._reg.fill(0);
        this._circ.fill(0);
        for (let i = 0; i < circles.length; i++) {
            const [cx, cy, r] = circles[i];
            this._circ[i * 4] = cx * s + this._offsetX;
            this._circ[i * 4 + 1] = cy * s + this._offsetY;
            this._circ[i * 4 + 2] = r * s;
        }
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < regions.length; i++) {
            const region = regions[i];
            const k = i * 12;
            const bounds = this._regionBounds(region);
            x0 = Math.min(x0, bounds[0]);
            y0 = Math.min(y0, bounds[1]);
            x1 = Math.max(x1, bounds[2]);
            y1 = Math.max(y1, bounds[3]);
            let minDim;
            if (region.circleCount > 0) {
                let radius = 0;
                for (let j = region.circleStart; j < region.circleStart + region.circleCount; j++)
                    radius = Math.max(radius, circles[j][2]);
                minDim = 2 * radius;
                this._reg[k] = region.circleStart;
                this._reg[k + 1] = region.circleCount;
            } else {
                minDim = Math.min(region.width, region.height);
                this._reg[k] = (bounds[0] + bounds[2]) / 2;
                this._reg[k + 1] = (bounds[1] + bounds[3]) / 2;
                this._reg[k + 2] = (bounds[2] - bounds[0]) / 2;
                this._reg[k + 3] = (bounds[3] - bounds[1]) / 2;
            }
            this._reg[k + 4] = region.radius * s;
            this._reg[k + 5] = region.circleCount > 0 ? 1 : 0;
            this._reg[k + 6] = Math.max(Math.min(p.bandFraction * minDim, p.bandMax), 1) * s;
            this._reg[k + 7] = region.alpha;
            this._reg[k + 8] = region.tint[0];
            this._reg[k + 9] = region.tint[1];
            this._reg[k + 10] = region.tint[2];
            this._reg[k + 11] = region.tint[3];
        }
        this._count = regions.length;
        this._shapesDirty = true;
        const previous = this._drawBox;
        if (this._count === 0) {
            this._drawBox = null;
            this._sampleBox = null;
        } else {
            const bulge = p.mergeK * s * 0.25 + 1;
            const drawPad = (p.shadowRadius + Math.abs(p.shadowY)) * s + bulge + 2;
            const samplePad = SAMPLE_MARGIN * s + bulge;
            this._drawBox = this._clampBox([x0 - drawPad, y0 - drawPad, x1 + drawPad, y1 + drawPad]);
            this._sampleBox = this._clampBox([x0 - samplePad, y0 - samplePad, x1 + samplePad, y1 + samplePad]);
            if (!this._drawBox || !this._sampleBox) {
                this._drawBox = null;
                this._sampleBox = null;
            }
        }
        this._applyVisibility();
        this._placeArea();
        this._queueBoxes(previous, this._drawBox);
        const synced = this._syncedBox;
        const box = this._sampleBox;
        if (box && !(synced && box[0] >= synced[0] && box[1] >= synced[1] && box[2] <= synced[2] && box[3] <= synced[3]))
            this._markSources();
    }

    _clampBox(box) {
        let [x0, y0, x1, y1] = box;
        x0 = Math.floor(x0);
        y0 = Math.floor(y0);
        x1 = Math.ceil(x1);
        y1 = Math.ceil(y1);
        const actor = this._actor;
        if (actor) {
            const w = actor.width;
            const h = actor.height;
            if (w >= 1 && h >= 1) {
                x0 = clamp(x0, 0, w);
                y0 = clamp(y0, 0, h);
                x1 = clamp(x1, 0, w);
                y1 = clamp(y1, 0, h);
            }
        }
        if (!(x1 - x0 >= 1) || !(y1 - y0 >= 1))
            return null;
        return [x0, y0, x1, y1];
    }

    _queueBoxes(a, b) {
        let box = a ?? b;
        if (!box)
            return;
        if (a && b)
            box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        this._queueBox(box);
    }

    _queueBox(box) {
        const actor = this._actor;
        if (!actor || !actor.mapped || !box)
            return;
        try {
            const rect = new Mtk.Rectangle({x: box[0], y: box[1], width: Math.max(box[2] - box[0], 1), height: Math.max(box[3] - box[1], 1)});
            actor.queue_redraw_with_clip(rect);
        } catch (e) {
            console.error(`Clui CC: glass redraw failed: ${e}`);
        }
    }

    _applyVisibility() {
        const actor = this._actor;
        if (!actor)
            return;
        const visible = this._count > 0 && this._drawBox !== null;
        if (actor.visible !== visible)
            actor.visible = visible;
        if (visible && this._watchSignals.length === 0)
            this._watch();
        else if (!visible && this._watchSignals.length > 0)
            this._unwatch();
    }

    _placeArea() {
        const area = this._area;
        const box = this._sampleBox;
        if (!area || !box)
            return;
        const sx = (box[2] - box[0]) / RELAY_BASE;
        const sy = (box[3] - box[1]) / RELAY_BASE;
        if (area.translation_x !== box[0] || area.translation_y !== box[1])
            area.set_translation(box[0], box[1], 0);
        if (area.scale_x !== sx || area.scale_y !== sy)
            area.set_scale(sx, sy);
    }

    _attach(window) {
        const windowActor = window.get_compositor_private();
        if (!windowActor)
            return;
        try {
            const actor = new GlassActor({name: 'clui-glass', reactive: false, visible: false});
            actor._owner = this;
            this._window = window;
            this._windowActor = windowActor;
            this._actor = actor;
            Shell.util_set_hidden_from_pick(actor, true);
            const area = new Clutter.Actor({name: 'clui-glass-relays', reactive: false, width: RELAY_BASE, height: RELAY_BASE});
            actor.add_child(area);
            this._area = area;
            const connect = (object, name, handler) => this._windowSignals.push([object, object.connect(name, handler)]);
            connect(windowActor, 'destroy', () => this._detach());
            connect(actor, 'destroy', () => this._detach());
            connect(windowActor, 'notify::width', () => this._syncSize());
            connect(windowActor, 'notify::height', () => this._syncSize());
            windowActor.insert_child_at_index(actor, 0);
            this._syncSize(true);
        } catch (e) {
            console.error(`Clui CC: glass attach failed: ${e}`);
            this._detach();
        }
    }

    _syncSize(force = false) {
        const actor = this._actor;
        const window = this._window;
        if (!actor || !window)
            return;
        try {
            const buffer = window.get_buffer_rect();
            let offsetX = 0;
            let offsetY = 0;
            try {
                const client = window.frame_rect_to_client_rect(window.get_frame_rect());
                offsetX = client.x - buffer.x;
                offsetY = client.y - buffer.y;
            } catch {}
            const width = Math.max(buffer.width, 1);
            const height = Math.max(buffer.height, 1);
            if (!force && actor.width === width && actor.height === height && offsetX === this._offsetX && offsetY === this._offsetY)
                return;
            actor.set_position(0, 0);
            actor.set_size(width, height);
            this._offsetX = offsetX;
            this._offsetY = offsetY;
            this._invalidateCopies();
            this._layout();
        } catch (e) {
            console.error(`Clui CC: glass resize failed: ${e}`);
        }
    }

    _invalidateCopies() {
        for (const record of this._views.values()) {
            if (record.copy)
                record.copy.valid = false;
        }
        this._lastCopy = null;
    }

    _watch() {
        const connect = (object, name, handler) => this._watchSignals.push([object, object.connect(name, handler)]);
        const mark = () => this._markSources();
        try {
            connect(global.display, 'restacked', mark);
            const group = this._windowActor?.get_parent();
            if (group) {
                connect(group, 'child-added', mark);
                connect(group, 'child-removed', mark);
            }
            if (this._window) {
                connect(this._window, 'position-changed', mark);
                connect(this._window, 'size-changed', mark);
            }
            if (this._windowActor)
                connect(this._windowActor, 'notify::mapped', mark);
            connect(Main.layoutManager, 'monitors-changed', () => {
                this._views.clear();
                this._lastCopy = null;
                this._markSources();
            });
        } catch (e) {
            console.error(`Clui CC: glass watch failed: ${e}`);
        }
        this._markSources();
    }

    _unwatch() {
        disconnectAll(this._watchSignals);
        this._dropBeforeUpdate();
        this._sourcesDirty = false;
        this._syncedBox = null;
        for (const signals of this._sourceSignals.values())
            disconnectAll(signals);
        this._sourceSignals.clear();
        for (const relay of this._relays.values()) {
            if (relay.visible)
                relay.visible = false;
        }
        this._views.clear();
        this._lastCopy = null;
        this._boundCopy = null;
    }

    _markSources() {
        if (!this._actor || this._watchSignals.length === 0)
            return;
        this._sourcesDirty = true;
        if (!this._beforeUpdateId)
            this._beforeUpdateId = global.stage.connect('before-update', () => this._onBeforeUpdate());
    }

    _dropBeforeUpdate() {
        if (this._beforeUpdateId)
            global.stage.disconnect(this._beforeUpdateId);
        this._beforeUpdateId = 0;
    }

    _onBeforeUpdate() {
        this._dropBeforeUpdate();
        if (!this._sourcesDirty || !this._actor?.mapped)
            return;
        this._sourcesDirty = false;
        this._sync();
    }

    _detach() {
        this._unwatch();
        disconnectAll(this._windowSignals);
        const actor = this._actor;
        this._actor = null;
        this._area = null;
        this._window = null;
        this._windowActor = null;
        this._relays.clear();
        this._views.clear();
        this._lastCopy = null;
        this._boundCopy = null;
        this._allocFailedAt = 0;
        this._opacity = -1;
        this._frameKey[0] = NaN;
        this._cancelRefresh();
        this._cancelAutoTone();
        this._finishTone(null);
        if (actor) {
            actor._owner = null;
            try {
                actor.destroy();
            } catch {}
        }
    }

    reset() {
        this._detach();
        this._regionsKey = '';
        this._regions = [];
        this._circles = [];
        this._layout();
    }

    destroy() {
        this.reset();
        this._pipeline = null;
        this._tonePipeline = null;
        this._toneTarget = null;
        this._context = null;
    }

    _scheduleRefresh() {
        if (this._refreshId || this._refreshStreak >= REFRESH_LIMIT)
            return;
        this._refreshStreak++;
        this._refreshId = GLib.idle_add(GLib.PRIORITY_HIGH_IDLE, () => {
            this._refreshId = 0;
            this._queueBox(this._sampleBox);
            return GLib.SOURCE_REMOVE;
        });
    }

    _noteBackdropChange() {
        if (this._autoToneId)
            return;
        const cooldown = Math.ceil((this._toneDoneAt + TONE_COOLDOWN_US - GLib.get_monotonic_time()) / 1000);
        this._autoToneId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(TONE_AUTO_MS, cooldown), () => {
            this._autoToneId = 0;
            try {
                if (!this._tone && this._actor?.mapped && this._count > 0)
                    this.sample(1);
            } catch (e) {
                console.error(`Clui CC: glass auto tone failed: ${e}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelAutoTone() {
        if (this._autoToneId)
            GLib.source_remove(this._autoToneId);
        this._autoToneId = 0;
    }

    _cancelRefresh() {
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = 0;
        this._refreshStreak = 0;
    }

    _sync() {
        const actor = this._actor;
        const area = this._area;
        const box = this._sampleBox;
        if (!actor || !area || !box || !this._window)
            return;
        this._syncedBox = [box[0] - RELAY_KEEP, box[1] - RELAY_KEEP, box[2] + RELAY_KEEP, box[3] + RELAY_KEEP];
        let changed = false;
        try {
            const buffer = this._window.get_buffer_rect();
            const near = [buffer.x + box[0], buffer.y + box[1], buffer.x + box[2], buffer.y + box[3]];
            const keep = [near[0] - RELAY_KEEP, near[1] - RELAY_KEEP, near[2] + RELAY_KEEP, near[3] + RELAY_KEEP];
            const sources = [];
            let child = actor;
            let parent = child.get_parent();
            while (parent) {
                for (let source = parent.get_first_child(); source && source !== child; source = source.get_next_sibling())
                    sources.push(source);
                child = parent;
                parent = parent.get_parent();
            }
            const present = new Set(sources);
            for (const [source, signals] of this._sourceSignals) {
                if (present.has(source))
                    continue;
                disconnectAll(signals);
                this._sourceSignals.delete(source);
            }
            for (const source of sources) {
                if (!this._sourceSignals.has(source))
                    this._sourceSignals.set(source, this._watchSource(source));
                let relay = this._relays.get(source);
                const mapped = source.mapped;
                const wanted = mapped && this._reaches(source, relay?.visible ? keep : near);
                if (!relay) {
                    if (!wanted)
                        continue;
                    relay = new GlassRelay({source, opacity: 0, reactive: false, width: RELAY_BASE, height: RELAY_BASE});
                    area.add_child(relay);
                    this._relays.set(source, relay);
                    changed = true;
                } else if (relay.visible !== wanted) {
                    relay.visible = wanted;
                    changed = true;
                }
            }
            for (const [source, relay] of this._relays) {
                if (present.has(source))
                    continue;
                this._relays.delete(source);
                try {
                    relay.destroy();
                } catch {}
                changed = true;
            }
        } catch (e) {
            console.error(`Clui CC: glass relay sync failed: ${e}`);
            changed = true;
        }
        if (changed)
            this._queueBox(box);
    }

    _watchSource(source) {
        const signals = [];
        const mark = () => this._markSources();
        try {
            signals.push([source, source.connect('notify::mapped', mark)]);
            signals.push([source, source.connect('destroy', () => {
                const list = this._sourceSignals.get(source);
                if (list) {
                    disconnectAll(list);
                    this._sourceSignals.delete(source);
                }
                this._markSources();
            })]);
            if (source instanceof Meta.WindowActor) {
                const window = source.get_meta_window();
                if (window) {
                    signals.push([window, window.connect('position-changed', mark)]);
                    signals.push([window, window.connect('size-changed', mark)]);
                }
            }
        } catch (e) {
            console.error(`Clui CC: glass source watch failed: ${e}`);
        }
        return signals;
    }

    _reaches(source, area) {
        if (!(source instanceof Meta.WindowActor))
            return true;
        try {
            const window = source.get_meta_window();
            if (!window)
                return true;
            const r = window.get_buffer_rect();
            return r.x - WINDOW_REACH < area[2] && r.x + r.width + WINDOW_REACH > area[0] &&
                r.y - WINDOW_REACH < area[3] && r.y + r.height + WINDOW_REACH > area[1];
        } catch {
            return true;
        }
    }

    _paintFailed(e) {
        this._paintErrors++;
        if (this._paintErrors <= 3)
            console.error(`Clui CC: glass paint failed: ${e}`);
    }

    _viewRecord(actor, framebuffer) {
        if (actor.is_in_clone_paint())
            return null;
        const cached = this._views.get(framebuffer);
        if (cached)
            return cached;
        for (const view of actor.peek_stage_views()) {
            if (view.get_framebuffer() !== framebuffer)
                continue;
            const layout = view.layout;
            const record = {
                framebuffer,
                fbWidth: framebuffer.get_width(),
                fbHeight: framebuffer.get_height(),
                colorState: view.color_state,
                x: layout.x,
                y: layout.y,
                width: layout.width,
                height: layout.height,
                scale: view.get_scale(),
                copy: null,
            };
            this._views.set(framebuffer, record);
            return record;
        }
        return null;
    }

    _target(record, width, height) {
        const copy = record.copy;
        if (copy && copy.capW >= width && copy.capH >= height)
            return copy;
        if (this._allocFailedAt && GLib.get_monotonic_time() - this._allocFailedAt < ALLOC_RETRY_US)
            return null;
        this._allocFailedAt = 0;
        const capW = Math.max(Math.ceil(width / CAPACITY_STEP) * CAPACITY_STEP, copy?.capW ?? 0, 1);
        const capH = Math.max(Math.ceil(height / CAPACITY_STEP) * CAPACITY_STEP, copy?.capH ?? 0, 1);
        try {
            const texture = Cogl.Texture2D.new_with_size(this._context, capW, capH);
            if (!texture)
                throw new Error('texture');
            const framebuffer = Cogl.Offscreen.new_with_texture(texture);
            framebuffer.allocate();
            record.copy = {texture, framebuffer, capW, capH, valid: false, fx: 0, fy: 0, fw: 0, fh: 0, lx: 0, ly: 0, scale: 1};
        } catch (e) {
            this._allocFailedAt = GLib.get_monotonic_time();
            console.error(`Clui CC: glass capture ${capW}x${capH} unavailable: ${e}`);
            return null;
        }
        if (this._lastCopy === copy)
            this._lastCopy = null;
        return record.copy;
    }

    _capture(record, root, paintContext, framebuffer, ox, oy, sx, sy, aw, ah) {
        const box = this._sampleBox;
        const scale = record.scale;
        const X0 = Math.max(ox + box[0] * sx, record.x);
        const Y0 = Math.max(oy + box[1] * sy, record.y);
        const X1 = Math.min(ox + box[2] * sx, record.x + record.width);
        const Y1 = Math.min(oy + box[3] * sy, record.y + record.height);
        if (!(X1 > X0) || !(Y1 > Y0))
            return false;
        const viewW = record.fbWidth;
        const viewH = record.fbHeight;
        const fx0 = clamp(Math.floor((X0 - record.x) * scale), 0, viewW);
        const fy0 = clamp(Math.floor((Y0 - record.y) * scale), 0, viewH);
        const fw = clamp(Math.ceil((X1 - record.x) * scale), 0, viewW) - fx0;
        const fh = clamp(Math.ceil((Y1 - record.y) * scale), 0, viewH) - fy0;
        if (fw < 1 || fh < 1)
            return false;
        const clip = paintContext.get_redraw_clip();
        if (clip) {
            const key = this._clipKey;
            const cx = Math.floor(X0);
            const cy = Math.floor(Y0);
            const cw = Math.max(Math.ceil(X1) - cx, 1);
            const ch = Math.max(Math.ceil(Y1) - cy, 1);
            if (key[0] !== cx || key[1] !== cy || key[2] !== cw || key[3] !== ch) {
                this._clipRect = new Mtk.Rectangle({x: cx, y: cy, width: cw, height: ch});
                key[0] = cx;
                key[1] = cy;
                key[2] = cw;
                key[3] = ch;
            }
            if (clip.contains_rectangle(this._clipRect) !== Mtk.RegionOverlap.IN)
                return record.copy?.valid ? record.copy : null;
        }
        const needW = clamp(Math.ceil(aw * sx * scale) + 2, fw, Math.max(viewW, fw));
        const needH = clamp(Math.ceil(ah * sy * scale) + 2, fh, Math.max(viewH, fh));
        const copy = this._target(record, needW, needH);
        if (!copy)
            return null;
        const node = Clutter.RootNode.new(copy.framebuffer, record.colorState, this._clearColor, 0);
        const blit = Clutter.BlitNode.new(framebuffer);
        blit.add_blit_rectangle(fx0, fy0, 0, 0, fw, fh);
        node.add_child(blit);
        root.add_child(node);
        copy.valid = true;
        copy.fresh = true;
        copy.fx = fx0;
        copy.fy = fy0;
        copy.fw = fw;
        copy.fh = fh;
        copy.lx = record.x;
        copy.ly = record.y;
        copy.scale = scale;
        this._lastCopy = copy;
        this._refreshStreak = 0;
        return copy;
    }

    _paint(actor, root, paintContext) {
        if (this._count === 0 || !this._pipeline || !this._drawBox || !this._sampleBox)
            return;
        const aw = actor.width;
        const ah = actor.height;
        if (!(aw >= 1) || !(ah >= 1))
            return;
        const [ox, oy] = actor.get_transformed_position();
        const [tw, th] = actor.get_transformed_size();
        const sx = tw / aw;
        const sy = th / ah;
        if (!(sx > 0) || !(sy > 0))
            return;
        const framebuffer = paintContext.get_framebuffer();
        const record = this._viewRecord(actor, framebuffer);
        let copy;
        if (record) {
            if (record.copy)
                record.copy.fresh = false;
            copy = this._capture(record, root, paintContext, framebuffer, ox, oy, sx, sy, aw, ah);
            if (copy === false)
                return;
            if (!copy) {
                this._scheduleRefresh();
                return;
            }
        } else {
            copy = this._lastCopy;
            if (!copy?.valid)
                return;
        }
        this._draw(actor, root, copy, ox, oy, sx, sy);
        if (record && copy.fresh && this._tone?.pending)
            this._renderTone(root, copy, record, ox, oy, sx, sy);
        else if (record && copy.fresh)
            this._noteBackdropChange();
    }

    _uploadParams() {
        const p = this._params;
        const power = Math.max(p.power, 1);
        this._paramData.set([
            clamp(p.amplitude, 0, 0.95 / power), power, p.bezel, p.ior,
            p.dispersion, p.lift, p.saturation, p.shade,
            p.lightX, p.lightY, p.keyLight, p.fillLight,
            p.rimFloor, p.fresnel, p.highlightTint, 0,
            p.shadowAlpha, p.shadowRadius, p.shadowY, 0,
            p.mergeK, p.blobK, 0, 0,
        ]);
        this._pipeline.set_uniform_float(this._locations.params, 4, 6, this._paramData);
        this._paramsDirty = false;
    }

    _draw(actor, root, copy, ox, oy, sx, sy) {
        const pipeline = this._pipeline;
        if (this._paramsDirty)
            this._uploadParams();
        if (this._shapesDirty) {
            pipeline.set_uniform_float(this._locations.reg, 4, MAX_REGIONS * 3, this._reg);
            pipeline.set_uniform_float(this._locations.circ, 4, MAX_CIRCLES, this._circ);
            this._shapesDirty = false;
            this._frameKey[0] = NaN;
        }
        const box = this._drawBox;
        const key = this._frameKey;
        const scale = copy.scale;
        if (key[0] !== this._count || key[1] !== ox || key[2] !== oy || key[3] !== sx || key[4] !== sy ||
            key[5] !== copy.fx || key[6] !== copy.fy || key[7] !== copy.fw || key[8] !== copy.fh ||
            key[9] !== copy.lx || key[10] !== copy.ly || key[11] !== scale || key[12] !== copy.capW * 65536 + copy.capH ||
            this._boundCopy !== copy) {
            key[0] = this._count;
            key[1] = ox;
            key[2] = oy;
            key[3] = sx;
            key[4] = sy;
            key[5] = copy.fx;
            key[6] = copy.fy;
            key[7] = copy.fw;
            key[8] = copy.fh;
            key[9] = copy.lx;
            key[10] = copy.ly;
            key[11] = scale;
            key[12] = copy.capW * 65536 + copy.capH;
            const cw = copy.capW;
            const ch = copy.capH;
            const f = this._frame;
            f[0] = box[0];
            f[1] = box[1];
            f[2] = box[2] - box[0];
            f[3] = box[3] - box[1];
            f[4] = sx * scale / cw;
            f[5] = sy * scale / ch;
            f[6] = ((ox - copy.lx) * scale - copy.fx) / cw;
            f[7] = ((oy - copy.ly) * scale - copy.fy) / ch;
            f[8] = 0.5 / cw;
            f[9] = 0.5 / ch;
            f[10] = (copy.fw - 0.5) / cw;
            f[11] = (copy.fh - 0.5) / ch;
            f[12] = Math.max(sx, sy) * scale;
            f[13] = this._scale;
            f[14] = this._count;
            f[15] = 0;
            pipeline.set_uniform_float(this._locations.frame, 4, 4, f);
            if (this._boundCopy !== copy) {
                pipeline.set_layer_texture(0, copy.texture);
                this._boundCopy = copy;
            }
        }
        const opacity = actor.get_paint_opacity();
        if (opacity !== this._opacity) {
            const o = opacity / 255;
            this._color.init_from_4f(o, o, o, o);
            pipeline.set_color(this._color);
            this._opacity = opacity;
        }
        const b = this._box;
        if (b.x1 !== box[0] || b.y1 !== box[1] || b.x2 !== box[2] || b.y2 !== box[3])
            this._box = new Clutter.ActorBox({x1: box[0], y1: box[1], x2: box[2], y2: box[3]});
        const node = new Clutter.PipelineNode(pipeline);
        node.add_texture_rectangle(this._box, 0, 0, 1, 1);
        root.add_child(node);
    }

    sample(replies = 1) {
        if (this._tone) {
            this._tone.again += replies;
            return;
        }
        if (!this._pipeline || !this._actor || !this._actor.mapped || this._count === 0 || !this._sampleBox) {
            for (let i = 0; i < replies; i++)
                this._send({type: 'tone', luminance: null});
            return;
        }
        const tone = {pending: true, replies, again: 0, timeoutId: 0, idleId: 0};
        this._tone = tone;
        tone.timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TONE_TIMEOUT_MS, () => {
            tone.timeoutId = 0;
            if (this._tone === tone)
                this._finishTone(null);
            return GLib.SOURCE_REMOVE;
        });
        this._queueBox(this._sampleBox);
    }

    _ensureToneTarget() {
        if (this._toneTarget && this._tonePipeline)
            return true;
        const texture = Cogl.Texture2D.new_with_size(this._context, TONE_SIZE, TONE_SIZE);
        if (!texture)
            return false;
        const framebuffer = Cogl.Offscreen.new_with_texture(texture);
        framebuffer.allocate();
        framebuffer.orthographic(0, 0, TONE_SIZE, TONE_SIZE, -1, 1);
        const pipeline = this._createPipeline(TONE_DECLARATIONS, TONE_BODY, BLEND_COPY);
        this._toneLocations = {
            step: pipeline.get_uniform_location('u_step'),
            clamp: pipeline.get_uniform_location('u_clamp'),
        };
        this._tonePipeline = pipeline;
        this._toneTarget = {texture, framebuffer};
        return true;
    }

    _renderTone(root, copy, record, ox, oy, sx, sy) {
        const tone = this._tone;
        const regions = this._regions;
        const region = regions.find(r => r.id === 'card') ?? regions[0];
        if (!region) {
            this._finishTone(null);
            return;
        }
        try {
            if (!this._ensureToneTarget()) {
                this._finishTone(null);
                return;
            }
        } catch (e) {
            console.error(`Clui CC: glass tone target unavailable: ${e}`);
            this._finishTone(null);
            return;
        }
        const rect = this._regionBounds(region);
        const scale = copy.scale;
        const cw = copy.capW;
        const ch = copy.capH;
        const u0 = clamp(((ox + rect[0] * sx - copy.lx) * scale - copy.fx) / cw, 0, copy.fw / cw);
        const v0 = clamp(((oy + rect[1] * sy - copy.ly) * scale - copy.fy) / ch, 0, copy.fh / ch);
        const u1 = clamp(((ox + rect[2] * sx - copy.lx) * scale - copy.fx) / cw, 0, copy.fw / cw);
        const v1 = clamp(((oy + rect[3] * sy - copy.ly) * scale - copy.fy) / ch, 0, copy.fh / ch);
        if (!(u1 > u0) || !(v1 > v0)) {
            this._finishTone(null);
            return;
        }
        const pipeline = this._tonePipeline;
        pipeline.set_layer_texture(0, copy.texture);
        const v = this._vec;
        v[0] = (u1 - u0) / TONE_SIZE / 4;
        v[1] = (v1 - v0) / TONE_SIZE / 4;
        v[2] = 0;
        v[3] = 0;
        pipeline.set_uniform_float(this._toneLocations.step, 4, 1, v);
        v[0] = u0;
        v[1] = v0;
        v[2] = u1;
        v[3] = v1;
        pipeline.set_uniform_float(this._toneLocations.clamp, 4, 1, v);
        const node = Clutter.RootNode.new(this._toneTarget.framebuffer, record.colorState, this._clearColor, 0);
        const draw = new Clutter.PipelineNode(pipeline);
        draw.add_texture_rectangle(new Clutter.ActorBox({x1: 0, y1: 0, x2: TONE_SIZE, y2: TONE_SIZE}), u0, v0, u1, v1);
        node.add_child(draw);
        root.add_child(node);
        tone.pending = false;
        tone.idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            tone.idleId = 0;
            this._readTone(tone);
            return GLib.SOURCE_REMOVE;
        });
    }

    _readTone(tone) {
        if (this._tone !== tone || !this._toneTarget)
            return;
        try {
            this._toneTarget.framebuffer.flush();
            const stream = Gio.MemoryOutputStream.new_resizable();
            Shell.Screenshot.composite_to_stream(this._toneTarget.texture, 0, 0, TONE_SIZE, TONE_SIZE, 1, null, 0, 0, 1, stream, (_source, result) => {
                let luminance = null;
                try {
                    const pixbuf = Shell.Screenshot.composite_to_stream_finish(result);
                    luminance = pixbuf ? this._luminance(pixbuf) : null;
                } catch (e) {
                    console.error(`Clui CC: glass tone readback failed: ${e}`);
                }
                try {
                    stream.close(null);
                } catch {}
                if (this._tone === tone)
                    this._finishTone(luminance);
            });
        } catch (e) {
            console.error(`Clui CC: glass tone readback failed: ${e}`);
            this._finishTone(null);
        }
    }

    _luminance(pixbuf) {
        const pixels = pixbuf.get_pixels();
        const channels = pixbuf.get_n_channels();
        const stride = pixbuf.get_rowstride();
        const hasAlpha = pixbuf.get_has_alpha();
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();
        let total = 0;
        let count = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = y * stride + x * channels;
                if (hasAlpha && pixels[i + 3] === 0)
                    continue;
                total += 0.2126 * linear(pixels[i]) + 0.7152 * linear(pixels[i + 1]) + 0.0722 * linear(pixels[i + 2]);
                count++;
            }
        }
        return count > 0 ? total / count : null;
    }

    _finishTone(luminance) {
        const tone = this._tone;
        if (!tone)
            return;
        this._tone = null;
        this._toneDoneAt = GLib.get_monotonic_time();
        if (tone.timeoutId)
            GLib.source_remove(tone.timeoutId);
        if (tone.idleId)
            GLib.source_remove(tone.idleId);
        const value = Number.isFinite(luminance) ? luminance : null;
        for (let i = 0; i < tone.replies; i++)
            this._send({type: 'tone', luminance: value});
        if (tone.again > 0)
            this.sample(tone.again);
    }
}
