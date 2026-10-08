#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>
#import <objc/runtime.h>
#include <node_api.h>
#include <cmath>
#include <string>

static char kGlassStateKey;
static char kActiveAppearanceKey;
static const uint32_t kMaxRegions = 32;

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
  bool hasTint = false;
  double tint[4] = {0, 0, 0, 0};
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
  return true;
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
      glass.style = region.style == 1 ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
      glass.appearance = region.appearance == 2 ? [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]
          : region.appearance == 1 ? [NSAppearance appearanceNamed:NSAppearanceNameAqua]
          : nil;
      glass.tintColor = region.hasTint
          ? [NSColor colorWithSRGBRed:region.tint[0] green:region.tint[1] blue:region.tint[2] alpha:region.tint[3]]
          : nil;
      glass.alphaValue = fmin(1.0, fmax(0.0, region.alpha));
      glass.hidden = region.width < 1 || region.height < 1 || region.alpha <= 0.001;
    }

    for (NSString *key in [state.views allKeys]) {
      if ([seen containsObject:key]) continue;
      [state.views[key] removeFromSuperview];
      [state.views removeObjectForKey:key];
    }
    [CATransaction commit];
  }
  return Undefined(env);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"isSupported", nullptr, IsSupported, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setRegions", nullptr, SetRegions, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
