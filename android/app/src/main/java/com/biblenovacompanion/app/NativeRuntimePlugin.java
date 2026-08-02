package com.biblenovacompanion.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Exposes APK-compiled runtime metadata to the hosted React UI. */
@CapacitorPlugin(name = "NativeRuntime")
public class NativeRuntimePlugin extends Plugin {
  @PluginMethod
  public void getInfo(PluginCall call) {
    JSObject info = new JSObject();
    info.put("bridgeVersion", BuildConfig.NATIVE_BRIDGE_VERSION);
    call.resolve(info);
  }
}
