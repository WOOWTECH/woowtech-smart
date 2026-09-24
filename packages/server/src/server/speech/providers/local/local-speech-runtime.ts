import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Whether the native runtime behind local speech (`sherpa-onnx-node`) is
 * installed.
 *
 * woowtech smart ships without it. Its native library statically links eSpeak NG
 * (GPL-3.0), which cannot go into a product distributed under our terms, and the
 * models it pulls on first start are a ~985 MB download. Without the runtime,
 * local speech is treated as not configured: no model download, no speech
 * worker, and the features report themselves unavailable. Installing the package
 * again restores upstream behaviour with no code change.
 *
 * Resolves the package without loading it, so the probe never touches the
 * native addon.
 */
export function isLocalSpeechRuntimeInstalled(): boolean {
  try {
    require.resolve("sherpa-onnx-node");
    return true;
  } catch {
    return false;
  }
}
