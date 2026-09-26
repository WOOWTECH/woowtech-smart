// Automatic naming sends first-agent context to a metadata provider. Keep it off
// until explicit opt-in and same-provider selection are implemented together.
export function isWorkspaceAutoNameEnabled(): boolean {
  return false;
}

// Commit/PR metadata also stays off until explicit provider selection is available.
// This is a fork policy, not a preference inferred from existing home/config data.
export function isGitMetadataGenerationEnabled(): boolean {
  return false;
}
