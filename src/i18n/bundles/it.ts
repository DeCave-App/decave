// Every catalog for one language, so switching language fetches one chunk.

export default import.meta.glob<Record<string, unknown>>("../../../shared/i18n/locales/it/*.json", {
  eager: true,
  import: "default",
});
