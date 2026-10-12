'use strict';
/** Pure core (no Firebase): validator, statistics, signals, aggregate, report. Vendored into the routine repo. */
const VERSION = '1.1.0';
module.exports = {
  VERSION,
  ...require('./item.js'),
  ...require('./report.js'),
  templateReport: require('./template.js').templateReport,
  lexicon: require('./lexicon.js').lexicon,
  kdate: require('./kdate.js'),
};
