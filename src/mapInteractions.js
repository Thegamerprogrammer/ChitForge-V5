export function countryMatchesPortfolio(country, portfolio = '') {
  const portfolioText = String(portfolio || '').trim().toLowerCase();
  return !!portfolioText && (country.iso.toLowerCase() === portfolioText || country.name.toLowerCase() === portfolioText);
}

export function toggleTargetSelection(selected = [], country, portfolio = '') {
  if (countryMatchesPortfolio(country, portfolio)) return selected;
  return selected.some((c) => c.iso === country.iso) ? selected.filter((c) => c.iso !== country.iso) : [...selected, { iso: country.iso, name: country.name }];
}

export function setPortfolioFromMap({ currentForm, selected = [], country }) {
  return { form: { ...currentForm, portfolio: country.name }, selected: selected.filter((item) => item.iso !== country.iso) };
}
