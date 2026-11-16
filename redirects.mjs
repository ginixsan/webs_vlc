// Detects pages that ended on an unrelated website (hijacked sites, ad redirects), whose
// content must not be recorded as the municipality's.

function siteName(url) {
  try {
    const { hostname, protocol } = new URL(url);
    if (!['http:', 'https:'].includes(protocol)) return null;
    const labels = hostname.replace(/^www\./, '').split('.');
    // "ayto.mutxamel.org" -> "mutxamel": the label just before the top-level domain
    return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  } catch {
    return null;
  }
}

export function isForeignRedirect(requestedUrl, finalUrl) {
  const requested = siteName(requestedUrl);
  const reached = siteName(finalUrl);
  if (!requested || !reached) return false;
  // Renamed municipal domains keep the town name: aytoestivella.com -> estivella.es
  return !(requested.includes(reached) || reached.includes(requested));
}
