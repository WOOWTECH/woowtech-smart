// Automatic naming sends first-agent context to a metadata provider. Keep it off
// until explicit opt-in and same-provider selection are implemented together.
export function isWorkspaceAutoNameEnabled(): boolean {
  return false;
}
