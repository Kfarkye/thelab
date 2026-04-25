function normalizeForSearch(input) {
  return input.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function score(id, name, query) {
  const normalizedQuery = normalizeForSearch(query);
  const normalizedId = normalizeForSearch(id);
  const normalizedName = normalizeForSearch(name);

  if (normalizedId === normalizedQuery) return 1.0;
  if (normalizedId.includes(normalizedQuery)) return 0.9;
  if (normalizedName.includes(normalizedQuery)) return 0.8;

  const queryWords = normalizedQuery.split(" ");
  const idWords = normalizedId.split(" ");
  const matchedWords = queryWords.filter((qw) =>
    idWords.some((iw) => iw.includes(qw) || qw.includes(iw))
  );
  if (matchedWords.length > 0) {
    return 0.5 + (matchedWords.length / queryWords.length) * 0.3;
  }
  return 0;
}

console.log("Score for 'housing breakdown':", score("housing_options_breakdown", "🏠 OPS: Housing Options Breakdown Request", "housing breakdown"));
