#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <cmath>
#include <string>
#include <vector>

static char kGlassStateKey;
static char kActiveAppearanceKey;
static const uint32_t kMaxRegions = 32;
static const uint32_t kMaxSubpaths = 8;
static const uint32_t kMaxPathValues = 2048;

@interface CluiGlassHostView : NSView
@end

@implementation CluiGlassHostView
- (BOOL)isFlipped {
  return YES;
}
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

@interface CluiGlassState : NSObject
@property(strong) NSView *container;
@property(strong) CluiGlassHostView *host;
@property(strong) NSMutableDictionary<NSString *, NSView *> *views;
@property(strong) NSMutableSet<NSString *> *pathed;
@end

@implementation CluiGlassState
@end

struct GlassRegion {
  std::string id;
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
  double radius = 0;
  double alpha = 1;
  int32_t style = 0;
  int32_t appearance = 0;
  int32_t variant = -1;
  int32_t adaptive = -1;
  bool hasTint = false;
  double tint[4] = {0, 0, 0, 0};
  std::vector<std::vector<double>> paths;
};

static bool GlassAvailable() {
  if (@available(macOS 26.0, *)) {
    return NSClassFromString(@"NSGlassEffectView") != nil && NSClassFromString(@"NSGlassEffectContainerView") != nil;
  }
  return false;
}

static napi_value Undefined(napi_env env) {
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

static bool ReadNumber(napi_env env, napi_value object, const char *name, double *out) {
  napi_value value;
  napi_valuetype type;
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return false;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return false;
  if (napi_get_value_double(env, value, out) != napi_ok) return false;
  return std::isfinite(*out);
}

static bool ReadRegion(napi_env env, napi_value object, GlassRegion *region) {
  napi_valuetype type;
  if (napi_typeof(env, object, &type) != napi_ok || type != napi_object) return false;

  napi_value idValue;
  if (napi_get_named_property(env, object, "id", &idValue) != napi_ok) return false;
  if (napi_typeof(env, idValue, &type) != napi_ok || type != napi_string) return false;
  char buffer[64];
  size_t length = 0;
  if (napi_get_value_string_utf8(env, idValue, buffer, sizeof(buffer), &length) != napi_ok || length == 0) return false;
  region->id.assign(buffer, length);

  if (!ReadNumber(env, object, "x", &region->x)) return false;
  if (!ReadNumber(env, object, "y", &region->y)) return false;
  if (!ReadNumber(env, object, "width", &region->width)) return false;
  if (!ReadNumber(env, object, "height", &region->height)) return false;
  if (!ReadNumber(env, object, "radius", &region->radius)) return false;
  if (!ReadNumber(env, object, "alpha", &region->alpha)) return false;
  double style = 0;
  if (ReadNumber(env, object, "style", &style)) region->style = style >= 1 ? 1 : 0;
  double appearance = 0;
  if (ReadNumber(env, object, "appearance", &appearance)) region->appearance = appearance >= 2 ? 2 : (appearance >= 1 ? 1 : 0);
  double variant = -1;
  if (ReadNumber(env, object, "variant", &variant)) region->variant = variant >= 0 && variant <= 32 ? static_cast<int32_t>(variant) : -1;
  double adaptive = -1;
  if (ReadNumber(env, object, "adaptive", &adaptive)) region->adaptive = adaptive >= 0 && adaptive <= 2 ? static_cast<int32_t>(adaptive) : -1;

  napi_value tintValue;
  bool isArray = false;
  if (napi_get_named_property(env, object, "tint", &tintValue) == napi_ok &&
      napi_is_array(env, tintValue, &isArray) == napi_ok && isArray) {
    uint32_t count = 0;
    napi_get_array_length(env, tintValue, &count);
    if (count == 4) {
      region->hasTint = true;
      for (uint32_t i = 0; i < 4; i++) {
        napi_value component;
        double number = 0;
        if (napi_get_element(env, tintValue, i, &component) != napi_ok ||
            napi_get_value_double(env, component, &number) != napi_ok || !std::isfinite(number)) {
          region->hasTint = false;
          break;
        }
        region->tint[i] = fmin(1.0, fmax(0.0, number));
      }
    }
  }

  napi_value pathsValue;
  if (napi_get_named_property(env, object, "paths", &pathsValue) == napi_ok &&
      napi_is_array(env, pathsValue, &isArray) == napi_ok && isArray) {
    uint32_t pathCount = 0;
    napi_get_array_length(env, pathsValue, &pathCount);
    if (pathCount > kMaxSubpaths) pathCount = kMaxSubpaths;
    for (uint32_t p = 0; p < pathCount; p++) {
      napi_value pointsValue;
      bool pointsIsArray = false;
      if (napi_get_element(env, pathsValue, p, &pointsValue) != napi_ok ||
          napi_is_array(env, pointsValue, &pointsIsArray) != napi_ok || !pointsIsArray) continue;
      uint32_t valueCount = 0;
      napi_get_array_length(env, pointsValue, &valueCount);
      if (valueCount < 6 || valueCount > kMaxPathValues || valueCount % 2 != 0) continue;
      std::vector<double> points;
      points.reserve(valueCount);
      for (uint32_t i = 0; i < valueCount; i++) {
        napi_value component;
        double number = 0;
        if (napi_get_element(env, pointsValue, i, &component) != napi_ok ||
            napi_get_value_double(env, component, &number) != napi_ok || !std::isfinite(number)) break;
        points.push_back(number);
      }
      if (points.size() == valueCount) region->paths.push_back(std::move(points));
    }
  }
  return true;
}

static void ApplyPath(CluiGlassState *state, NSString *key, NSView *glass, const GlassRegion &region) {
  SEL pathSelector = NSSelectorFromString(@"_setPath:");
  if (![glass respondsToSelector:pathSelector]) return;
  if (region.paths.empty()) {
    if (![state.pathed containsObject:key]) return;
    ((void (*)(id, SEL, CGPathRef))objc_msgSend)(glass, pathSelector, NULL);
    [state.pathed removeObject:key];
    return;
  }
  double height = fmax(0, region.height);
  bool flipped = glass.isFlipped;
  CGMutablePathRef path = CGPathCreateMutable();
  if (!path) return;
  for (const std::vector<double> &points : region.paths) {
    CGPathMoveToPoint(path, NULL, points[0], flipped ? points[1] : height - points[1]);
    for (size_t i = 2; i + 1 < points.size(); i += 2) {
      CGPathAddLineToPoint(path, NULL, points[i], flipped ? points[i + 1] : height - points[i + 1]);
    }
    CGPathCloseSubpath(path);
  }
  ((void (*)(id, SEL, CGPathRef))objc_msgSend)(glass, pathSelector, path);
  CGPathRelease(path);
  [state.pathed addObject:key];
}

static NSView *ContentViewFromHandle(napi_env env, napi_value handle) {
  bool isBuffer = false;
  if (napi_is_buffer(env, handle, &isBuffer) != napi_ok || !isBuffer) return nil;
  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, handle, &data, &length) != napi_ok || length < sizeof(void *)) return nil;
  void *pointer = *static_cast<void **>(data);
  if (!pointer) return nil;
  NSView *view = (__bridge NSView *)pointer;
  NSWindow *window = view.window;
  return window && window.contentView ? window.contentView : view;
}

static void KeepActiveAppearance(NSWindow *window) {
  if (!window || objc_getAssociatedObject(window, &kActiveAppearanceKey)) return;
  objc_setAssociatedObject(window, &kActiveAppearanceKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  static NSMutableSet<NSString *> *patchedClasses;
  if (!patchedClasses) patchedClasses = [NSMutableSet set];
  Class windowClass = object_getClass(window);
  NSString *className = NSStringFromClass(windowClass);
  if (![patchedClasses containsObject:className]) {
    [patchedClasses addObject:className];
    for (NSString *name in @[ @"_hasActiveAppearance", @"_hasActiveAppearanceIgnoringKeyFocus" ]) {
      SEL selector = NSSelectorFromString(name);
      Method existing = class_getInstanceMethod(windowClass, selector);
      if (!existing) continue;
      BOOL (*original)(id, SEL) = (BOOL (*)(id, SEL))method_getImplementation(existing);
      IMP replacement = imp_implementationWithBlock(^BOOL(id target) {
        if (objc_getAssociatedObject(target, &kActiveAppearanceKey)) return YES;
        return original(target, selector);
      });
      if (!class_addMethod(windowClass, selector, replacement, method_getTypeEncoding(existing))) {
        method_setImplementation(existing, replacement);
      }
    }
  }
  SEL refresh = NSSelectorFromString(@"_setHasActiveAppearance:");
  if ([window respondsToSelector:refresh]) ((void (*)(id, SEL, BOOL))objc_msgSend)(window, refresh, YES);
}

API_AVAILABLE(macos(26.0))
static CluiGlassState *StateForView(NSView *content, bool create) {
  CluiGlassState *state = objc_getAssociatedObject(content, &kGlassStateKey);
  if (!state && create) {
    NSGlassEffectContainerView *container = [[NSGlassEffectContainerView alloc] initWithFrame:content.bounds];
    container.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    container.spacing = 12;
    CluiGlassHostView *host = [[CluiGlassHostView alloc] initWithFrame:container.bounds];
    host.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    container.contentView = host;
    state = [[CluiGlassState alloc] init];
    state.container = container;
    state.host = host;
    state.views = [NSMutableDictionary dictionary];
    state.pathed = [NSMutableSet set];
    objc_setAssociatedObject(content, &kGlassStateKey, state, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    KeepActiveAppearance(content.window);
  }
  if (state && content.subviews.firstObject != state.container) {
    [state.container removeFromSuperview];
    [content addSubview:state.container positioned:NSWindowBelow relativeTo:nil];
    state.container.frame = content.bounds;
  }
  return state;
}

static napi_value IsSupported(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_get_boolean(env, GlassAvailable(), &result);
  return result;
}

static napi_value SetRegions(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 2) return Undefined(env);
  if (!GlassAvailable()) return Undefined(env);

  bool isArray = false;
  if (napi_is_array(env, argv[1], &isArray) != napi_ok || !isArray) return Undefined(env);
  uint32_t count = 0;
  napi_get_array_length(env, argv[1], &count);
  if (count > kMaxRegions) count = kMaxRegions;

  NSView *content = ContentViewFromHandle(env, argv[0]);
  if (!content) return Undefined(env);

  if (@available(macOS 26.0, *)) {
    CluiGlassState *state = StateForView(content, count > 0);
    if (!state) return Undefined(env);

    NSMutableSet<NSString *> *seen = [NSMutableSet set];
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    for (uint32_t i = 0; i < count; i++) {
      napi_value item;
      if (napi_get_element(env, argv[1], i, &item) != napi_ok) continue;
      GlassRegion region;
      if (!ReadRegion(env, item, &region)) continue;
      NSString *key = [NSString stringWithUTF8String:region.id.c_str()];
      if (!key) continue;
      [seen addObject:key];

      NSGlassEffectView *glass = (NSGlassEffectView *)state.views[key];
      if (!glass) {
        glass = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
        [state.host addSubview:glass];
        state.views[key] = glass;
      }
      glass.frame = NSMakeRect(region.x, region.y, fmax(0, region.width), fmax(0, region.height));
      glass.cornerRadius = fmax(0, region.radius);
      ApplyPath(state, key, glass, region);
      glass.style = region.style == 1 ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
      glass.appearance = region.appearance == 2 ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]
          : region.appearance == 1 ? [NSAppearance appearanceNamed:NSAppearanceNameAqua]
          : nil;
      glass.tintColor = region.hasTint
          ? [NSColor colorWithSRGBRed:region.tint[0] green:region.tint[1] blue:region.tint[2] alpha:region.tint[3]]
          : nil;
      SEL variantSelector = NSSelectorFromString(@"set_variant:");
      if (region.variant >= 0 && [glass respondsToSelector:variantSelector]) {
        ((void (*)(id, SEL, NSInteger))objc_msgSend)(glass, variantSelector, region.variant);
      }
      SEL adaptiveSelector = NSSelectorFromString(@"set_adaptiveAppearance:");
      if (region.adaptive >= 0 && [glass respondsToSelector:adaptiveSelector]) {
        ((void (*)(id, SEL, NSInteger))objc_msgSend)(glass, adaptiveSelector, region.adaptive);
      }
      glass.alphaValue = fmin(1.0, fmax(0.0, region.alpha));
      glass.hidden = region.width < 1 || region.height < 1 || region.alpha <= 0.001;
    }

    for (NSString *key in [state.views allKeys]) {
      if ([seen containsObject:key]) continue;
      [state.views[key] removeFromSuperview];
      [state.views removeObjectForKey:key];
      [state.pathed removeObject:key];
    }
    [CATransaction commit];
  }
  return Undefined(env);
}

struct SampleRequest {
  napi_deferred deferred = nullptr;
  napi_threadsafe_function callback = nullptr;
};

static const size_t kSampleSize = 24;

static void ResolveSample(napi_env env, napi_value jsCallback, void *context, void *data) {
  SampleRequest *request = static_cast<SampleRequest *>(context);
  double *luminance = static_cast<double *>(data);
  if (env && request) {
    napi_value result;
    if (luminance && std::isfinite(*luminance)) {
      napi_create_double(env, *luminance, &result);
    } else {
      napi_get_null(env, &result);
    }
    napi_resolve_deferred(env, request->deferred, result);
  }
  delete luminance;
  delete request;
}

static void FinishSample(SampleRequest *request, double luminance) {
  double *payload = new double(luminance);
  if (napi_call_threadsafe_function(request->callback, payload, napi_tsfn_nonblocking) != napi_ok) delete payload;
  napi_release_threadsafe_function(request->callback, napi_tsfn_release);
}

static double LinearChannel(double value) {
  return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4);
}

static double AverageLuminance(CGImageRef image) {
  if (!image) return NAN;
  uint8_t pixels[kSampleSize * kSampleSize * 4] = {0};
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGContextRef context = CGBitmapContextCreate(pixels, kSampleSize, kSampleSize, 8, kSampleSize * 4, space,
                                               kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
  CGColorSpaceRelease(space);
  if (!context) return NAN;
  CGContextDrawImage(context, CGRectMake(0, 0, kSampleSize, kSampleSize), image);
  CGContextRelease(context);
  double total = 0;
  size_t count = 0;
  for (size_t i = 0; i < kSampleSize * kSampleSize; i++) {
    const uint8_t *p = pixels + i * 4;
    if (p[3] == 0) continue;
    double alpha = p[3] / 255.0;
    total += 0.2126 * LinearChannel(p[0] / 255.0 / alpha) + 0.7152 * LinearChannel(p[1] / 255.0 / alpha) +
             0.0722 * LinearChannel(p[2] / 255.0 / alpha);
    count++;
  }
  return count > 0 ? total / count : NAN;
}

static napi_value SampleBackdrop(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_value promise;
  SampleRequest *request = new SampleRequest();
  napi_create_promise(env, &request->deferred, &promise);

  napi_value resourceName;
  napi_create_string_utf8(env, "clui-glass-sample", NAPI_AUTO_LENGTH, &resourceName);
  if (napi_create_threadsafe_function(env, nullptr, nullptr, resourceName, 0, 1, nullptr, nullptr, request, ResolveSample,
                                      &request->callback) != napi_ok) {
    napi_value nullValue;
    napi_get_null(env, &nullValue);
    napi_resolve_deferred(env, request->deferred, nullValue);
    delete request;
    return promise;
  }

  NSView *content = nil;
  double rx = 0, ry = 0, rw = 0, rh = 0;
  bool valid = napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) == napi_ok && argc >= 2;
  if (valid) content = ContentViewFromHandle(env, argv[0]);
  if (valid) {
    valid = ReadNumber(env, argv[1], "x", &rx) && ReadNumber(env, argv[1], "y", &ry) &&
            ReadNumber(env, argv[1], "width", &rw) && ReadNumber(env, argv[1], "height", &rh) && rw >= 1 && rh >= 1;
  }
  NSWindow *window = content.window;
  NSScreen *screen = window.screen;
  if (!valid || !window || !screen) {
    FinishSample(request, NAN);
    return promise;
  }

  if (@available(macOS 14.0, *)) {
    NSRect contentFrame = [window contentRectForFrameRect:window.frame];
    NSRect screenFrame = screen.frame;
    CGRect source = CGRectMake(contentFrame.origin.x + rx - screenFrame.origin.x,
                               NSMaxY(screenFrame) - (NSMaxY(contentFrame) - ry), rw, rh);
    source = CGRectIntersection(source, CGRectMake(0, 0, screenFrame.size.width, screenFrame.size.height));
    CGWindowID windowId = (CGWindowID)window.windowNumber;
    CGDirectDisplayID displayId = [screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue];
    if (CGRectIsEmpty(source)) {
      FinishSample(request, NAN);
      return promise;
    }
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                               onScreenWindowsOnly:YES
                                                 completionHandler:^(SCShareableContent *shareable, NSError *error) {
      if (error || !shareable) {
        FinishSample(request, NAN);
        return;
      }
      SCDisplay *display = nil;
      for (SCDisplay *candidate in shareable.displays) {
        if (candidate.displayID == displayId) display = candidate;
      }
      NSMutableArray<SCWindow *> *excluded = [NSMutableArray array];
      for (SCWindow *candidate in shareable.windows) {
        if (candidate.windowID == windowId) [excluded addObject:candidate];
      }
      if (!display) {
        FinishSample(request, NAN);
        return;
      }
      SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:excluded];
      SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
      configuration.sourceRect = source;
      configuration.width = kSampleSize;
      configuration.height = kSampleSize;
      configuration.showsCursor = NO;
      [SCScreenshotManager captureImageWithFilter:filter
                                    configuration:configuration
                                completionHandler:^(CGImageRef image, NSError *captureError) {
        FinishSample(request, captureError ? NAN : AverageLuminance(image));
      }];
    }];
  } else {
    FinishSample(request, NAN);
  }
  return promise;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"isSupported", nullptr, IsSupported, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setRegions", nullptr, SetRegions, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"sampleBackdrop", nullptr, SampleBackdrop, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
