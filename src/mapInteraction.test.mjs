import assert from 'node:assert/strict';
import fs from 'node:fs';
import { countryMatchesPortfolio, setPortfolioFromMap, toggleTargetSelection } from './mapInteractions.js';

const india = { iso: 'IND', name: 'India' };
const indonesia = { iso: 'IDN', name: 'Indonesia' };
const china = { iso: 'CHN', name: 'China' };

const portfolioResult = setPortfolioFromMap({ currentForm: { portfolio: 'Indonesia', agenda: 'Debt' }, selected: [india, china], country: india });
assert.equal(portfolioResult.form.portfolio, 'India');
assert.deepEqual(portfolioResult.selected, [china]);
assert(countryMatchesPortfolio(india, 'India'));
assert(countryMatchesPortfolio(india, 'IND'));
assert(!countryMatchesPortfolio(china, 'India'));

assert.deepEqual(toggleTargetSelection([], china, 'India'), [china]);
assert.deepEqual(toggleTargetSelection([china], china, 'India'), []);
assert.deepEqual(toggleTargetSelection([china], india, 'India'), [china]);
assert.deepEqual(toggleTargetSelection([indonesia], indonesia, 'IDN'), [indonesia]);

const mapSource = fs.readFileSync(new URL('./map.jsx', import.meta.url), 'utf8');
assert(mapSource.includes('onClick={() => choosePortfolio(country)}'), 'left click sets portfolio');
assert(mapSource.includes('onContextMenu={(e) => handleContextMenu(e, country)}'), 'right click handled on map countries');
assert(mapSource.includes('event.preventDefault()'), 'right click prevents browser context menu on map country surface');
const styles = fs.readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
assert.match(styles, /\.country\.portfolio[\s\S]*rgba\(88, 220, 132/, 'portfolio styling is green');
console.log('map interaction dry-run passed');
