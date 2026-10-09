#include <node_api.h>
#include <X11/Xatom.h>
#include <X11/Xlib.h>
#include <X11/extensions/shape.h>
#include <unistd.h>
#include <algorithm>
#include <climits>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <vector>

static const uint32_t kMaxRectValues = 4096 * 4;
static const uint64_t kMaxXid = 0x1FFFFFFF;

static Display *gDisplay = nullptr;
static bool gDisplayTried = false;
static Window gVerifiedWindow = 0;
static bool gTrappedError = false;

static int TrapXError(Display *, XErrorEvent *) {
  gTrappedError = true;
  return 0;
}

class ErrorTrap {
 public:
  explicit ErrorTrap(Display *display) : display_(display) {
    gTrappedError = false;
    previous_ = XSetErrorHandler(TrapXError);
  }

  ~ErrorTrap() { XSetErrorHandler(previous_); }

  bool Failed() {
    XSync(display_, False);
    return gTrappedError;
  }

 private:
  Display *display_;
  XErrorHandler previous_;
};

static void CloseDisplay(void *) {
  if (gDisplay) XCloseDisplay(gDisplay);
  gDisplay = nullptr;
  gVerifiedWindow = 0;
}

static Display *GetDisplay() {
  if (gDisplayTried) return gDisplay;
  gDisplayTried = true;
  Display *display = XOpenDisplay(nullptr);
  if (!display) return nullptr;
  int eventBase = 0;
  int errorBase = 0;
  int major = 0;
  int minor = 0;
  bool shapeInput = XShapeQueryExtension(display, &eventBase, &errorBase) &&
                    XShapeQueryVersion(display, &major, &minor) &&
                    (major > 1 || (major == 1 && minor >= 1));
  if (!shapeInput) {
    XCloseDisplay(display);
    return nullptr;
  }
  gDisplay = display;
  return gDisplay;
}

static napi_value Boolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static bool ReadWindow(napi_env env, napi_value value, Window *out) {
  bool isBuffer = false;
  if (napi_is_buffer(env, value, &isBuffer) != napi_ok || !isBuffer) return false;
  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || !data) return false;
  uint64_t id = 0;
  if (length >= sizeof(uint64_t)) {
    std::memcpy(&id, data, sizeof(uint64_t));
  } else if (length >= sizeof(uint32_t)) {
    uint32_t narrow = 0;
    std::memcpy(&narrow, data, sizeof(uint32_t));
    id = narrow;
  } else {
    return false;
  }
  if (id == 0 || id > kMaxXid) return false;
  *out = static_cast<Window>(id);
  return true;
}

static bool OwnedByProcess(Display *display, Window window) {
  if (window == gVerifiedWindow) return true;
  Atom pidAtom = XInternAtom(display, "_NET_WM_PID", True);
  if (pidAtom == None) return false;
  ErrorTrap trap(display);
  Atom actualType = None;
  int actualFormat = 0;
  unsigned long count = 0;
  unsigned long remaining = 0;
  unsigned char *data = nullptr;
  int status = XGetWindowProperty(display, window, pidAtom, 0, 1, False, XA_CARDINAL, &actualType, &actualFormat,
                                  &count, &remaining, &data);
  bool owned = false;
  if (status == Success && data && actualType == XA_CARDINAL && actualFormat == 32 && count == 1) {
    unsigned long pid = 0;
    std::memcpy(&pid, data, sizeof(pid));
    owned = pid == static_cast<unsigned long>(getpid());
  }
  if (data) XFree(data);
  if (trap.Failed() || !owned) return false;
  gVerifiedWindow = window;
  return true;
}

static bool ReadRects(napi_env env, napi_value value, std::vector<XRectangle> *out) {
  bool isArray = false;
  uint32_t length = 0;
  if (napi_is_array(env, value, &isArray) != napi_ok || !isArray) return false;
  if (napi_get_array_length(env, value, &length) != napi_ok) return false;
  if (length % 4 != 0 || length > kMaxRectValues) return false;
  out->reserve(length / 4);
  for (uint32_t i = 0; i < length; i += 4) {
    double values[4];
    for (uint32_t j = 0; j < 4; j++) {
      napi_value element;
      if (napi_get_element(env, value, i + j, &element) != napi_ok) return false;
      if (napi_get_value_double(env, element, &values[j]) != napi_ok || !std::isfinite(values[j])) return false;
    }
    if (std::fabs(values[0]) > 1e7 || std::fabs(values[1]) > 1e7 || std::fabs(values[2]) > 1e7 || std::fabs(values[3]) > 1e7) continue;
    long left = std::clamp<long>(std::lround(values[0]), SHRT_MIN, SHRT_MAX);
    long top = std::clamp<long>(std::lround(values[1]), SHRT_MIN, SHRT_MAX);
    long right = std::clamp<long>(std::lround(values[0] + values[2]), SHRT_MIN, SHRT_MAX);
    long bottom = std::clamp<long>(std::lround(values[1] + values[3]), SHRT_MIN, SHRT_MAX);
    if (right - left < 1 || bottom - top < 1) continue;
    XRectangle rect;
    rect.x = static_cast<short>(left);
    rect.y = static_cast<short>(top);
    rect.width = static_cast<unsigned short>(right - left);
    rect.height = static_cast<unsigned short>(bottom - top);
    out->push_back(rect);
  }
  return true;
}

static napi_value IsSupported(napi_env env, napi_callback_info) {
  return Boolean(env, GetDisplay() != nullptr);
}

static napi_value SetInputRegion(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  if (napi_get_cb_info(env, info, &argc, args, nullptr, nullptr) != napi_ok || argc < 2) return Boolean(env, false);
  Display *display = GetDisplay();
  Window window = 0;
  std::vector<XRectangle> rects;
  if (!display || !ReadWindow(env, args[0], &window) || !ReadRects(env, args[1], &rects)) return Boolean(env, false);
  if (!OwnedByProcess(display, window)) return Boolean(env, false);
  ErrorTrap trap(display);
  XShapeCombineRectangles(display, window, ShapeInput, 0, 0, rects.empty() ? nullptr : rects.data(),
                          static_cast<int>(rects.size()), ShapeSet, Unsorted);
  if (trap.Failed()) {
    gVerifiedWindow = 0;
    return Boolean(env, false);
  }
  return Boolean(env, true);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"isSupported", nullptr, IsSupported, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setInputRegion", nullptr, SetInputRegion, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  napi_add_env_cleanup_hook(env, CloseDisplay, nullptr);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
