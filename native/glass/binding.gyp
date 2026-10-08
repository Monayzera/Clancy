{
  "targets": [
    {
      "target_name": "clui_native_glass",
      "sources": ["src/glass.mm"],
      "xcode_settings": {
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "MACOSX_DEPLOYMENT_TARGET": "11.0",
        "OTHER_LDFLAGS": ["-framework AppKit", "-framework QuartzCore"]
      }
    }
  ]
}
