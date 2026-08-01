/** Normalize trusted answers for equality checks (unsaved vs last saved). */
export function keyFactsChanged(localFacts, savedFacts) {
  const norm = (facts) =>
    (Array.isArray(facts) ? facts : [])
      .map((f) => ({
        title: String(f?.title || '').trim(),
        body: String(f?.body || '').trim(),
      }))
      .filter((f) => f.title && f.body)
      .map((f) => `${f.title}\n${f.body}`)
      .sort();
  return JSON.stringify(norm(localFacts)) !== JSON.stringify(norm(savedFacts));
}
