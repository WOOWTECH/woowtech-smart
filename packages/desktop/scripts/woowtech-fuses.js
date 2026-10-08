// woowtech smart: the desktop app's Electron fuses (woowtech/README.md, section 26). after-pack.js
// flips them first, before signing and before the Linux launcher replaces the Electron binary with
// a script: electron-builder's own `electronFuses` runs after afterPack and would find no fuse wire
// in that script.
const WOOWTECH_FUSES = {
  // The built-in daemon, its supervisor and bin/paseo run this binary with ELECTRON_RUN_AS_NODE.
  runAsNode: true,
  // Also gates NODE_EXTRA_CA_CERTS, which the daemon needs behind a TLS-inspecting proxy.
  enableNodeOptionsEnvironmentVariable: true,
  enableNodeCliInspectArguments: false,
  onlyLoadAppFromAsar: true,
  enableEmbeddedAsarIntegrityValidation: true,
  grantFileProtocolExtraPrivileges: false,
};

/** Flips WOOWTECH_FUSES with electron-builder's own @electron/fuses, as its afterPack docs show. */
async function flipWoowtechFuses(context) {
  const { packager } = context;
  await packager.addElectronFuses(context, packager.generateFuseConfig(WOOWTECH_FUSES));
}

module.exports = { WOOWTECH_FUSES, flipWoowtechFuses };
