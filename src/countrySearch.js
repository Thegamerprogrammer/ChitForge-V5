import countryList from 'world-countries';

const aliases = new Map([
  ['usa', 'USA'], ['u s a', 'USA'], ['united states of america', 'USA'], ['peoples republic of china', 'CHN'], ['prc', 'CHN'],
  ['russia', 'RUS'], ['south korea', 'KOR'], ['north korea', 'PRK'], ['uk', 'GBR'], ['u k', 'GBR'], ['great britain', 'GBR'],
  ['iran', 'IRN'], ['syria', 'SYR'], ['laos', 'LAO'], ['vietnam', 'VNM'], ['venezuela', 'VEN'], ['bolivia', 'BOL'], ['tanzania', 'TZA'],
]);
const normalize = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const COUNTRIES = countryList.filter((country) => country.cca3 && country.name?.common).map((country) => ({ iso: country.cca3, name: country.name.common, official: country.name.official || '' }));
const byIso = new Map(COUNTRIES.map((country) => [country.iso, country]));

export function resolveCountry(value) {
  const query = normalize(value); if (!query) return null;
  const alias = aliases.get(query); if (alias) return byIso.get(alias);
  return COUNTRIES.find((country) => normalize(country.name) === query || normalize(country.official) === query || normalize(country.iso) === query) || null;
}
export function searchCountries(value, limit = 7) {
  const query = normalize(value); if (!query) return [];
  const exact = resolveCountry(query); const candidates = COUNTRIES.filter((country) => normalize(country.name).includes(query) || normalize(country.official).includes(query) || normalize(country.iso).includes(query));
  return [...new Map([exact, ...candidates].filter(Boolean).map((country) => [country.iso, country])).values()].slice(0, limit);
}
