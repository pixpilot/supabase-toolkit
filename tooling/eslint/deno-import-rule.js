/**
 * @fileoverview Enforce using npm: prefix for npm packages in Deno
 * @author @internal/eslint-config
 */

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce using npm: prefix for npm packages in Deno',
      recommended: false,
    },
    messages: {
      useNpmPrefix:
        'Use "npm:{{package}}" instead of "{{package}}" for Deno compatibility.',
    },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          typeof source === 'string' &&
          !source.startsWith('npm:') &&
          !source.startsWith('./') &&
          !source.startsWith('../') &&
          !source.includes('://')
        ) {
          context.report({
            node: node.source,
            messageId: 'useNpmPrefix',
            data: {
              package: source,
            },
          });
        }
      },
    };
  },
};
