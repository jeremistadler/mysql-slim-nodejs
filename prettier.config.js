module.exports = {
  parser: 'typescript',
  trailingComma: 'es5',
  singleQuote: true,
  semi: false,
  arrowParens: 'avoid',
  plugins: [require('prettier-plugin-organize-imports')],
  pluginSearchDirs: false,
};
