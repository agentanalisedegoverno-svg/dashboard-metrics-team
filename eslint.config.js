// ESLint mínimo: só o que pega erro de verdade (variável indefinida/não usada, hooks do React, expressões sem efeito).
// Sem regras de estilo: formatação não é assunto do linter neste projeto.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'playwright-report', 'test-results', '.local', 'docs', 'api', 'public/**/*.min.js'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Testes: `any` em mocks e expressões do tipo `expect(...)` encadeadas são normais.
    files: ['**/*.test.{ts,tsx}', 'e2e/**', 'db/testes/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-unused-expressions': 'off' },
  },
)
